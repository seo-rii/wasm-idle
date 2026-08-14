import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_LISP_MODULE_URL: '',
		PUBLIC_WASM_LISP_MANIFEST_URL: '',
		PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT: ''
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
							fileName: 'main.scm',
							lineNumber: 1,
							columnNumber: 2,
							severity: 'warning',
							message: 'demo warning'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'scheme\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/lisp?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Lisp from './lisp';

describe('Lisp sandbox', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = '/wasm-lisp/index.js';
		publicEnv.PUBLIC_WASM_LISP_MANIFEST_URL = '';
		publicEnv.PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT = 'a'.repeat(64);
		suppressAutoLoadAck = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the Lisp worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Lisp();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = '(display "scheme") (newline)';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['alpha'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				runtimeConfig: expect.objectContaining({
					moduleUrl: expect.stringMatching(/\/wasm-lisp\/index\.js$/),
					manifestUrl: expect.stringMatching(/\/wasm-lisp\/runtime-manifest\.v2\.json$/),
					manifestFingerprint: 'a'.repeat(64)
				})
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				activePath: 'main.scm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['alpha'],
				activePath: 'main.scm',
				log: true
			})
		);
		expect(outputs).toContain('scheme\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.scm',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('terminates Lisp output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new Lisp();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('(display "bounded")', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = worker.onmessage;

		staleHandler?.({ data: { output: 'é' } } as MessageEvent<any>);
		staleHandler?.({ data: { output: '🙂' } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'LISP',
			actual: 6,
			limit: 5
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('é');
		expect(output).not.toHaveBeenCalledWith('🙂');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale\n');

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('terminates Lisp diagnostics before exceeding the message limit', async () => {
		const sandbox = new Lisp();
		const oncompilerdiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('(display "bounded")', true, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});
		const staleHandler = worker.onmessage;
		const diagnostic = {
			fileName: 'main.scm',
			lineNumber: 1,
			columnNumber: 2,
			severity: 'warning',
			message: 'bounded warning'
		};

		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);
		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'LISP',
			actual: 2,
			limit: 1
		});
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
		expect(oncompilerdiagnostic).toHaveBeenCalledWith(diagnostic);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { diagnostic, results: true } } as MessageEvent<any>);
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
	});

	it('normalizes a valid Lisp workspace before worker dispatch', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('(display "main")', false, true, undefined, [], {
				activePath: 'nested\\main.scm',
				workspaceFiles: [{ path: 'fixtures\\helper.scm', content: '(define helper 1)' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.scm',
				workspaceFiles: [{ path: 'fixtures/helper.scm', content: '(define helper 1)' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.scm' },
			expected: { code: 'invalid-path', path: '../main.scm' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.scm' },
			expected: { code: 'invalid-path', path: '/tmp/main.scm' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.scm' },
			expected: { code: 'invalid-path', path: 'bad\0.scm' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.scm', content: 'A' },
					{ path: 'data/module.scm', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.scm' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.scm', content: 'A' },
					{ path: 'data/module.scm', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.scm' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.scm', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.scm', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Lisp workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Lisp();
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

	it('rejects an overlapping Lisp run without disturbing the active execution', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('(display "first")', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('(display "second")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
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
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted Lisp run without changing worker state', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('Lisp pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('(display "blocked")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active Lisp run with its exact reason and permits a clean retry', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Lisp active abort');

		const running = sandbox.run('(display "active")', false, true, progress, [], {
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
			sandbox.run('(display "retry")', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects overlapping Lisp startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
		});
		await expect(sandbox.run('(display "blocked")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		suppressAutoLoadAck = false;
		await expect(sandbox.run('(display "ready")', false)).resolves.toBe(true);
	});

	it('rejects a pre-aborted Lisp startup without changing an existing worker', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('Lisp startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active Lisp startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Lisp startup aborted');
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

	it('retires the Lisp worker when the ready progress callback throws', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const callbackError = new Error('Lisp startup progress failed');
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

		expect(() => staleHandler?.({ data: { load: true } } as MessageEvent<any>)).not.toThrow();
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
	});

	it('preserves a Lisp replacement after startup progress terminates and throws', async () => {
		const sandbox = new Lisp();
		const terminationReason = new Error('terminate Lisp startup progress');
		const callbackError = new Error('Lisp startup callback throw after termination');
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
					replacement = sandbox.load('/replacement/');
					throw callbackError;
				}
			}
		);
		const outcome = loading.catch((error) => error);

		await expect(outcome).resolves.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps the active Lisp operation while callbacks attempt reentrant work', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('(display "nested")', false);
			reentrantLoad = sandbox.load('/replacement/');
		};

		const running = sandbox.run('(display "active")', false);
		const handler = worker.onmessage;
		handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
		});
		await expect(running).resolves.toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves a replacement after a Lisp callback terminates and throws', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const abortReason = new Error('Lisp callback abort');
		const callbackError = new Error('Lisp callback throw after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(abortReason);
			replacement = sandbox.load('/replacement/');
			throw callbackError;
		};
		const running = sandbox.run('(display "active")', false, true, undefined, [], {
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
		'rejects and retires the Lisp worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new Lisp();
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`Lisp ${callbackKind} callback failed`);
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

			const running = sandbox.run('(display "active")', false, true, progress, [], {
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
			await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

	it('releases the Lisp operation after a normal worker error', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const runtimeError = new Error('Lisp worker execution failed');

		const running = sandbox.run('(error "fail")', false);
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
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
	});

	it('rejects Lisp load while a run is active without replacing its handler', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('(display "active")', false);
		const runHandler = worker.onmessage;
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'LISP'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(runHandler);

		runHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
	});

	it('releases Lisp run activity after synchronous dispatch failure', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		const dispatchError = new Error('Lisp dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchError;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('(display "fail")', false)).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
	});

	it('keeps Lisp execution idle when no worker is loaded', async () => {
		const sandbox = new Lisp();

		await expect(sandbox.run('(display "missing")', false)).rejects.toBe('Worker not loaded');
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('(display "ready")', false)).resolves.toBe(true);
	});

	it('releases Lisp startup activity after termination', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		sandbox.terminate();
		await expect(loading).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledOnce();

		suppressAutoLoadAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
	});

	it('rejects load when no Lisp module url is configured', async () => {
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = '';
		const sandbox = new Lisp();

		await expect(sandbox.load({})).rejects.toContain('Lisp runtime is not configured');
	});

	it('rejects load when the Lisp worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/lisp.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Lisp worker script error: worker script error (/worker/lisp.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Lisp();
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

		await expect(sandbox.run('(display "hi")', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('clears queued input before an explicit Lisp stdin run', async () => {
		const sandbox = new Lisp();
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
			sandbox.run('(display "explicit")', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('(display "buffered")', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});

	it('does not stream terminal input into an explicit Lisp stdin run', async () => {
		const sandbox = new Lisp();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('(display "explicit")', false, true, undefined, [], {
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

	it('preserves an exact null pre-abort reason without changing idle Lisp state', async () => {
		const sandbox = new Lisp();
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
			sandbox.run('(display "blocked")', false, true, undefined, [], {
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

	it('preserves replacement startup when the outer signal getter terminates Lisp', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lisp during startup option snapshot');
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

	it('preserves the first cancellation and replacement across later Lisp option failure', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lisp during execution option snapshot');
		const laterError = new Error('later Lisp workspace getter failed');
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

		const superseded = sandbox.run('(display "outer")', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves a Lisp replacement when a later option getter aborts the snapshot', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('abort Lisp during execution option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			signal: controller.signal,
			get limits() {
				controller.abort(reason);
				replacement = sandbox.load({
					lisp: {
						moduleUrl: '/replacement/index.js',
						manifestFingerprint: 'b'.repeat(64)
					}
				});
				return undefined;
			}
		};

		const superseded = sandbox.run('(display "outer")', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves replacement startup across a reentrant Lisp asset resolver failure', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lisp during module resolution');
		const resolverError = new Error('later Lisp module resolver failure');
		let replacement: Promise<void> | undefined;
		const runtimeAssets = {
			lisp: {
				get moduleUrl(): never {
					sandbox.terminate(reason);
					replacement = sandbox.load('/replacement');
					throw resolverError;
				}
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('ignores a resolved Lisp asset URL after the resolver starts a replacement', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Lisp while resolving a module URL');
		let replacement: Promise<void> | undefined;
		const runtimeAssets = {
			lisp: {
				get moduleUrl() {
					sandbox.terminate(reason);
					replacement = sandbox.load({
						lisp: {
							moduleUrl: '/replacement/index.js',
							manifestFingerprint: 'b'.repeat(64)
						}
					});
					return '/superseded/index.js';
				}
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(sandbox.moduleUrl).toMatch(/\/replacement\/index\.js$/);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('reads explicit Lisp stdin once before worker dispatch', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		let reads = 0;
		const options = {
			get stdin() {
				reads += 1;
				if (reads > 1) throw new Error('Lisp stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('(display "captured")', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect(reads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ stdin: 'captured input\n' })
		);
	});

	it('enforces the aggregate Lisp startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'LISP',
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

	it('enforces the aggregate Lisp execution deadline and permits a clean retry', async () => {
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		retiredWorker.postMessage.mockImplementationOnce(() => undefined);
		vi.useFakeTimers();
		const running = sandbox.run('(display "timeout")', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'LISP',
			timeoutMs: 10
		});
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('clears settled Lisp deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new Lisp();
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('(display "settled")', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		await expect(sandbox.run('(display "retry")', false)).resolves.toBe(true);
	});

	it('keeps clear reusable but disposes an idle Lisp runtime exactly once', async () => {
		const sandbox = new Lisp();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('(display "reusable")', false)).resolves.toBe(true);
		sandbox.write('queued input\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.pendingEof).toBe(true);

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				worker: sandbox.worker,
				moduleUrl: sandbox.moduleUrl,
				runtimeConfigKey: Reflect.get(sandbox, 'runtimeConfigKey'),
				output: sandbox.output,
				diagnostic: sandbox.oncompilerdiagnostic,
				pendingInput: [...sandbox.pendingInput],
				waitingForInput: sandbox.waitingForInput,
				pendingEof: sandbox.pendingEof,
				bufferedInput: readBufferedStdin(sandbox.buffer)
			};
			reentrantLoad = sandbox.load('/reentrant');
			reentrantDisposal = sandbox.dispose();
		});
		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		const reentrantLoadResult = expect(reentrantLoad!).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'LISP'
		});
		await firstDisposal;
		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			moduleUrl: '',
			runtimeConfigKey: '',
			output: null,
			diagnostic: undefined,
			pendingInput: [],
			waitingForInput: false,
			pendingEof: false,
			bufferedInput: ''
		});
		await reentrantLoadResult;

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.moduleUrl).toBe('');
		expect(Reflect.get(sandbox, 'runtimeConfigKey')).toBe('');
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'LISP'
		});
		await expect(sandbox.run('(display "unavailable")', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'LISP'
		});
		sandbox.write('ignored input\n');
		sandbox.eof();
		sandbox.terminate();
		await sandbox.clear();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles active Lisp startup with one stable disposal cancellation', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Lisp();
		const loading = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		const cancellation = await loading.catch((error) => error);
		await firstDisposal;

		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'LISP',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.moduleUrl).toBe('');
		expect(Reflect.get(sandbox, 'runtimeConfigKey')).toBe('');
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active Lisp run, clears stdin, and ignores retained messages after disposal', async () => {
		const sandbox = new Lisp();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('(display "active")', false);
		const staleHandler = worker.onmessage;
		const cancellation = running.catch((error) => error);
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('active input\n');
		sandbox.eof();
		expect(readBufferedStdin(sandbox.buffer)).toBe('active input\n');
		expect(sandbox.pendingEof).toBe(true);

		await sandbox.dispose();
		await expect(cancellation).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'LISP',
			recoverable: false
		});

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.waitingForInput).toBe(false);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		staleHandler?.({
			data: {
				buffer: true,
				output: 'late output',
				diagnostic: { lineNumber: 1, severity: 'error', message: 'late diagnostic' },
				results: 'late result'
			}
		} as MessageEvent<any>);
		await Promise.resolve();
		expect(output).not.toHaveBeenCalled();
		expect(diagnostic).not.toHaveBeenCalled();
		expect(sandbox.waitingForInput).toBe(false);
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();
	});
});
