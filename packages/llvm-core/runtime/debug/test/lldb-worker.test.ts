import { describe, expect, it, vi } from 'vitest';

import { createSharedByteQueue } from '../src/shared-byte-queue.js';
import type { LldbWorkerInitializeMessage } from '../src/types.js';

const workerMocks = vi.hoisted(() => ({
	callMain: vi.fn(async () => 0),
	moduleOptions: undefined as Record<string, unknown> | undefined,
	postWorkerError: vi.fn(),
	postWorkerMessage: vi.fn()
}));

vi.mock('../src/worker/module-loader.js', () => ({
	createByteOutput: vi.fn(() => vi.fn()),
	createTransportBindings: vi.fn(() => ({
		dapInput: { close: vi.fn() },
		dapOutput: { close: vi.fn() },
		rspInput: { close: vi.fn() },
		rspOutput: { close: vi.fn() }
	})),
	loadEmscriptenModuleFactory: vi.fn(async () => async (options: Record<string, unknown>) => {
		workerMocks.moduleOptions = options;
		return {
			HEAPU8: new Uint8Array(512),
			callMain: workerMocks.callMain
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

import { handleLldbWorkerMessage } from '../src/worker/lldb-worker.js';

describe('LLDB worker lifecycle', () => {
	it('keeps a proxied adapter alive until the real runtime exit', async () => {
		const message: LldbWorkerInitializeMessage = {
			type: 'initialize-lldb',
			generation: 'lldb-worker-return',
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
		await new Promise((resolve) => setTimeout(resolve, 0));
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
	});
});
