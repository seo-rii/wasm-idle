import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRubyRuntimeTestPreflightPayload } from './rubyTestPreflight';

const preflightMocks = vi.hoisted(() => ({
	preflightVerifiedRubyRuntimeAssets: vi.fn()
}));

vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rubyAssets')>()),
	preflightVerifiedRubyRuntimeAssets: preflightMocks.preflightVerifiedRubyRuntimeAssets
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
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

vi.mock('$lib/playground/worker/ruby?worker', () => ({
	default: MockWorker
}));

import type { SandboxExecutionOptions } from './options';
import Ruby from './ruby';

describe('Ruby cancellation and timeout contract', () => {
	beforeEach(() => {
		vi.useRealTimers();
		preflightMocks.preflightVerifiedRubyRuntimeAssets
			.mockReset()
			.mockImplementation(async () => createRubyRuntimeTestPreflightPayload());
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('rejects pre-aborted startup without creating or mutating a worker', async () => {
		const sandbox = new Ruby();
		const controller = new AbortController();
		const reason = new Error('cancel Ruby before startup');
		controller.abort(reason);

		await expect(
			sandbox.load('/assets', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('preserves an existing idle worker when a replacement startup is pre-aborted', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		const controller = new AbortController();
		const reason = new Error('cancel Ruby replacement startup');
		controller.abort(reason);

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(1);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(loadHandler);
		expect(sandbox.worker).toBe(worker);
	});

	it('rejects a pre-aborted run with its exact null reason and preserves queued input', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		const uid = sandbox.uid;
		sandbox.write('queued terminal input\n');
		sandbox.eof();
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.run('puts 1', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBeNull();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual(['queued terminal input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
	});

	it('aborts active startup with the exact reason and ignores late readiness', async () => {
		autoResolveLoad = false;
		const sandbox = new Ruby();
		const controller = new AbortController();
		const reason = new Error('cancel active Ruby startup');
		const loading = sandbox.load('/assets', '', true, [], { signal: controller.signal });
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		autoResolveLoad = true;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('aborts a pending preflight before worker construction and requires a fresh retry', async () => {
		const sandbox = new Ruby();
		const controller = new AbortController();
		const reason = new Error('cancel Ruby asset preflight');
		let preflightSignal: AbortSignal | undefined;
		preflightMocks.preflightVerifiedRubyRuntimeAssets.mockImplementationOnce(
			async (_config, options) =>
				await new Promise((_, reject) => {
					preflightSignal = options.signal;
					options.signal?.addEventListener(
						'abort',
						() => reject(options.signal?.reason),
						{
							once: true
						}
					);
				})
		);

		const loading = sandbox.load('/assets', '', true, [], { signal: controller.signal });
		await vi.waitFor(() =>
			expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce()
		);
		expect(workerInstances).toHaveLength(0);

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(preflightSignal?.aborted).toBe(true);
		expect(preflightSignal?.reason).toBe(reason);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(workerInstances).toHaveLength(1);
	});

	it('clear aborts pending preflight siblings and leaves a clean retry path', async () => {
		const sandbox = new Ruby();
		let preflightSignal: AbortSignal | undefined;
		preflightMocks.preflightVerifiedRubyRuntimeAssets.mockImplementationOnce(
			async (_config, options) =>
				await new Promise((_, reject) => {
					preflightSignal = options.signal;
					options.signal?.addEventListener(
						'abort',
						() => reject(options.signal?.reason),
						{
							once: true
						}
					);
				})
		);

		const loading = sandbox.load('/assets');
		await vi.waitFor(() =>
			expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce()
		);
		await sandbox.clear();

		await expect(loading).rejects.toBe('Process terminated');
		expect(preflightSignal?.aborted).toBe(true);
		expect(preflightSignal?.reason).toBe('Process terminated');
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(workerInstances).toHaveLength(1);
	});

	it('rejects failed preflight with zero workers and retries from fresh bytes', async () => {
		const sandbox = new Ruby();
		const integrityError = new Error('Ruby preflight integrity rejected');
		preflightMocks.preflightVerifiedRubyRuntimeAssets.mockRejectedValueOnce(integrityError);

		await expect(sandbox.load('/assets')).rejects.toBe(integrityError);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(preflightMocks.preflightVerifiedRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(workerInstances).toHaveLength(1);
	});

	it('times out startup at the aggregate asset and startup deadline', async () => {
		vi.useFakeTimers();
		autoResolveLoad = false;
		const sandbox = new Ruby();
		const loading = sandbox.load('/assets', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'RUBY',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		expect(workerInstances).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		const retry = sandbox.load('/assets');
		await vi.dynamicImportSettled();
		workerInstances[1].resolveLoad();
		await expect(retry).resolves.toBeUndefined();
	});

	it('aborts an active run and permits a clean retry', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('cancel active Ruby run');
		const running = sandbox.run('puts 1', false, true, undefined, [], {
			signal: controller.signal
		});
		const staleHandler = worker.onmessage;

		controller.abort(reason);
		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		autoResolveRun = true;
		await sandbox.load('/assets');
		await expect(sandbox.run('puts 2', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('times out execution at the aggregate compile and run deadline', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		autoResolveRun = false;
		vi.useFakeTimers();
		const running = sandbox.run('puts 1', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'RUBY',
			timeoutMs: 10
		});

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(worker.terminate).toHaveBeenCalledOnce();

		vi.useRealTimers();
		autoResolveRun = true;
		await sandbox.load('/assets');
		await expect(sandbox.run('puts 2', false)).resolves.toBe(true);
	});

	it('removes lifecycle listeners so late aborts cannot retire an idle worker', async () => {
		const sandbox = new Ruby();
		const startupController = new AbortController();
		const removeStartupListener = vi.spyOn(startupController.signal, 'removeEventListener');
		await sandbox.load('/assets', '', true, [], { signal: startupController.signal });
		const worker = workerInstances[0];
		expect(removeStartupListener).toHaveBeenCalled();

		startupController.abort(new Error('late startup abort'));
		expect(worker.terminate).not.toHaveBeenCalled();

		const runController = new AbortController();
		const removeRunListener = vi.spyOn(runController.signal, 'removeEventListener');
		await expect(
			sandbox.run('puts 1', false, true, undefined, [], {
				signal: runController.signal
			})
		).resolves.toBe(true);
		expect(removeRunListener).toHaveBeenCalled();

		runController.abort(new Error('late run abort'));
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
	});

	it('preserves an abort-time replacement and reason when a later option getter throws', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('replace Ruby during option snapshot');
		const laterError = new Error('Ruby option getter failed after abort');
		let replacement: Promise<void> | undefined;
		const options: SandboxExecutionOptions = { signal: controller.signal };
		Object.defineProperty(options, 'programArgs', {
			get() {
				controller.abort(reason);
				replacement = sandbox.load('/replacement');
				void replacement.catch(() => undefined);
				return [];
			}
		});
		Object.defineProperty(options, 'stdin', {
			get() {
				throw laterError;
			}
		});

		await expect(sandbox.run('puts 1', false, true, undefined, [], options)).rejects.toBe(
			reason
		);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves an abort reason when an output callback reloads and then throws', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('abort from Ruby output');
		const laterError = new Error('Ruby output failed after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(reason);
			replacement = sandbox.load('/replacement');
			void replacement.catch(() => undefined);
			throw laterError;
		};
		const running = sandbox.run('puts 1', false, true, undefined, [], {
			signal: controller.signal
		});

		retiredWorker.emit({ output: 'trigger cancellation', results: true });
		await expect(running).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});
});
