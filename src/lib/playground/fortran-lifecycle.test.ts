import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;
let loadDispatchError: unknown;
let runDispatchError: unknown;
let cachedLoadDispatchError: unknown;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load && loadDispatchError) throw loadDispatchError;
		if (!message.load && 'code' in message && runDispatchError) throw runDispatchError;
		if (!message.load && !('code' in message) && cachedLoadDispatchError) {
			throw cachedLoadDispatchError;
		}
		queueMicrotask(() => {
			if (message.load) {
				if (autoResolveLoad) this.resolveLoad();
				return;
			}
			if ('code' in message && autoResolveRun) this.resolveRun();
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

	rejectOperation(reason: unknown) {
		this.onmessage?.({ data: { error: reason } } as MessageEvent<any>);
	}

	reportScriptError(message = 'mock script failure') {
		this.onerror?.({ message } as ErrorEvent);
	}

	reportMessageError() {
		this.onmessageerror?.({ data: undefined } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/fortran?worker', () => ({
	default: MockWorker
}));

import Fortran from './fortran';
import { readBufferedStdin } from './stdinBuffer';

describe('Fortran worker lifecycle', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		loadDispatchError = undefined;
		runDispatchError = undefined;
		cachedLoadDispatchError = undefined;
	});

	it('aborts owned asset work before starting a replacement worker', async () => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		const progress = { set: vi.fn() };
		let loaderSignal: AbortSignal | undefined;
		let reportLoaderProgress: ((loaded: number, total?: number) => void) | undefined;
		let finishLoader: ((value: Uint8Array) => void) | undefined;
		let reentrantRun: Promise<boolean | string> | undefined;
		let workerDuringAbort: Worker | undefined;
		let bridgeDuringAbort: unknown;
		const loader = vi.fn(
			(request: {
				signal?: AbortSignal;
				reportProgress: (loaded: number, total?: number) => void;
			}) => {
				loaderSignal = request.signal;
				reportLoaderProgress = request.reportProgress;
				request.signal?.addEventListener(
					'abort',
					() => {
						workerDuringAbort = sandbox.worker;
						bridgeDuringAbort = sandbox.assetBridge;
						reentrantRun = sandbox.run('      END', false);
						void reentrantRun.catch(() => undefined);
					},
					{ once: true }
				);
				return new Promise<Uint8Array>((resolve) => {
					finishLoader = resolve;
				});
			}
		);
		const loadingOutcome = sandbox
			.load({ clang: { loader } }, '', true, [], {}, progress)
			.catch((error) => error);

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		retiredWorker.onmessage?.({
			data: { assetRequest: { id: 7, asset: 'bin/clang.wasm.gz' } }
		} as MessageEvent<any>);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		const progressCallsBeforeDisposal = progress.set.mock.calls.length;

		sandbox.terminate();
		autoResolveLoad = true;
		const retry = sandbox.load('/assets');

		await expect(loadingOutcome).resolves.toBe('Process terminated');
		await expect(reentrantRun).rejects.toBe('Worker not loaded');
		await expect(retry).resolves.toBeUndefined();
		expect(loaderSignal?.aborted).toBe(true);
		expect(workerDuringAbort).toBeUndefined();
		expect(bridgeDuringAbort).toBeNull();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);

		reportLoaderProgress?.(1, 1);
		finishLoader?.(new Uint8Array([1, 2, 3]));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(progress.set).toHaveBeenCalledTimes(progressCallsBeforeDisposal);
		expect(
			retiredWorker.postMessage.mock.calls.some(([message]) => message.assetResponse)
		).toBe(false);
		expect(
			workerInstances[1].postMessage.mock.calls.some(([message]) => message.assetResponse)
		).toBe(false);
	});

	it('rejects load and run overlap while startup keeps its handler', async () => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const handler = worker.onmessage;

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'FORTRAN'
		});
		await expect(sandbox.run('      END', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'FORTRAN'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
	});

	it('rejects run and load overlap while execution keeps its handler', async () => {
		autoResolveRun = false;
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('      END', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const handler = worker.onmessage;

		await expect(sandbox.run('      STOP', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'FORTRAN'
		});
		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'FORTRAN'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		worker.resolveRun('first result');
		await expect(running).resolves.toBe('first result');
	});

	it('settles a throwing startup progress callback and permits retry', async () => {
		const callbackError = new Error('Fortran startup progress failed');
		let throwProgress = true;
		const progress = {
			set: vi.fn(() => {
				if (throwProgress) throw callbackError;
			})
		};
		const sandbox = new Fortran();

		await expect(sandbox.load('/assets', '', true, [], {}, progress)).rejects.toBe(
			callbackError
		);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeNull();
		expect(sandbox.assetBridge).toBeNull();

		throwProgress = false;
		await expect(sandbox.load('/assets', '', true, [], {}, progress)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('preserves terminate-and-reload reentry when startup progress then throws', async () => {
		const callbackError = new Error('stale Fortran startup callback failed');
		const terminationReason = new Error('replace Fortran startup');
		const sandbox = new Fortran();
		let replacement: Promise<void> | undefined;
		let reenter = true;
		const progress = {
			set: vi.fn(() => {
				if (!reenter) return;
				reenter = false;
				sandbox.terminate(terminationReason);
				replacement = sandbox.load('/replacement');
				void replacement.catch(() => undefined);
				throw callbackError;
			})
		};

		const loading = sandbox.load('/assets', '', true, [], {}, progress);

		await expect(loading).rejects.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it.each(['output', 'progress'] as const)(
		'settles a throwing run %s callback, retires its worker, and permits retry',
		async (callbackKind) => {
			autoResolveRun = false;
			const callbackError = new Error(`Fortran ${callbackKind} callback failed`);
			let throwCallback = true;
			const output = vi.fn(() => {
				if (throwCallback && callbackKind === 'output') throw callbackError;
			});
			const progress = {
				set: vi.fn(() => {
					if (throwCallback && callbackKind === 'progress') throw callbackError;
				})
			};
			const sandbox = new Fortran();
			sandbox.output = output;
			await sandbox.load('/assets');
			const retiredWorker = workerInstances[0];
			const running = sandbox.run('      END', false, true, progress);
			const outcome = running.catch((error) => error);
			await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));
			const staleHandler = retiredWorker.onmessage;

			staleHandler?.({
				data:
					callbackKind === 'output'
						? { output: 'callback output', results: true }
						: { progress: 0.5 }
			} as MessageEvent<any>);

			await expect(outcome).resolves.toBe(callbackError);
			expect(retiredWorker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.assetBridge).toBeNull();

			throwCallback = false;
			autoResolveRun = true;
			await sandbox.load('/assets');
			const replacementWorker = workerInstances[1];
			staleHandler?.({ data: { output: 'stale', results: true } } as MessageEvent<any>);
			expect(replacementWorker.terminate).not.toHaveBeenCalled();
			await expect(sandbox.run('      END', false, true, progress)).resolves.toBe(true);
		}
	);

	it('preserves an abort-time replacement when an output callback then throws', async () => {
		autoResolveRun = false;
		const callbackError = new Error('stale Fortran output callback failed');
		const terminationReason = new Error('replace Fortran run');
		const sandbox = new Fortran();
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			sandbox.terminate(terminationReason);
			replacement = sandbox.load('/replacement');
			void replacement.catch(() => undefined);
			throw callbackError;
		};
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('      END', false);
		await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = retiredWorker.onmessage;

		staleHandler?.({
			data: { output: 'before replacement', results: true }
		} as MessageEvent<any>);

		await expect(running).rejects.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		expect(sandbox.worker).toBe(replacementWorker);
		staleHandler?.({ data: { output: 'late', results: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('releases operation ownership after synchronous load and run dispatch failures', async () => {
		const sandbox = new Fortran();
		const startupError = new Error('Fortran load dispatch failed');
		loadDispatchError = startupError;

		await expect(sandbox.load('/assets')).rejects.toBe(startupError);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		loadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		const worker = workerInstances[1];
		const cachedStartupError = new Error('Fortran cached load dispatch failed');
		cachedLoadDispatchError = cachedStartupError;
		await expect(sandbox.load('/assets')).rejects.toBe(cachedStartupError);
		expect(worker.terminate).toHaveBeenCalledOnce();

		cachedLoadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		const replacementWorker = workerInstances[2];
		const runError = new Error('Fortran run dispatch failed');
		runDispatchError = runError;
		await expect(sandbox.run('      END', false)).rejects.toBe(runError);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		runDispatchError = undefined;
		await expect(sandbox.run('      END', false)).resolves.toBe(true);
	});

	it.each([
		{
			kind: 'script error',
			report: (worker: MockWorker) => worker.reportScriptError('startup exploded'),
			reason: 'Fortran worker script error: startup exploded'
		},
		{
			kind: 'message error',
			report: (worker: MockWorker) => worker.reportMessageError(),
			reason: 'Fortran worker message deserialization failed'
		}
	])('releases startup ownership after a worker $kind', async ({ report, reason }) => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];

		report(retiredWorker);

		await expect(loading).rejects.toBe(reason);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		autoResolveLoad = true;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it('releases startup ownership before worker-error asset cleanup can reenter', async () => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		let replacement: Promise<void> | undefined;
		const loader = vi.fn((request: { signal?: AbortSignal }) => {
			request.signal?.addEventListener(
				'abort',
				() => {
					replacement = sandbox.load('/replacement');
					void replacement.catch(() => undefined);
				},
				{ once: true }
			);
			return new Promise<Uint8Array>(() => undefined);
		});
		const loading = sandbox.load({ clang: { loader } });
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		retiredWorker.onmessage?.({
			data: { assetRequest: { id: 9, asset: 'bin/clang.wasm.gz' } }
		} as MessageEvent<any>);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

		autoResolveLoad = true;
		retiredWorker.reportScriptError('startup cleanup exploded');

		await expect(loading).rejects.toBe('Fortran worker script error: startup cleanup exploded');
		await expect(replacement).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it.each([
		{
			kind: 'script error',
			report: (worker: MockWorker) => worker.reportScriptError('execution exploded'),
			reason: 'Fortran worker script error: execution exploded'
		},
		{
			kind: 'message error',
			report: (worker: MockWorker) => worker.reportMessageError(),
			reason: 'Fortran worker message deserialization failed'
		}
	])('releases execution ownership after a worker $kind', async ({ report, reason }) => {
		autoResolveRun = false;
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('      END', false);
		await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));

		report(retiredWorker);

		await expect(running).rejects.toBe(reason);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		autoResolveRun = true;
		await sandbox.load('/assets');
		await expect(sandbox.run('      END', false)).resolves.toBe(true);
	});

	it('accepts false as a completed worker result', async () => {
		autoResolveRun = false;
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('      END', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));

		worker.resolveRun(false);

		await expect(running).resolves.toBe(false);
		autoResolveRun = true;
		await expect(sandbox.run('      END', false)).resolves.toBe(true);
	});

	it('settles execution when caller argument iteration terminates reentrantly', async () => {
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const terminationReason = new Error('terminate while resolving Fortran arguments');
		const args = ['owned'];
		Object.defineProperty(args, Symbol.iterator, {
			value: function* () {
				sandbox.terminate(terminationReason);
				yield 'owned';
			}
		});

		const outcome = await Promise.race([
			sandbox.run('      END', false, true, undefined, args).catch((error) => error),
			new Promise((resolve) => setTimeout(() => resolve('still pending'), 25))
		]);

		expect(outcome).toBe('Worker not loaded');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('rejects pre-aborted operations without mutating the current worker', async () => {
		const sandbox = new Fortran();
		const startupController = new AbortController();
		const startupReason = new Error('Fortran startup pre-aborted');
		startupController.abort(startupReason);

		await expect(
			sandbox.load('/assets', '', true, [], { signal: startupController.signal })
		).rejects.toBe(startupReason);
		expect(workerInstances).toHaveLength(0);

		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const callCount = worker.postMessage.mock.calls.length;
		const runController = new AbortController();
		runController.abort(null);

		await expect(
			sandbox.run('      END', false, true, undefined, [], {
				signal: runController.signal
			})
		).rejects.toBeNull();
		expect(sandbox.worker).toBe(worker);
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledTimes(callCount);
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('cancels active startup and execution with exact reasons and clean retries', async () => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		const startupController = new AbortController();
		const startupReason = new Error('cancel Fortran startup');
		const loading = sandbox.load('/assets', '', true, [], {
			signal: startupController.signal
		});
		const loadingOutcome = loading.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		startupController.abort(startupReason);

		await expect(loadingOutcome).resolves.toBe(startupReason);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		autoResolveLoad = true;
		await sandbox.load('/assets');

		autoResolveRun = false;
		const runController = new AbortController();
		const running = sandbox.run('      END', false, true, undefined, [], {
			signal: runController.signal
		});
		const runningOutcome = running.catch((error) => error);
		const activeWorker = workerInstances[1];
		await vi.waitFor(() => expect(activeWorker.postMessage).toHaveBeenCalledTimes(2));

		runController.abort(null);

		await expect(runningOutcome).resolves.toBeNull();
		expect(activeWorker.terminate).toHaveBeenCalledOnce();
		autoResolveRun = true;
		await sandbox.load('/assets');
		await expect(sandbox.run('      END', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(3);
	});

	it('ignores a settled run signal while a replacement execution is active', async () => {
		autoResolveRun = false;
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const controller = new AbortController();
		const first = sandbox.run('      END', false, true, undefined, [], {
			signal: controller.signal
		});
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		worker.resolveRun();
		await expect(first).resolves.toBe(true);

		const second = sandbox.run('      STOP', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
		controller.abort(new Error('late Fortran abort'));
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.resolveRun('replacement result');
		await expect(second).resolves.toBe('replacement result');
	});

	it('enforces aggregate startup and execution deadlines and remains reusable', async () => {
		autoResolveLoad = false;
		const sandbox = new Fortran();
		const loading = sandbox.load('/assets', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 5 }
		});

		await expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'FORTRAN',
			timeoutMs: 10
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		autoResolveLoad = true;
		await sandbox.load('/assets');
		autoResolveRun = false;
		const activeWorker = workerInstances[1];
		const running = sandbox.run('      END', false, true, undefined, [], {
			limits: { compileTimeoutMs: 5, runTimeoutMs: 5 }
		});

		await expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'FORTRAN',
			timeoutMs: 10
		});
		expect(activeWorker.terminate).toHaveBeenCalledOnce();

		autoResolveRun = true;
		await sandbox.load('/assets');
		await expect(sandbox.run('      END', false)).resolves.toBe(true);
	});

	it('keeps explicit stdin authoritative and clears only its queued terminal input', async () => {
		autoResolveRun = false;
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		sandbox.write('stale input\n');
		sandbox.eof();
		const explicitRun = sandbox.run('      END', false, true, undefined, [], {
			stdin: 'fixed input\n'
		});
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const explicitHandler = worker.onmessage;

		explicitHandler?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('input during explicit run\n');
		worker.resolveRun();
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		const bufferedRun = sandbox.run('      END', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('fresh input\n');
		expect(readBufferedStdin(sandbox.buffer)).toBe('fresh input\n');
		worker.resolveRun();
		await expect(bufferedRun).resolves.toBe(true);
	});
});
