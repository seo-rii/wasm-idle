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

vi.mock('$lib/playground/worker/sqlite?worker', () => ({
	default: MockWorker
}));

import type { SandboxExecutionOptions } from './options';
import Sqlite from './sqlite';

describe('SQLite workspace boundary', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('canonicalizes the active path and workspace files before worker dispatch', async () => {
		const sandbox = new Sqlite();
		const code = 'select value from helper;';
		await sandbox.load('/assets');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.sql',
				workspaceFiles: [
					{
						path: 'src\\helper.sql',
						content: 'create table helper(value integer);'
					},
					{
						path: 'src\\main.sql',
						content: 'select "stale active source";'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.sql',
				workspaceFiles: [
					{
						path: 'src/helper.sql',
						content: 'create table helper(value integer);'
					}
				]
			})
		);
	});

	it('preserves termination ownership when workspace getters start a replacement load', async () => {
		const sandbox = new Sqlite();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace SQLite during validation');
		const laterError = new Error('SQLite workspace getter failed after replacement');
		let replacement: Promise<void> | undefined;
		const options: SandboxExecutionOptions = {};
		Object.defineProperty(options, 'workspaceFiles', {
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement');
				void replacement.catch(() => undefined);
				return [];
			}
		});
		Object.defineProperty(options, 'activePath', {
			get() {
				throw laterError;
			}
		});

		await expect(sandbox.run('select 1;', false, true, undefined, [], options)).rejects.toBe(
			reason
		);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();

		await expect(sandbox.run('select 2;', false)).resolves.toBe(true);
		expect(workerInstances[1].postMessage).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'select 1;',
			options: { activePath: '../main.sql' },
			expected: { code: 'invalid-path', path: '../main.sql' }
		},
		{
			name: 'workspace path traversal',
			code: 'select 1;',
			options: { workspaceFiles: [{ path: 'src/../secret.sql', content: 'select 2;' }] },
			expected: { code: 'invalid-path', path: 'src/../secret.sql' }
		},
		{
			name: 'absolute path',
			code: 'select 1;',
			options: { activePath: '/tmp/main.sql' },
			expected: { code: 'invalid-path', path: '/tmp/main.sql' }
		},
		{
			name: 'NUL path',
			code: 'select 1;',
			options: { workspaceFiles: [{ path: 'src/bad\0.sql', content: 'select 2;' }] },
			expected: { code: 'invalid-path', path: 'src/bad\0.sql' }
		},
		{
			name: 'duplicate path',
			code: 'select 1;',
			options: {
				workspaceFiles: [
					{ path: 'src/helper.sql', content: 'select 2;' },
					{ path: 'src/helper.sql', content: 'select 3;' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/helper.sql' }
		},
		{
			name: 'case-colliding path',
			code: 'select 1;',
			options: {
				workspaceFiles: [
					{ path: 'SRC/helper.sql', content: 'select 2;' },
					{ path: 'src/helper.sql', content: 'select 3;' }
				]
			},
			expected: { code: 'case-collision', path: 'src/helper.sql' }
		},
		{
			name: 'file count overflow',
			code: 'select 1;',
			options: {
				workspaceFiles: [{ path: 'src/helper.sql', content: 'select 2;' }],
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
				workspaceFiles: [{ path: 'src/helper.sql', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a SQLite workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Sqlite();
			await sandbox.load('/assets');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
			const begin = sandbox.begin;

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

			await expect(sandbox.run('select 1;', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.sql', workspaceFiles: [] })
			);
		}
	);
});
