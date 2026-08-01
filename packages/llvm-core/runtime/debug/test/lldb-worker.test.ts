import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSharedByteQueue } from '../src/shared-byte-queue.js';
import type { LldbWorkerInitializeMessage } from '../src/types.js';

const workerMocks = vi.hoisted(() => ({
	callMain: vi.fn(async () => 0),
	closeDapInput: vi.fn(),
	closeDapOutput: vi.fn(),
	closeRspInput: vi.fn(),
	closeRspOutput: vi.fn(),
	loadFailure: undefined as Error | undefined,
	moduleOptions: undefined as Record<string, unknown> | undefined,
	postWorkerError: vi.fn(),
	postWorkerMessage: vi.fn()
}));

vi.mock('../src/worker/module-loader.js', () => ({
	createByteOutput: vi.fn(() => vi.fn()),
	createTransportBindings: vi.fn(() => ({
		dapInput: { close: workerMocks.closeDapInput },
		dapOutput: { close: workerMocks.closeDapOutput },
		rspInput: { close: workerMocks.closeRspInput },
		rspOutput: { close: workerMocks.closeRspOutput }
	})),
	loadEmscriptenModuleFactory: vi.fn(async () => {
		if (workerMocks.loadFailure) {
			const failure = workerMocks.loadFailure;
			workerMocks.loadFailure = undefined;
			throw failure;
		}
		return async (options: Record<string, unknown>) => {
			workerMocks.moduleOptions = options;
			return {
				HEAPU8: new Uint8Array(512),
				callMain: workerMocks.callMain
			};
		};
	}),
	mountDebugFiles: vi.fn(),
	postWorkerError: workerMocks.postWorkerError,
	postWorkerMessage: workerMocks.postWorkerMessage,
	startLinearMemoryTelemetry: vi.fn(
		(module: { HEAPU8?: Uint8Array }, worker: 'lldb', generation: string) => {
			workerMocks.postWorkerMessage({
				type: 'memory',
				worker,
				bytes: module.HEAPU8?.buffer.byteLength ?? 0,
				generation
			});
			return vi.fn();
		}
	)
}));

function initializeMessage(generation: string): LldbWorkerInitializeMessage {
	return {
		type: 'initialize-lldb',
		generation,
		module: new Uint8Array([0, 97, 115, 109]),
		sources: [],
		dapInput: createSharedByteQueue(4096, 1),
		dapOutput: createSharedByteQueue(4096, 1),
		rspInput: createSharedByteQueue(4096, 1),
		rspOutput: createSharedByteQueue(4096, 1),
		assets: {
			js: 'https://example.test/lldb.js',
			wasm: 'https://example.test/lldb.wasm',
			worker: 'https://example.test/lldb.worker.mjs'
		}
	};
}

async function loadLldbWorker() {
	vi.resetModules();
	return import('../src/worker/lldb-worker.js');
}

describe('LLDB worker lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		workerMocks.loadFailure = undefined;
		workerMocks.moduleOptions = undefined;
	});

	it('keeps a proxied adapter alive until the real runtime exit', async () => {
		const { handleLldbWorkerMessage } = await loadLldbWorker();
		const message = initializeMessage('lldb-worker-return');

		handleLldbWorkerMessage(message);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'memory',
				worker: 'lldb',
				bytes: 512,
				generation: message.generation
			})
		);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'lldb',
				generation: message.generation
			})
		);
		await vi.waitFor(() =>
			expect(workerMocks.callMain).toHaveBeenCalledWith([message.generation])
		);
		handleLldbWorkerMessage(message);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(workerMocks.callMain).toHaveBeenCalledOnce();
		expect(workerMocks.postWorkerError).not.toHaveBeenCalled();

		const onExit = workerMocks.moduleOptions?.onExit;
		expect(onExit).toBeTypeOf('function');
		(onExit as (exitCode: number) => void)(0);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'lldb',
				message.generation,
				expect.objectContaining({
					message: 'LLDB debug adapter exited unexpectedly (exit code 0)'
				})
			)
		);

		workerMocks.closeDapInput.mockImplementationOnce(() => {
			throw new Error('stale DAP input queue');
		});
		expect(() =>
			handleLldbWorkerMessage({ type: 'dispose', generation: message.generation })
		).not.toThrow();
		expect(workerMocks.closeDapOutput).toHaveBeenCalledOnce();
		expect(workerMocks.closeRspInput).toHaveBeenCalledOnce();
		expect(workerMocks.closeRspOutput).toHaveBeenCalledOnce();
		expect(globalThis.__wasmIdleDebugTransport).toBeUndefined();
		expect(globalThis.wasmLldbSharedRingV1).toBeUndefined();
	});

	it('releases a failed initialization before accepting a recovery generation', async () => {
		workerMocks.loadFailure = new Error('LLDB loader failed');
		const { handleLldbWorkerMessage } = await loadLldbWorker();
		const failed = initializeMessage('lldb-worker-loader-failure');

		handleLldbWorkerMessage(failed);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'lldb',
				failed.generation,
				expect.objectContaining({ message: 'LLDB loader failed' })
			)
		);
		expect(workerMocks.closeDapInput).toHaveBeenCalledOnce();
		expect(workerMocks.closeDapOutput).toHaveBeenCalledOnce();
		expect(workerMocks.closeRspInput).toHaveBeenCalledOnce();
		expect(workerMocks.closeRspOutput).toHaveBeenCalledOnce();
		expect(globalThis.__wasmIdleDebugTransport).toBeUndefined();
		expect(globalThis.wasmLldbSharedRingV1).toBeUndefined();

		const recovery = initializeMessage('lldb-worker-loader-recovery');
		handleLldbWorkerMessage(recovery);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'lldb',
				generation: recovery.generation
			})
		);
		handleLldbWorkerMessage({ type: 'dispose', generation: recovery.generation });
	});
});
