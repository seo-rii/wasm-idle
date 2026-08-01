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

vi.mock('$lib/playground/worker/cobol?worker', () => ({
	default: MockWorker
}));

import Cobol from './cobol';

describe('COBOL sandbox workspace boundary', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('canonicalizes the active path and workspace files before worker dispatch', async () => {
		const sandbox = new Cobol();
		const code = '       IDENTIFICATION DIVISION.';
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.cob',
				workspaceFiles: [{ path: 'copy\\shared.cpy', content: '       01 VALUE PIC 9.' }]
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.cob',
				workspaceFiles: [{ path: 'copy/shared.cpy', content: '       01 VALUE PIC 9.' }]
			})
		);

		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ activePath: 'main.cob', workspaceFiles: [] })
		);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'A',
			options: { activePath: '../main.cob' },
			expected: { code: 'invalid-path', path: '../main.cob' }
		},
		{
			name: 'workspace path traversal',
			code: 'A',
			options: { workspaceFiles: [{ path: 'copy/../secret.cpy', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'copy/../secret.cpy' }
		},
		{
			name: 'absolute active path',
			code: 'A',
			options: { activePath: '/main.cob' },
			expected: { code: 'invalid-path', path: '/main.cob' }
		},
		{
			name: 'control character in a path',
			code: 'A',
			options: { workspaceFiles: [{ path: 'copy/secret\0.cpy', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'copy/secret\0.cpy' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'copy/shared.cpy', content: 'B' },
					{ path: 'copy/shared.cpy', content: 'C' }
				]
			},
			expected: { code: 'duplicate-path', path: 'copy/shared.cpy' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'COPY/shared.cpy', content: 'B' },
					{ path: 'copy/shared.cpy', content: 'C' }
				]
			},
			expected: { code: 'case-collision', path: 'copy/shared.cpy' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'copy/shared.cpy', content: 'B' }],
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
				workspaceFiles: [{ path: 'copy/shared.cpy', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a COBOL workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Cobol();
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
			const assetBridge = sandbox.assetBridge;
			const begin = sandbox.begin;
			sandbox.write('queued input\n');

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(loadHandler);
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(sandbox.assetBridge).toBe(assetBridge);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.begin).toBe(begin);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued input\n']);

			await expect(sandbox.run('A', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.cob', workspaceFiles: [] })
			);
		}
	);
});
