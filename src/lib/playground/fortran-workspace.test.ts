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

vi.mock('$lib/playground/worker/fortran?worker', () => ({
	default: MockWorker
}));

import Fortran from './fortran';
import type { SandboxExecutionOptions } from './options';

describe('Fortran workspace boundary', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('canonicalizes the active path and workspace files before worker dispatch', async () => {
		const sandbox = new Fortran();
		const code = '      PROGRAM MAIN\n      END';
		await sandbox.load('/assets');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.f',
				workspaceFiles: [
					{
						path: 'src\\helper.f',
						content: '      SUBROUTINE HELPER\n      END'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.f',
				workspaceFiles: [
					{
						path: 'src/helper.f',
						content: '      SUBROUTINE HELPER\n      END'
					}
				]
			})
		);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'A',
			options: { activePath: '../main.f' },
			expected: { code: 'invalid-path', path: '../main.f' }
		},
		{
			name: 'workspace path traversal',
			code: 'A',
			options: { workspaceFiles: [{ path: 'src/../secret.f', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'src/../secret.f' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.f' },
			expected: { code: 'invalid-path', path: '/tmp/main.f' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { workspaceFiles: [{ path: 'src/bad\0.f', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'src/bad\0.f' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'src/helper.f', content: 'B' },
					{ path: 'src/helper.f', content: 'C' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/helper.f' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'SRC/helper.f', content: 'B' },
					{ path: 'src/helper.f', content: 'C' }
				]
			},
			expected: { code: 'case-collision', path: 'src/helper.f' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/helper.f', content: 'B' }],
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
				workspaceFiles: [{ path: 'src/helper.f', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Fortran workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Fortran();
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

			await expect(sandbox.run('      END', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.f', workspaceFiles: [] })
			);
		}
	);
});
