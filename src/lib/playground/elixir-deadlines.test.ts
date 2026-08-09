import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

	resolveRun(result: boolean | string = ':ok') {
		this.onmessage?.({ data: { results: result } } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/elixir?worker', () => ({
	default: MockWorker
}));

import Elixir from './elixir';
import { readBufferedStdin } from './stdinBuffer';

const ELIXIR_ASSETS = {
	elixir: { bundleUrl: '/runtime/elixir/bundle.avm' }
};
const ERLANG_ASSETS = {
	erlang: { bundleUrl: '/runtime/erlang/bundle.avm' }
};

describe('Elixir and Erlang aggregate deadlines', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		history.replaceState({}, '', '/editor');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('times out Elixir startup and preserves a replacement started during listener cleanup', async () => {
		vi.useFakeTimers();
		autoResolveLoad = false;
		const sandbox = new Elixir();
		const controller = new AbortController();
		const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
		let replacement: Promise<void> | undefined;
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
			(type, listener, options) => {
				originalRemove(type, listener, options);
				if (type !== 'abort' || replacement) return;
				autoResolveLoad = true;
				replacement = sandbox.load({
					elixir: { bundleUrl: '/runtime/elixir/replacement.avm' }
				});
			}
		);
		const loading = sandbox.load(ELIXIR_ASSETS, '', true, [], {
			signal: controller.signal,
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'ELIXIR',
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

	it('times out Erlang execution, clears owned stdin, ignores stale results, and retries cleanly', async () => {
		const sandbox = new Elixir('ERLANG');
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(ERLANG_ASSETS);
		const retiredWorker = workerInstances[0];
		autoResolveRun = false;
		vi.useFakeTimers();
		const running = sandbox.run('timer:sleep(infinity).', false, true, undefined, [], {
			stdin: 'owned input\n',
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const staleHandler = retiredWorker.onmessage;
		sandbox.write('discarded input\n');
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'ERLANG',
			timeoutMs: 10
		});

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		staleHandler?.({
			data: { output: 'stale output', results: ':stale' }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		autoResolveLoad = true;
		autoResolveRun = true;
		await sandbox.load(ERLANG_ASSETS);
		const replacementWorker = workerInstances[1];
		await expect(
			sandbox.run('ok.', false, true, undefined, [], {
				limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
			})
		).resolves.toBe(':ok');
		await vi.advanceTimersByTimeAsync(10);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('commits a completed run before listener cleanup starts a pending replacement', async () => {
		const sandbox = new Elixir();
		await sandbox.load(ELIXIR_ASSETS);
		const worker = workerInstances[0];
		autoResolveRun = false;
		vi.useFakeTimers();
		const controller = new AbortController();
		const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
		let replacement: Promise<boolean | string> | undefined;
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
			(type, listener, options) => {
				originalRemove(type, listener, options);
				if (type !== 'abort' || replacement) return;
				replacement = sandbox.run('replacement', false, true, undefined, [], {
					limits: { compileTimeoutMs: 40, runTimeoutMs: 60 }
				});
			}
		);
		const owner = sandbox.run('owner', false, true, undefined, [], {
			signal: controller.signal,
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const ownerHandler = worker.onmessage;

		ownerHandler?.({ data: { results: ':owner' } } as MessageEvent<any>);
		await expect(owner).resolves.toBe(':owner');
		expect(replacement).toBeDefined();
		expect(sandbox.exit).toBe(false);
		expect(worker.terminate).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.onmessage?.({ data: { results: ':replacement' } } as MessageEvent<any>);
		await expect(replacement).resolves.toBe(':replacement');
		await vi.advanceTimersByTimeAsync(100);
		expect(worker.terminate).not.toHaveBeenCalled();
	});
});
