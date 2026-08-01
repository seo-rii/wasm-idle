import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_HASKELL_MODULE_URL: '',
		PUBLIC_WASM_HASKELL_ROOTFS_URL: '',
		PUBLIC_WASM_HASKELL_BSDTAR_URL: ''
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
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						progress: { percent: 100 },
						load: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						results: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					output: 'hello from haskell\n',
					diagnostic: {
						fileName: 'main.hs',
						lineNumber: 2,
						columnNumber: 1,
						severity: 'warning',
						message: 'demo warning'
					},
					results: true,
					buffer: true
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/haskell?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Haskell from './haskell';

describe('Haskell sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '/wasm-haskell/dyld.mjs';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '/wasm-haskell/rootfs.tar.zst';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '/wasm-haskell/bsdtar.wasm';
		suppressAutoLoadAck = false;
	});

	it('loads the Haskell worker and forwards prepare/run requests', async () => {
		const sandbox = new Haskell();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const progressValues: number[] = [];
		const code = 'main = putStrLn "hello"';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{},
			{
				set(value) {
					progressValues.push(value);
				}
			}
		);
		await expect(
			sandbox.run(code, true, true, undefined, ['-Wall'], {
				activePath: 'src/Main.hs',
				workspaceFiles: [{ path: 'src/Main.hs', content: code }]
			})
		).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['-Wall'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-haskell\/dyld\.mjs$/),
				rootfsUrl: expect.stringMatching(/\/wasm-haskell\/rootfs\.tar\.zst$/),
				bsdtarUrl: expect.stringMatching(/\/wasm-haskell\/bsdtar\.wasm$/),
				mainSoPath: '/tmp/libplayground001.so',
				searchDirs: expect.arrayContaining(['/tmp/clib'])
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				ghcArgs: '-Wall',
				activePath: 'src/Main.hs',
				workspaceFiles: [{ path: 'src/Main.hs', content: code }],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				ghcArgs: '-Wall',
				activePath: 'main.hs',
				log: true
			})
		);
		expect(progressValues).toContain(1);
		expect(outputs).toEqual(['hello from haskell\n']);
		expect(diagnostics).toEqual([
			{
				fileName: 'main.hs',
				lineNumber: 2,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('normalizes a valid Haskell workspace before worker dispatch', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('main = pure ()', false, true, undefined, [], {
				activePath: 'nested\\Main.hs',
				workspaceFiles: [{ path: 'fixtures\\Helper.hs', content: 'helper = 1' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/Main.hs',
				workspaceFiles: [{ path: 'fixtures/Helper.hs', content: 'helper = 1' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../Main.hs' },
			expected: { code: 'invalid-path', path: '../Main.hs' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/Main.hs' },
			expected: { code: 'invalid-path', path: '/tmp/Main.hs' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.hs' },
			expected: { code: 'invalid-path', path: 'bad\0.hs' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.hs', content: 'A' },
					{ path: 'data/module.hs', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.hs' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.hs', content: 'A' },
					{ path: 'data/module.hs', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.hs' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.hs', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.hs', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Haskell workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Haskell();
			await sandbox.load('/absproxy/5173');
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

	it('rejects an overlapping Haskell run without disturbing the active execution', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('main = putStrLn "first"', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('main = putStrLn "second"', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
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
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted Haskell run without changing worker state', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('Haskell pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('main = pure ()', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active Haskell run with its exact reason and permits a clean retry', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Haskell active abort');

		const running = sandbox.run('main = pure ()', false, true, progress, [], {
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
			sandbox.run('main = pure ()', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects overlapping Haskell startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
		});
		await expect(sandbox.run('main = pure ()', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		suppressAutoLoadAck = false;
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
	});

	it('rejects a pre-aborted Haskell startup without changing an existing worker', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('Haskell startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active Haskell startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Haskell startup aborted');
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { progress: 0.8, load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();

		suppressAutoLoadAck = false;
		const settledController = new AbortController();
		await sandbox.load('/absproxy/5173', '', true, [], {
			signal: settledController.signal
		});
		const retryWorker = workerInstances.at(-1)!;
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late startup abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects Haskell load while a run is active without replacing its handler', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('main = pure ()', false);
		const runHandler = worker.onmessage;
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(runHandler);

		runHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
	});

	it('releases Haskell run activity after synchronous dispatch failure', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		const dispatchError = new Error('Haskell dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchError;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('main = pure ()', false)).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
	});

	it('keeps Haskell execution idle when no worker is loaded', async () => {
		const sandbox = new Haskell();

		await expect(sandbox.run('main = pure ()', false)).rejects.toBe('Worker not loaded');
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
	});

	it('releases Haskell startup activity after termination', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		sandbox.terminate();
		await expect(loading).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledOnce();

		suppressAutoLoadAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
	});

	it('rejects load when Haskell assets are not configured', async () => {
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '';
		const sandbox = new Haskell();

		await expect(sandbox.load({})).rejects.toContain('Haskell runtime is not configured');
	});

	it('rejects load when the worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/haskell.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Haskell worker script error: worker script error (/worker/haskell.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Haskell();
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

		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
