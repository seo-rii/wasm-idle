import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
let autoResolveLoad = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (!message.load || !autoResolveLoad) return;
		queueMicrotask(() => {
			this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/fortran?worker', () => ({
	default: MockWorker
}));

import Fortran from './fortran';

describe('Fortran worker lifecycle', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = false;
	});

	it('aborts owned asset work before starting a replacement worker', async () => {
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
});
