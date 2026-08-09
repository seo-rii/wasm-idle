import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: '/runtime/typescript/index.js'
	}
}));
let autoResolveLoad = true;
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() => {
			if (message.load) {
				if (autoResolveLoad) this.resolveLoad();
				return;
			}
			if (autoResolveRun) this.resolveRun();
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	resolveLoad() {
		this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
	}

	resolveRun(result: boolean | string = true) {
		this.onmessage?.({ data: { results: result } } as MessageEvent<any>);
	}

	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/typescript?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TypeScriptSandbox from './typescript';
import { readBufferedStdin } from './stdinBuffer';

describe('TypeScript and JavaScript execution limits', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '/runtime/typescript/index.js';
		history.replaceState({}, '', '/editor');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('times out TypeScript startup and preserves a cleanup-started replacement', async () => {
		vi.useFakeTimers();
		autoResolveLoad = false;
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const controller = new AbortController();
		const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
		let abortRemovalCount = 0;
		let replacement: Promise<void> | undefined;
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
			(type, listener, options) => {
				originalRemove(type, listener, options);
				if (type !== 'abort') return;
				abortRemovalCount += 1;
				if (abortRemovalCount < 2 || replacement) return;
				autoResolveLoad = true;
				replacement = sandbox.load('/replacement/');
			}
		);
		const loading = sandbox.load('/assets/', '', true, [], {
			signal: controller.signal,
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'TYPESCRIPT',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('times out JavaScript execution, clears explicit stdin, and leaves a clean retry', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets/');
		const retiredWorker = workerInstances[0];
		autoResolveRun = false;
		vi.useFakeTimers();
		const running = sandbox.run('while (true) {}', false, true, undefined, [], {
			stdin: 'owned input\n',
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const staleHandler = retiredWorker.onmessage;
		sandbox.write('discarded input\n');
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'JAVASCRIPT',
			timeoutMs: 10
		});

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		staleHandler?.({
			data: { output: 'stale output', results: true }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		autoResolveLoad = true;
		autoResolveRun = true;
		await sandbox.load('/assets/');
		const replacementWorker = workerInstances[1];
		await expect(
			sandbox.run('console.log("ok")', false, true, undefined, [], {
				limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
			})
		).resolves.toBe(true);
		await vi.advanceTimersByTimeAsync(10);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('enforces the TypeScript UTF-8 output ceiling without an output callback', async () => {
		autoResolveRun = false;
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		await sandbox.load('/assets/');
		const worker = workerInstances[0];
		const running = sandbox.run('console.log("many bytes")', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'TYPESCRIPT',
			limit: 5,
			actual: 7
		});

		worker.emit({ output: 'abc' });
		worker.emit({ output: 'éé', results: true });
		await rejected;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
	});

	it('counts JavaScript diagnostics without a callback and suppresses a same-message result', async () => {
		autoResolveRun = false;
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await sandbox.load('/assets/');
		const worker = workerInstances[0];
		const running = sandbox.run('broken(', true, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'JAVASCRIPT',
			limit: 1,
			actual: 2
		});

		worker.emit({ diagnostic: { message: 'first' } });
		worker.emit({ diagnostic: { message: 'second' }, results: true });
		await rejected;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
	});

	it('preserves a replacement when a limit getter terminates the provisional run', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const terminationReason = new Error('replace TypeScript while reading limits');
		let replacement: Promise<void> | undefined;
		let staleLimitReads = 0;
		await sandbox.load('/assets/');
		const retiredWorker = workerInstances[0];
		const limits = Object.defineProperties(
			{},
			{
				assetTimeoutMs: {
					enumerable: true,
					get: () => {
						sandbox.terminate(terminationReason);
						replacement = sandbox.load('/replacement/');
						void replacement.catch(() => undefined);
						return 5;
					}
				},
				startupTimeoutMs: {
					enumerable: true,
					get: () => {
						staleLimitReads += 1;
						sandbox.terminate(new Error('stale limit getter reached replacement'));
						return 5;
					}
				}
			}
		);

		await expect(
			sandbox.run('superseded()', false, true, undefined, [], { limits })
		).rejects.toBe(terminationReason);
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(staleLimitReads).toBe(0);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('stops reading runtime asset getters after a replacement takes ownership', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const terminationReason = new Error('replace TypeScript while reading runtime assets');
		let replacement: Promise<void> | undefined;
		let staleAssetReads = 0;
		const runtimeAssets = Object.defineProperties(
			{},
			{
				typescript: {
					enumerable: true,
					get: () => {
						sandbox.terminate(terminationReason);
						replacement = sandbox.load('/replacement/');
						void replacement.catch(() => undefined);
						return Object.defineProperty({}, 'moduleUrl', {
							get: () => {
								staleAssetReads += 1;
								sandbox.terminate(
									new Error('stale module URL getter reached replacement')
								);
								return '/stale/index.js';
							}
						});
					}
				},
				rootUrl: {
					enumerable: true,
					get: () => {
						staleAssetReads += 1;
						return '/stale/';
					}
				}
			}
		);

		await expect(sandbox.load(runtimeAssets as never)).rejects.toBe(terminationReason);
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(staleAssetReads).toBe(0);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('reads an abort reason once before a cleanup-started replacement', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		const controller = new AbortController();
		const terminationReason = new Error('replace JavaScript while reading abort reason');
		let replacement: Promise<void> | undefined;
		let reasonReads = 0;
		await sandbox.load('/assets/');
		autoResolveRun = false;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get: () => {
				reasonReads += 1;
				if (reasonReads === 1) {
					sandbox.terminate(terminationReason);
					replacement = sandbox.load('/replacement/');
					void replacement.catch(() => undefined);
					return new Error('stale abort reason');
				}
				sandbox.terminate(new Error('abort reason read reached replacement'));
				return new Error('second stale abort reason');
			}
		});
		const running = sandbox.run('while (true) {}', false, true, undefined, [], {
			signal: controller.signal
		});

		controller.abort();

		await expect(running).rejects.toBe(terminationReason);
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(reasonReads).toBe(1);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('does not publish load progress after a message getter replaces the operation', async () => {
		autoResolveLoad = false;
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const progress = { set: vi.fn() };
		const terminationReason = new Error('replace TypeScript from load message');
		let replacement: Promise<void> | undefined;
		const loading = sandbox.load('/assets/', '', true, [], {}, progress);
		void loading.catch(() => undefined);
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const message = Object.defineProperty({}, 'load', {
			get: () => {
				sandbox.terminate(terminationReason);
				autoResolveLoad = true;
				replacement = sandbox.load('/replacement/');
				void replacement.catch(() => undefined);
				return true;
			}
		});

		retiredWorker.emit(message);

		await expect(loading).rejects.toBe(terminationReason);
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(progress.set).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('stops reading a run message after its first getter starts a replacement', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		const terminationReason = new Error('replace JavaScript from run message');
		let replacement: Promise<void> | undefined;
		let staleMessageReads = 0;
		await sandbox.load('/assets/');
		autoResolveRun = false;
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('while (true) {}', false, true);
		void running.catch(() => undefined);
		const message = Object.defineProperties(
			{},
			{
				buffer: {
					enumerable: true,
					get: () => {
						sandbox.terminate(terminationReason);
						replacement = sandbox.load('/replacement/');
						void replacement.catch(() => undefined);
						return true;
					}
				},
				progress: {
					enumerable: true,
					get: () => {
						staleMessageReads += 1;
						sandbox.terminate(new Error('stale message getter reached replacement'));
						return 1;
					}
				}
			}
		);

		retiredWorker.emit(message);

		await expect(running).rejects.toBe(terminationReason);
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(staleMessageReads).toBe(0);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});
});
