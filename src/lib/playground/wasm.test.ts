import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (suppressAutoLoadAck) return;
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { buffer: true, output: 'main=65\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/wasm?worker', () => ({
	default: MockWorker
}));

import Wasm from './wasm';

describe('WASM sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		suppressAutoLoadAck = false;
	});

	it('loads the WASM worker and forwards stdin-capable run output', async () => {
		const sandbox = new Wasm();
		const outputs: string[] = [];
		const code = 'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'], {
				activePath: 'main.wasm',
				stdin: 'A\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				activePath: 'main.wasm',
				stdin: 'A\n',
				args: ['demo'],
				log: true
			})
		);
		expect(workerInstances[0].postMessage.mock.calls[2][0].buffer).toBeInstanceOf(
			SharedArrayBuffer
		);
		expect(outputs).toContain('main=65\n');
	});

	it('normalizes a valid WASM workspace before worker dispatch', async () => {
		const sandbox = new Wasm();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('AGFzbQ==', false, true, undefined, [], {
				activePath: 'nested\\main.wasm',
				workspaceFiles: [{ path: 'fixtures\\helper.wasm', content: 'AGFzbQ==' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.wasm',
				workspaceFiles: [{ path: 'fixtures/helper.wasm', content: 'AGFzbQ==' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.wasm' },
			expected: { code: 'invalid-path', path: '../main.wasm' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.wasm', content: 'A' },
					{ path: 'data/module.wasm', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.wasm' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.wasm', content: 'A' },
					{ path: 'data/module.wasm', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.wasm' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.wasm', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.wasm', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a WASM workspace with $name before dispatch',
		async ({ code, options, expected }) => {
			const sandbox = new Wasm();
			await sandbox.load('/absproxy/5173');

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
		}
	);

	it('rejects overlapping WASM run and load operations without replacing ownership', async () => {
		const sandbox = new Wasm();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('AGFzbQ==', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('AGFzbQ==', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'WASM'
		});
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'WASM'
		});

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.terminate).not.toHaveBeenCalled();

		firstHandler?.({ data: { output: 'first\n', results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);
		expect(outputs).toEqual(['first\n']);

		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		await expect(sandbox.run('AGFzbQ==', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted WASM run without changing worker state', async () => {
		const sandbox = new Wasm();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('WASM pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('AGFzbQ==', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('AGFzbQ==', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active WASM run with its exact reason and permits a clean retry', async () => {
		const sandbox = new Wasm();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('WASM active abort');

		const running = sandbox.run('AGFzbQ==', false, true, progress, [], {
			signal: controller.signal
		});
		const lateHandler = worker.onmessage;
		controller.abort(reason);

		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		lateHandler?.({
			data: { output: 'late\n', progress: 0.8, results: true }
		} as MessageEvent<any>);
		expect(outputs).toEqual([]);
		expect(progress.set).not.toHaveBeenCalled();

		await sandbox.load('/absproxy/5173');
		const retryWorker = workerInstances.at(-1)!;
		const settledController = new AbortController();
		await expect(
			sandbox.run('AGFzbQ==', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects overlapping WASM startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wasm();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'WASM'
		});
		await expect(sandbox.run('AGFzbQ==', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'WASM'
		});
		expect(worker.onmessage).toBe(loadHandler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
	});

	it('releases WASM run activity after synchronous dispatch failure', async () => {
		const sandbox = new Wasm();
		const worker = new MockWorker();
		const dispatchFailure = new Error('WASM dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchFailure;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('AGFzbQ==', false)).rejects.toBe(dispatchFailure);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('AGFzbQ==', false)).resolves.toBe(true);
	});

	it('keeps a replacement WASM handler when a terminated run posts a stale message', async () => {
		const sandbox = new Wasm();
		const oldWorker = new MockWorker();
		oldWorker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = oldWorker as unknown as Worker;
		const oldRun = sandbox.run('AGFzbQ==', false);
		const oldHandler = oldWorker.onmessage;

		sandbox.kill();
		await expect(oldRun).rejects.toBe('Process terminated');
		expect(oldWorker.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances.at(-1)!;
		replacementWorker.postMessage.mockImplementation(() => undefined);
		const replacementRun = sandbox.run('AGFzbQ==', false);
		const replacementHandler = replacementWorker.onmessage;
		let replacementSettled = false;
		void replacementRun.then(
			() => {
				replacementSettled = true;
			},
			() => {
				replacementSettled = true;
			}
		);

		oldHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		await Promise.resolve();
		expect(replacementWorker.onmessage).toBe(replacementHandler);
		expect(replacementSettled).toBe(false);

		replacementHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(replacementRun).resolves.toBe(true);
	});

	it('rejects load when the WASM worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wasm();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/wasm.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'WASM worker script error: worker script error (/worker/wasm.js:8:2)'
		);
	});
});
