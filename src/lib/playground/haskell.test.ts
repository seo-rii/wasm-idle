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
				workspaceFiles: [{ path: 'src/Helper.hs', content: 'helper = ()' }]
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
				workspaceFiles: [{ path: 'src/Helper.hs', content: 'helper = ()' }],
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

	it.each([
		{ stage: 'streamed', message: { progress: { percent: 50 } } },
		{ stage: 'ready', message: { load: true } }
	])(
		'retires the Haskell worker when the $stage progress callback throws',
		async ({ message }) => {
			suppressAutoLoadAck = true;
			const sandbox = new Haskell();
			const callbackError = new Error('Haskell startup progress failed');
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = {
				set: vi.fn(() => {
					throw callbackError;
				})
			};
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

			expect(() => staleHandler?.({ data: message } as MessageEvent<any>)).not.toThrow();
			await expect(loading).rejects.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			controller.abort(new Error('late failed startup abort'));
			staleHandler?.({ data: { load: true } } as MessageEvent<any>);
			expect(progress.set).toHaveBeenCalledOnce();

			suppressAutoLoadAck = false;
			await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('preserves a Haskell replacement after startup progress terminates and throws', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Haskell();
		const terminationReason = new Error('terminate Haskell startup progress');
		const callbackError = new Error('Haskell startup callback throw after termination');
		let replacement: Promise<void> | undefined;
		const loading = sandbox.load(
			'/cancelled/',
			'',
			true,
			[],
			{},
			{
				set() {
					sandbox.terminate(terminationReason);
					suppressAutoLoadAck = false;
					replacement = sandbox.load('/replacement/');
					throw callbackError;
				}
			}
		);
		await vi.dynamicImportSettled();
		const staleHandler = workerInstances[0].onmessage;

		expect(() =>
			staleHandler?.({ data: { progress: { percent: 50 } } } as MessageEvent<any>)
		).not.toThrow();
		await expect(loading).rejects.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps the active Haskell operation while callbacks attempt reentrant work', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('main = pure ()', false);
			reentrantLoad = sandbox.load('/replacement/');
		};

		const running = sandbox.run('main = putStrLn "active"', false);
		const handler = worker.onmessage;
		handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'HASKELL'
		});
		await expect(running).resolves.toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves a replacement after a Haskell callback terminates and throws', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const abortReason = new Error('Haskell callback abort');
		const callbackError = new Error('Haskell callback throw after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(abortReason);
			replacement = sandbox.load('/replacement/');
			throw callbackError;
		};
		const running = sandbox.run('main = pure ()', false, true, undefined, [], {
			stdin: 'fixed\n',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;

		expect(() =>
			staleHandler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>)
		).not.toThrow();
		await expect(outcome).resolves.toBe(abortReason);
		await expect(replacement).resolves.toBeUndefined();
		const replacementWorker = workerInstances.at(-1)!;
		const replacementHandler = replacementWorker.onmessage;
		sandbox.write('replacement input\n');
		sandbox.eof();

		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.onmessage).toBe(replacementHandler);
		expect(sandbox.pendingInput).toEqual(['replacement input\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it.each(['progress', 'output', 'diagnostic'] as const)(
		'rejects and retires the Haskell worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new Haskell();
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`Haskell ${callbackKind} callback failed`);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = {
				set: vi.fn(() => {
					if (callbackKind === 'progress') throw callbackError;
				})
			};
			const output = vi.fn(() => {
				if (callbackKind === 'output') throw callbackError;
			});
			const diagnostic = vi.fn(() => {
				if (callbackKind === 'diagnostic') throw callbackError;
			});
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnostic;

			const running = sandbox.run('main = pure ()', false, true, progress, [], {
				stdin: 'fixed\n',
				signal: controller.signal
			});
			const handler = worker.onmessage;
			sandbox.write('discard after explicit stdin\n');
			expect(() =>
				handler?.({
					data: {
						progress: 0.5,
						output: 'callback output\n',
						diagnostic: { message: 'callback diagnostic' },
						results: true
					}
				} as MessageEvent<any>)
			).not.toThrow();

			await expect(running).rejects.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBeNull();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			if (callbackKind === 'progress') {
				expect(output).not.toHaveBeenCalled();
				expect(diagnostic).not.toHaveBeenCalled();
			} else if (callbackKind === 'output') {
				expect(diagnostic).not.toHaveBeenCalled();
			}

			handler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
			sandbox.output = vi.fn();
			sandbox.oncompilerdiagnostic = vi.fn();
			await sandbox.load('/absproxy/5173');
			await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

	it('releases the Haskell operation after a normal worker error', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const runtimeError = new Error('Haskell worker execution failed');

		const running = sandbox.run('main = error "fail"', false);
		worker.onmessage?.({ data: { error: runtimeError } } as MessageEvent<any>);

		await expect(running).rejects.toBe(runtimeError);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.exit).toBe(true);

		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);
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
		let optionalReads = 0;
		const runtimeAssets = {
			haskell: {
				get mainSoPath(): never {
					optionalReads += 1;
					throw new Error('mainSoPath must remain unread');
				},
				get searchDirs(): never {
					optionalReads += 1;
					throw new Error('searchDirs must remain unread');
				}
			}
		};

		await expect(sandbox.load(runtimeAssets)).rejects.toContain(
			'Haskell runtime is not configured'
		);
		expect(optionalReads).toBe(0);
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

	it('clears queued input before an explicit Haskell stdin run', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		const runMessages: any[] = [];
		const bufferedValues: Array<string | null> = [];

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementation((message) => {
			runMessages.push(message);
			queueMicrotask(() => {
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				bufferedValues.push(readBufferedStdin(message.buffer));
				if (runMessages.length === 1) {
					sandbox.write('during\n');
					sandbox.eof();
				}
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		sandbox.write('stale\n');
		sandbox.eof();

		await expect(
			sandbox.run('main = pure ()', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('main = pure ()', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});

	it('does not stream terminal input into an explicit Haskell stdin run', async () => {
		const sandbox = new Haskell();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('main = pure ()', false, true, undefined, [], {
			stdin: 'authoritative\n'
		});
		const handler = worker.onmessage;
		sandbox.write('terminal input\n');
		handler?.({ data: { buffer: true } } as MessageEvent<any>);

		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(sandbox.pendingInput).toEqual(['terminal input\n']);
		handler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
	});

	it('preserves an exact null pre-abort reason without changing idle Haskell state', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const runtimeKey = sandbox.runtimeKey;
		const uid = sandbox.uid;
		sandbox.write('queued input\n');
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('main = pure ()', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBeNull();

		expect(sandbox.worker).toBe(worker);
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(sandbox.runtimeKey).toBe(runtimeKey);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
	});

	it('preserves replacement startup when the outer signal getter terminates Haskell', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Haskell during startup option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement');
				return undefined;
			}
		};

		const superseded = sandbox.load('/outer', '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves the first cancellation and replacement across later Haskell option failure', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Haskell during execution option snapshot');
		const laterError = new Error('later Haskell workspace getter failed');
		let replacement: Promise<void> | undefined;
		const options = {
			get limits() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement');
				return undefined;
			},
			get workspaceFiles(): never {
				throw laterError;
			}
		};

		const superseded = sandbox.run('main = pure ()', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves a Haskell replacement when a later option getter aborts the snapshot', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('abort Haskell during execution option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			signal: controller.signal,
			get limits() {
				controller.abort(reason);
				replacement = sandbox.load({
					haskell: {
						moduleUrl: '/replacement/dyld.mjs',
						rootfsUrl: '/replacement/rootfs.tar.zst',
						bsdtarUrl: '/replacement/bsdtar.wasm'
					}
				});
				return undefined;
			}
		};

		const superseded = sandbox.run('main = pure ()', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('snapshots each Haskell runtime asset once before asynchronous startup', async () => {
		const sandbox = new Haskell();
		const reads = {
			rootUrl: 0,
			haskell: 0,
			moduleUrl: 0,
			rootfsUrl: 0,
			bsdtarUrl: 0,
			mainSoPath: 0,
			searchDirs: 0
		};
		const configuredSearchDirs = ['/snapshot/lib'];
		const runtimeConfig = {
			get moduleUrl() {
				reads.moduleUrl += 1;
				return '/snapshot/dyld.mjs';
			},
			get rootfsUrl() {
				reads.rootfsUrl += 1;
				return '/snapshot/rootfs.tar.zst';
			},
			get bsdtarUrl() {
				reads.bsdtarUrl += 1;
				return '/snapshot/bsdtar.wasm';
			},
			get mainSoPath() {
				reads.mainSoPath += 1;
				return '/snapshot/main.so';
			},
			get searchDirs() {
				reads.searchDirs += 1;
				queueMicrotask(() => configuredSearchDirs.push('/mutated/lib'));
				return configuredSearchDirs;
			}
		};
		const runtimeAssets = {
			get rootUrl() {
				reads.rootUrl += 1;
				return '/snapshot-root';
			},
			get haskell() {
				reads.haskell += 1;
				return runtimeConfig;
			}
		};

		await sandbox.load(runtimeAssets);

		const loadMessage = workerInstances[0].postMessage.mock.calls[0][0];
		const runtimeSnapshot = {
			moduleUrl: loadMessage.moduleUrl,
			rootfsUrl: loadMessage.rootfsUrl,
			bsdtarUrl: loadMessage.bsdtarUrl,
			mainSoPath: loadMessage.mainSoPath,
			searchDirs: loadMessage.searchDirs
		};
		expect(reads).toEqual({
			rootUrl: 0,
			haskell: 1,
			moduleUrl: 1,
			rootfsUrl: 1,
			bsdtarUrl: 1,
			mainSoPath: 1,
			searchDirs: 1
		});
		expect(runtimeSnapshot.searchDirs).toEqual(['/snapshot/lib']);
		expect(configuredSearchDirs).toEqual(['/snapshot/lib', '/mutated/lib']);
		expect(JSON.parse(sandbox.runtimeKey)).toEqual(runtimeSnapshot);
	});

	it('reads the Haskell root URL once when runtime assets use fallback resolution', async () => {
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '';
		const sandbox = new Haskell();
		let rootUrlReads = 0;
		const runtimeAssets = {
			get rootUrl() {
				rootUrlReads += 1;
				return '/fallback';
			}
		};

		await sandbox.load(runtimeAssets);

		expect(rootUrlReads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				moduleUrl: expect.stringMatching(/\/fallback\/wasm-haskell\/dyld\.mjs$/),
				rootfsUrl: expect.stringMatching(/\/fallback\/wasm-haskell\/rootfs\.tar\.zst$/),
				bsdtarUrl: expect.stringMatching(/\/fallback\/wasm-haskell\/bsdtar\.wasm$/)
			})
		);
	});

	it('ignores resolved Haskell assets after the resolver starts a replacement', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Haskell while resolving assets');
		let replacement: Promise<void> | undefined;
		const runtimeAssets = {
			haskell: {
				get moduleUrl() {
					sandbox.terminate(reason);
					replacement = sandbox.load({
						haskell: {
							moduleUrl: '/replacement/dyld.mjs',
							rootfsUrl: '/replacement/rootfs.tar.zst',
							bsdtarUrl: '/replacement/bsdtar.wasm'
						}
					});
					return '/superseded/dyld.mjs';
				},
				rootfsUrl: '/superseded/rootfs.tar.zst',
				bsdtarUrl: '/superseded/bsdtar.wasm'
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(JSON.parse(sandbox.runtimeKey)).toMatchObject({
			moduleUrl: expect.stringMatching(/\/replacement\/dyld\.mjs$/),
			rootfsUrl: expect.stringMatching(/\/replacement\/rootfs\.tar\.zst$/),
			bsdtarUrl: expect.stringMatching(/\/replacement\/bsdtar\.wasm$/)
		});
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('ignores a Haskell runtime key after serialization starts a replacement', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Haskell while serializing the runtime key');
		let replacement: Promise<void> | undefined;
		const reentrantSearchDir = {
			toJSON() {
				sandbox.terminate(reason);
				replacement = sandbox.load({
					haskell: {
						moduleUrl: '/replacement/dyld.mjs',
						rootfsUrl: '/replacement/rootfs.tar.zst',
						bsdtarUrl: '/replacement/bsdtar.wasm'
					}
				});
				return '/superseded/lib';
			}
		};
		const runtimeAssets = {
			haskell: {
				moduleUrl: '/superseded/dyld.mjs',
				rootfsUrl: '/superseded/rootfs.tar.zst',
				bsdtarUrl: '/superseded/bsdtar.wasm',
				searchDirs: [reentrantSearchDir as unknown as string]
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(JSON.parse(sandbox.runtimeKey)).toMatchObject({
			moduleUrl: expect.stringMatching(/\/replacement\/dyld\.mjs$/)
		});
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('reads explicit Haskell stdin once and preserves compile argument precedence', async () => {
		const sandbox = new Haskell();
		await sandbox.load('/absproxy/5173');
		let reads = 0;
		const options = {
			compileArgs: ['-O2', '-Wall'],
			programArgs: ['ignored-program-arg'],
			get stdin() {
				reads += 1;
				if (reads > 1) throw new Error('Haskell stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('main = pure ()', false, true, undefined, ['ignored-legacy-arg'], options)
		).resolves.toBe(true);

		expect(reads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				ghcArgs: '-O2 -Wall',
				stdin: 'captured input\n'
			})
		);
	});
});
