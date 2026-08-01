import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_R_BASE_URL: ''
	}
}));
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
				data: { output: 'factorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/r?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import R from './r';

describe('R sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_R_BASE_URL = '';
		suppressAutoLoadAck = false;
	});

	it('loads the R worker and forwards run output', async () => {
		const sandbox = new R();
		const outputs: string[] = [];
		const code = 'cat("factorial_plus_bonus=27\\n")';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			r: {
				baseUrl: '/webr/test/'
			}
		});
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.R',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				baseUrl: 'http://localhost:3000/webr/test/'
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.R',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.R',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
	});

	it('normalizes a valid R workspace before worker dispatch', async () => {
		const sandbox = new R();
		await sandbox.load({ r: { baseUrl: '/webr/test/' } });

		await expect(
			sandbox.run('main()', false, true, undefined, [], {
				activePath: 'nested\\main.R',
				workspaceFiles: [{ path: 'fixtures\\helper.R', content: 'helper <- 1' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.R',
				workspaceFiles: [{ path: 'fixtures/helper.R', content: 'helper <- 1' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.R' },
			expected: { code: 'invalid-path', path: '../main.R' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.R' },
			expected: { code: 'invalid-path', path: '/tmp/main.R' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.R' },
			expected: { code: 'invalid-path', path: 'bad\0.R' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.R', content: 'A' },
					{ path: 'data/module.R', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.R' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.R', content: 'A' },
					{ path: 'data/module.R', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.R' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.R', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.R', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects an R workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new R();
			await sandbox.load({ r: { baseUrl: '/webr/test/' } });
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledTimes(1);
			expect(worker.onmessage).toBe(loadHandler);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
		}
	);

	it('rejects an overlapping run without disturbing the active R execution', async () => {
		const sandbox = new R();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('cat("first\\n")', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('cat("second\\n")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'R'
		});

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.terminate).not.toHaveBeenCalled();

		firstHandler?.({
			data: { output: 'first\n', results: true }
		} as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);
		expect(outputs).toEqual(['first\n']);

		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		await expect(sandbox.run('cat("retry\\n")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted R run without changing worker state', async () => {
		const sandbox = new R();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('R pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('cat("cancelled\\n")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('cat("retry\\n")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active R run with its exact reason and permits a clean retry', async () => {
		const sandbox = new R();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('R active abort');

		const running = sandbox.run('cat("pending\\n")', false, true, progress, [], {
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

		await sandbox.load({ r: { baseUrl: '/webr/test/' } });
		const retryWorker = workerInstances.at(-1)!;
		const settledController = new AbortController();
		await expect(
			sandbox.run('cat("retry\\n")', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('releases R run activity after synchronous dispatch failure', async () => {
		const sandbox = new R();
		const worker = new MockWorker();
		const dispatchFailure = new Error('R dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchFailure;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('stop("fail")', false)).rejects.toBe(dispatchFailure);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load({ r: { baseUrl: '/webr/test/' } });
		await expect(sandbox.run('cat("retry\\n")', false)).resolves.toBe(true);
	});

	it('rejects load when the R worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new R();
		const loadPromise = sandbox.load({ r: { baseUrl: '/webr/test/' } });
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/r.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'R worker script error: worker script error (/worker/r.js:8:2)'
		);
	});

	it('rejects a pre-aborted R startup without changing an existing worker', async () => {
		const sandbox = new R();
		await sandbox.load({ r: { baseUrl: '/webr/test/' } });
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('R startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load(
				{ r: { baseUrl: '/webr/test/' } },
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active R startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new R();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('R startup aborted');
		const loading = sandbox.load(
			{ r: { baseUrl: '/webr/test/' } },
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		await expect(sandbox.load({ r: { baseUrl: '/webr/test/' } })).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'R'
		});
		await expect(sandbox.run('cat("too soon\\n")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'R'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();

		suppressAutoLoadAck = false;
		const settledController = new AbortController();
		await sandbox.load({ r: { baseUrl: '/webr/test/' } }, '', true, [], {
			signal: settledController.signal
		});
		const retryWorker = workerInstances.at(-1)!;
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late startup abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new R();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('readLines(stdin(), n = 1)', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
