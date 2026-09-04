import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
	collectStaticRuntimePreflightTransferables,
	type StaticRuntimePreflightRequestMessage,
	type StaticRuntimePreflightResponseMessage
} from './staticRuntimePreflightProtocol';

const workerInstances: MockPreflightWorker[] = [];

class MockPreflightWorker {
	onmessage: ((event: MessageEvent<StaticRuntimePreflightResponseMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	request: StaticRuntimePreflightRequestMessage | undefined;
	workerTransferList: ArrayBuffer[] | undefined;
	postMessage = vi.fn((message: StaticRuntimePreflightRequestMessage) => {
		this.request = structuredClone(message);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	emit(message: StaticRuntimePreflightResponseMessage) {
		this.onmessage?.({ data: message } as MessageEvent<StaticRuntimePreflightResponseMessage>);
	}

	emitResult(payload: Readonly<Record<string, unknown>>) {
		const transfer = collectStaticRuntimePreflightTransferables(payload);
		this.workerTransferList = transfer;
		const delivered = structuredClone(
			{
				protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
				type: 'result',
				requestId: 1,
				payload
			} satisfies StaticRuntimePreflightResponseMessage,
			{ transfer }
		);
		this.emit(delivered);
	}
}

vi.mock('$lib/playground/worker/staticRuntimePreflight?worker', () => ({
	default: MockPreflightWorker
}));

import { preflightStaticRuntimeAssetsInWorker } from './staticRuntimePreflight';

function request(overrides: Record<string, unknown> = {}) {
	return {
		runtimeId: 'BQN' as const,
		displayName: 'BQN',
		baseUrl: 'https://example.test/wasm-bqn/',
		manifestUrl: 'https://example.test/wasm-bqn/runtime-manifest.v2.json',
		profile: { profileId: 'fixture' },
		limits: { assetTimeoutMs: 1_000 },
		...overrides
	};
}

describe('static runtime preflight worker bridge', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('uses a one-shot bundled worker and receives every payload buffer by transfer', async () => {
		const pending = preflightStaticRuntimeAssetsInWorker<{
			readonly protocol: string;
			readonly manifestBytes: Uint8Array;
			readonly wasmBytes: Uint8Array;
		}>(request());
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		expect(worker.request).toMatchObject({
			protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
			type: 'preflight',
			requestId: 1,
			runtimeId: 'BQN',
			limits: { assetTimeoutMs: 1_000 }
		});
		expect(worker.request).not.toHaveProperty('signal');

		const workerPayload = Object.freeze({
			protocol: 'fixture',
			manifestBytes: Uint8Array.from([1, 2, 3]),
			wasmBytes: Uint8Array.from([0, 97, 115, 109])
		});
		worker.emitResult(workerPayload);
		const payload = await pending;

		expect(Object.isFrozen(payload)).toBe(true);
		expect(Array.from(payload.manifestBytes)).toEqual([1, 2, 3]);
		expect(Array.from(payload.wasmBytes)).toEqual([0, 97, 115, 109]);
		expect(worker.workerTransferList).toHaveLength(2);
		expect(workerPayload.manifestBytes.byteLength).toBe(0);
		expect(workerPayload.wasmBytes.byteLength).toBe(0);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
	});

	it('rehydrates typed worker failures with their receipt limit details', async () => {
		const pending = preflightStaticRuntimeAssetsInWorker(request());
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		workerInstances[0].emit({
			protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
			type: 'error',
			requestId: 1,
			error: {
				name: 'AssetTooLargeError',
				message: 'fixture asset exceeds its limit',
				code: 'asset-too-large',
				phase: 'asset',
				runtimeId: 'BQN',
				profileId: 'fixture',
				actual: 11,
				limit: 10,
				recoverable: false
			}
		});

		await expect(pending).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			phase: 'asset',
			runtimeId: 'BQN',
			profileId: 'fixture',
			actual: 11,
			limit: 10
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates and rejects with the caller reason when preflight is cancelled', async () => {
		const controller = new AbortController();
		const reason = new Error('cancel fixture preflight');
		const pending = preflightStaticRuntimeAssetsInWorker(
			request({ signal: controller.signal })
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		controller.abort(reason);

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'asset',
			runtimeId: 'BQN',
			cause: reason
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects a pre-aborted request without loading a worker', async () => {
		const controller = new AbortController();
		controller.abort(new Error('already cancelled'));

		await expect(
			preflightStaticRuntimeAssetsInWorker(request({ signal: controller.signal }))
		).rejects.toMatchObject({ code: 'cancelled', phase: 'asset', runtimeId: 'BQN' });
		expect(workerInstances).toHaveLength(0);
	});

	it('enforces the asset deadline across the entire worker operation', async () => {
		const pending = preflightStaticRuntimeAssetsInWorker(
			request({ limits: { assetTimeoutMs: 5 } })
		);
		const outcome = pending.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			runtimeId: 'BQN',
			timeoutMs: 5
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('settles and terminates if a progress observer throws', async () => {
		const observerError = new Error('progress observer failed');
		const pending = preflightStaticRuntimeAssetsInWorker(
			request({
				reportProgress() {
					throw observerError;
				}
			})
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		workerInstances[0].emit({
			protocolVersion: STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION,
			type: 'progress',
			requestId: 1,
			progress: {
				kind: 'asset',
				progress: {
					runtimeId: 'BQN',
					assetKey: 'wasm',
					loadedBytes: 1,
					totalBytes: 2
				}
			}
		});

		await expect(pending).rejects.toBe(observerError);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});
});
