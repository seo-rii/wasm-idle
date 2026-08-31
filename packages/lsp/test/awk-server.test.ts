import { afterEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => {
	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;
		constructor(_worker: Worker) {}
		listen() {
			return { dispose() {} };
		}
		dispose() {}
	}
	class MockWriter {
		constructor(_worker: Worker) {}
		dispose() {}
	}
	return { MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: transportMocks.MockReader,
	BrowserMessageWriter: transportMocks.MockWriter
}));

import { AWK_MAX_ASSET_BYTES, AWK_RUNTIME_WORKER_PATH } from '@wasm-idle/core';
import { BUNDLED_AWK_RUNTIME_PROFILE } from '../src/bundledAwkRuntime.js';
import { getAwkLanguageServer } from '../src/awk/server.js';
import {
	awkTestAssetBytes,
	createAwkTestAssetResponse,
	type AwkTestAssetName
} from './awk-fixture.js';

class ReadyWorker {
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		error: new Set<(event: ErrorEvent) => void>()
	};
	readonly messages: unknown[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;

	addEventListener(
		type: 'message' | 'error',
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
	) {
		if (type === 'message') {
			this.listeners.message.add(listener as (event: MessageEvent<unknown>) => void);
		} else {
			this.listeners.error.add(listener as (event: ErrorEvent) => void);
		}
	}

	removeEventListener(
		type: 'message' | 'error',
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
	) {
		if (type === 'message') {
			this.listeners.message.delete(listener as (event: MessageEvent<unknown>) => void);
		} else {
			this.listeners.error.delete(listener as (event: ErrorEvent) => void);
		}
	}

	postMessage(message: unknown, transfer: Transferable[] = []) {
		this.messages.push(message);
		this.transfers.push(transfer);
		for (const listener of this.listeners.message) {
			listener({ data: { type: 'ready' } } as MessageEvent<unknown>);
		}
	}

	terminate() {
		this.terminated = true;
	}
}

const currentUrl = 'https://app.example.com/wasm-idle/editor';
const rootUrl = '/wasm-idle/';

function installAssetFetch(overrides: Partial<Record<AwkTestAssetName, Uint8Array>> = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const requestUrl = new URL(
			typeof input === 'string' || input instanceof URL ? input : input.url
		);
		const response = createAwkTestAssetResponse(requestUrl, overrides);
		if (!response) throw new Error(`Unexpected AWK asset request: ${requestUrl.href}`);
		return response;
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('getAwkLanguageServer host preflight', () => {
	it('verifies the complete runtime graph and runner before creating the outer worker', async () => {
		const fetchMock = installAssetFetch();
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);

		const handle = await getAwkLanguageServer({ rootUrl, currentUrl, createWorker });

		expect(createWorker).toHaveBeenCalledOnce();
		expect(new Set(fetchMock.mock.calls.map(([input]) => String(input)))).toEqual(
			new Set([
				`https://app.example.com/wasm-idle/wasm-awk/runtime-manifest.v2.json?v=${BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint}`,
				`https://app.example.com/wasm-idle/wasm-awk/wasm_exec.js?v=${BUNDLED_AWK_RUNTIME_PROFILE.goShimReceipt.sha256}`,
				`https://app.example.com/wasm-idle/wasm-awk/goawk.wasm.gz.bin?v=${BUNDLED_AWK_RUNTIME_PROFILE.wasmReceipt.sha256}`,
				`https://app.example.com/wasm-idle/wasm-awk/${AWK_RUNTIME_WORKER_PATH}?v=${BUNDLED_AWK_RUNTIME_PROFILE.workerReceipt.sha256}`
			])
		);
		const init = worker.messages[0] as {
			type: string;
			options: Record<string, unknown> & {
				runnerWorkerBytes: Uint8Array;
				runtimePreflight: {
					protocol: string;
					goShimBytes: Uint8Array;
					wasmBytes: Uint8Array;
				};
			};
		};
		expect(init.type).toBe('init');
		expect(Object.keys(init.options).sort()).toEqual([
			'manifestUrl',
			'maxAssetBytes',
			'profile',
			'runnerWorkerBytes',
			'runtimePreflight',
			'workerReceipt'
		]);
		expect(init.options).toMatchObject({
			manifestUrl: `https://app.example.com/wasm-idle/wasm-awk/runtime-manifest.v2.json?v=${BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint}`,
			maxAssetBytes: AWK_MAX_ASSET_BYTES,
			profile: BUNDLED_AWK_RUNTIME_PROFILE,
			workerReceipt: BUNDLED_AWK_RUNTIME_PROFILE.workerReceipt,
			runtimePreflight: { protocol: 'wasm-idle-awk-runtime-v2' }
		});
		expect(Object.keys(init.options.runtimePreflight).sort()).toEqual([
			'goShimBytes',
			'protocol',
			'wasmBytes'
		]);
		expect(init.options.runnerWorkerBytes).toEqual(awkTestAssetBytes[AWK_RUNTIME_WORKER_PATH]);
		expect(init.options.runtimePreflight.goShimBytes).toEqual(
			awkTestAssetBytes['wasm_exec.js']
		);
		expect(init.options.runtimePreflight.wasmBytes).toHaveLength(
			BUNDLED_AWK_RUNTIME_PROFILE.wasmReceipt.uncompressedBytes
		);
		expect(worker.transfers[0]).toEqual([
			init.options.runtimePreflight.goShimBytes.buffer,
			init.options.runtimePreflight.wasmBytes.buffer,
			init.options.runnerWorkerBytes.buffer
		]);
		expect(new Set(worker.transfers[0]).size).toBe(3);

		handle.dispose();
	});

	it('does not create the outer worker while the runner receipt is pending', async () => {
		let releaseRunner!: () => void;
		const runnerReady = new Promise<void>((resolve) => {
			releaseRunner = resolve;
		});
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			if (requestUrl.pathname.endsWith(`/${AWK_RUNTIME_WORKER_PATH}`)) await runnerReady;
			const response = createAwkTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected AWK asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);
		const startup = getAwkLanguageServer({ rootUrl, currentUrl, createWorker });

		await vi.waitFor(() =>
			expect(
				fetchMock.mock.calls.some(([input]) =>
					String(input).includes(AWK_RUNTIME_WORKER_PATH)
				)
			).toBe(true)
		);
		expect(createWorker).not.toHaveBeenCalled();

		releaseRunner();
		const handle = await startup;
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it.each([AWK_RUNTIME_WORKER_PATH, 'goawk.wasm.gz.bin'] as const)(
		'rejects corrupt %s before creating the outer worker',
		async (asset) => {
			const corruptBytes = Uint8Array.from(awkTestAssetBytes[asset]);
			corruptBytes[0] ^= 0xff;
			installAssetFetch({ [asset]: corruptBytes });
			const createWorker = vi.fn();

			await expect(
				getAwkLanguageServer({ rootUrl, currentUrl, createWorker })
			).rejects.toThrow(/SHA-256 mismatch/iu);
			expect(createWorker).not.toHaveBeenCalled();
		}
	);
});
