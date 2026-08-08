import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_LUA_MODULE_URL: ''
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
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.lua',
							lineNumber: 1,
							columnNumber: 2,
							severity: 'warning',
							message: 'demo warning'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
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

vi.mock('$lib/playground/worker/lua?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Lua from './lua';

describe('Lua sandbox', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_LUA_MODULE_URL = '/wasm-lua/index.js';
		suppressAutoLoadAck = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the Lua worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Lua();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = 'print("factorial_plus_bonus=27")';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.lua',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-lua\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.lua',
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
				activePath: 'main.lua',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.lua',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('normalizes a valid Lua workspace before worker dispatch', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('main()', false, true, undefined, [], {
				activePath: 'nested\\main.lua',
				workspaceFiles: [{ path: 'fixtures\\helper.lua', content: 'return {}' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.lua',
				workspaceFiles: [{ path: 'fixtures/helper.lua', content: 'return {}' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.lua' },
			expected: { code: 'invalid-path', path: '../main.lua' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.lua' },
			expected: { code: 'invalid-path', path: '/tmp/main.lua' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.lua' },
			expected: { code: 'invalid-path', path: 'bad\0.lua' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.lua', content: 'A' },
					{ path: 'data/module.lua', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.lua' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.lua', content: 'A' },
					{ path: 'data/module.lua', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.lua' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.lua', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.lua', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Lua workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Lua();
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

	it('rejects an overlapping run without disturbing the active Lua execution', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('print("first")', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('print("second")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LUA'
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
		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('clears queued input before an explicit Lua stdin run', async () => {
		const sandbox = new Lua();
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
			sandbox.run('print("explicit")', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('print("buffered")', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});

	it('does not stream terminal input into an explicit Lua stdin run', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('print("explicit")', false, true, undefined, [], {
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

	it('rejects a pre-aborted Lua run without changing worker state', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('Lua pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('print("cancelled")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active Lua run with its exact reason and permits a clean retry', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Lua active abort');

		const running = sandbox.run('print("pending")', false, true, undefined, [], {
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
			data: { output: 'late\n', results: true }
		} as MessageEvent<any>);
		expect(outputs).toEqual([]);

		await sandbox.load('/absproxy/5173');
		const retryWorker = workerInstances.at(-1)!;
		const settledController = new AbortController();
		await expect(
			sandbox.run('print("retry")', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('releases Lua run activity after synchronous dispatch failure', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		const dispatchFailure = new Error('Lua dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchFailure;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('print("fail")', false)).rejects.toBe(dispatchFailure);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
	});

	it('rejects load when no Lua module url is configured', async () => {
		publicEnv.PUBLIC_WASM_LUA_MODULE_URL = '';
		const sandbox = new Lua();

		await expect(sandbox.load({})).rejects.toContain('Lua runtime is not configured');
	});

	it('rejects a pre-aborted Lua startup without changing an existing worker', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('Lua startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active Lua startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lua();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Lua startup aborted');
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

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LUA'
		});
		await expect(sandbox.run('print("too soon")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LUA'
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
		await sandbox.load('/absproxy/5173', '', true, [], {
			signal: settledController.signal
		});
		const retryWorker = workerInstances.at(-1)!;
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late startup abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('retires the Lua worker when the ready progress callback throws', async () => {
		const sandbox = new Lua();
		const callbackError = new Error('Lua startup progress failed');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await expect(
			sandbox.load(
				'/absproxy/5173',
				'',
				true,
				[],
				{ signal: controller.signal },
				{
					set() {
						throw callbackError;
					}
				}
			)
		).rejects.toBe(callbackError);

		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		controller.abort(new Error('late failed startup abort'));

		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('keeps the active Lua operation while callbacks attempt reentrant work', async () => {
		const sandbox = new Lua();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('print("reentrant")', false);
			reentrantLoad = sandbox.load('/replacement/');
		};

		const running = sandbox.run('print("first")', false);
		const handler = worker.onmessage;
		handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LUA'
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LUA'
		});
		await expect(running).resolves.toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves a replacement after a Lua callback terminates and throws', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementation(() => undefined);
		const controller = new AbortController();
		const abortReason = new Error('Lua callback abort');
		const callbackError = new Error('Lua callback throw after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(abortReason);
			replacement = sandbox.load('/replacement/');
			throw callbackError;
		};
		const running = sandbox.run('print("first")', false, true, undefined, [], {
			stdin: 'fixed\n',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;

		expect(() =>
			staleHandler?.({
				data: { output: 'trigger\n', results: true }
			} as MessageEvent<any>)
		).not.toThrow();
		await expect(outcome).resolves.toBe(abortReason);
		await expect(replacement).resolves.toBeUndefined();
		const replacementWorker = workerInstances[1];
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
		'rejects and retires the Lua worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new Lua();
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`Lua ${callbackKind} callback failed`);
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

			const running = sandbox.run('print("first")', false, true, progress, [], {
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
			await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

	it('rejects load when the Lua worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lua();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/lua.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Lua worker script error: worker script error (/worker/lua.js:8:2)'
		);
	});

	it('preserves an exact null pre-abort reason without changing idle Lua state', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const moduleUrl = sandbox.moduleUrl;
		const uid = sandbox.uid;
		sandbox.write('queued input\n');
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('print("cancelled")', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBeNull();

		expect(sandbox.worker).toBe(worker);
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(sandbox.moduleUrl).toBe(moduleUrl);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
	});

	it('preserves replacement startup when the outer signal getter terminates Lua', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lua during startup option snapshot');
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

	it('preserves the first cancellation and replacement across later Lua option failure', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lua during execution option snapshot');
		const laterError = new Error('later Lua workspace getter failed');
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

		const superseded = sandbox.run('print("outer")', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('reads explicit Lua stdin once before worker dispatch', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		let reads = 0;
		const options = {
			get stdin() {
				reads += 1;
				if (reads > 1) throw new Error('Lua stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('print("captured")', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect(reads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ stdin: 'captured input\n' })
		);
	});

	it('enforces the aggregate Lua startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new Lua();
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'LUA',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate Lua execution deadline and permits a clean retry', async () => {
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		retiredWorker.postMessage.mockImplementationOnce(() => undefined);
		vi.useFakeTimers();
		const running = sandbox.run('print("timeout")', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'LUA',
			timeoutMs: 10
		});
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('clears settled Lua deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new Lua();
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('print("settled")', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
	});
});
