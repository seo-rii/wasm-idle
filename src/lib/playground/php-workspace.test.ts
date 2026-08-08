import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() => {
			if (message.load) {
				this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
				return;
			}
			this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/php?worker', () => ({
	default: MockWorker
}));

import type { SandboxExecutionOptions } from './options';
import Php from './php';

describe('PHP workspace boundary', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('canonicalizes files and removes the auxiliary copy of the active source', async () => {
		const sandbox = new Php();
		const code = '<?php require __DIR__ . "/helper.php";';
		await sandbox.load('/assets');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.php',
				workspaceFiles: [
					{
						path: 'src\\helper.php',
						content: '<?php function helper() { return 42; }'
					},
					{
						path: 'src\\main.php',
						content: '<?php throw new Exception("stale source");'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.php',
				workspaceFiles: [
					{
						path: 'src/helper.php',
						content: '<?php function helper() { return 42; }'
					}
				]
			})
		);
	});

	it('honors cancellation triggered while snapshotting workspace options', async () => {
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		const begin = sandbox.begin;
		const controller = new AbortController();
		const reason = new Error('cancelled by workspace getter');
		const options: SandboxExecutionOptions = {
			signal: controller.signal
		};
		Object.defineProperty(options, 'workspaceFiles', {
			get() {
				controller.abort(reason);
				return [];
			}
		});
		sandbox.write('queued input\n');

		await expect(
			sandbox.run('<?php echo 1;', false, true, undefined, [], options)
		).rejects.toBe(reason);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.begin).toBe(begin);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);

		await expect(sandbox.run('<?php echo 1;', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('releases provisional ownership before cancellation callbacks reenter the sandbox', async () => {
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('cancel before replacement load');
		let replacement: Promise<void> | undefined;
		const options: SandboxExecutionOptions = {
			signal: controller.signal
		};
		Object.defineProperty(options, 'workspaceFiles', {
			get() {
				controller.abort(reason);
				replacement = sandbox.load('/assets');
				void replacement.catch(() => undefined);
				return [];
			}
		});

		await expect(
			sandbox.run('<?php echo 1;', false, true, undefined, [], options)
		).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('<?php echo 2;', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			name: 'active path traversal',
			code: '<?php echo 1;',
			options: { activePath: '../main.php' },
			expected: { code: 'invalid-path', path: '../main.php' }
		},
		{
			name: 'workspace path traversal',
			code: '<?php echo 1;',
			options: { workspaceFiles: [{ path: 'src/../secret.php', content: '<?php echo 2;' }] },
			expected: { code: 'invalid-path', path: 'src/../secret.php' }
		},
		{
			name: 'absolute path',
			code: '<?php echo 1;',
			options: { activePath: '/tmp/main.php' },
			expected: { code: 'invalid-path', path: '/tmp/main.php' }
		},
		{
			name: 'NUL path',
			code: '<?php echo 1;',
			options: { workspaceFiles: [{ path: 'src/bad\0.php', content: '<?php echo 2;' }] },
			expected: { code: 'invalid-path', path: 'src/bad\0.php' }
		},
		{
			name: 'duplicate path',
			code: '<?php echo 1;',
			options: {
				workspaceFiles: [
					{ path: 'src/helper.php', content: '<?php echo 2;' },
					{ path: 'src/helper.php', content: '<?php echo 3;' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/helper.php' }
		},
		{
			name: 'case-colliding path',
			code: '<?php echo 1;',
			options: {
				workspaceFiles: [
					{ path: 'SRC/helper.php', content: '<?php echo 2;' },
					{ path: 'src/helper.php', content: '<?php echo 3;' }
				]
			},
			expected: { code: 'case-collision', path: 'src/helper.php' }
		},
		{
			name: 'file count overflow',
			code: '<?php echo 1;',
			options: {
				workspaceFiles: [{ path: 'src/helper.php', content: '<?php echo 2;' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'per-file overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 5 }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: '123',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceFiles: [{ path: 'src/helper.php', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a PHP workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Php();
			await sandbox.load('/assets');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
			const begin = sandbox.begin;
			sandbox.write('queued input\n');

			await expect(
				sandbox.run(code, false, true, undefined, [], options as SandboxExecutionOptions)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(loadHandler);
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(sandbox.uid).toBe(0);
			expect(sandbox.begin).toBe(begin);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued input\n']);

			await expect(sandbox.run('<?php echo 1;', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.php', workspaceFiles: [] })
			);
		}
	);
});
