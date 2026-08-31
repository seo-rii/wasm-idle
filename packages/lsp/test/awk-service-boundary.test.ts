import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({}))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import {
	AWK_MAX_ASSET_BYTES,
	AWK_RUNTIME_WORKER_PATH,
	type AwkRuntimePreflightPayload,
	type AwkRuntimePreflightProfile
} from '@wasm-idle/core';
import { BUNDLED_AWK_RUNTIME_PROFILE } from '../src/bundledAwkRuntime.js';
import {
	createAwkWorkerService,
	type AwkWorkerOptions,
	type LspDocumentContext
} from '../src/index.js';

const document = {
	uri: 'file:///workspace/main.awk',
	languageId: 'awk',
	version: 1,
	text: 'BEGIN { print "ok" }\n'
};

const context: LspDocumentContext = {
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function createWorkerConfig(
	overrides: {
		manifestFingerprint?: string;
		runnerWorkerBytes?: Uint8Array;
		goShimBytes?: Uint8Array;
		wasmBytes?: Uint8Array;
	} = {}
): AwkWorkerOptions {
	const runnerWorkerBytes =
		overrides.runnerWorkerBytes ??
		new TextEncoder().encode('self.onmessage = () => undefined;');
	const goShimBytes =
		overrides.goShimBytes ?? new TextEncoder().encode('globalThis.Go = class {};');
	const wasmBytes = overrides.wasmBytes ?? Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const workerReceipt = {
		bytes: runnerWorkerBytes.byteLength,
		sha256: sha256(runnerWorkerBytes)
	};
	const manifestFingerprint =
		overrides.manifestFingerprint ?? BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint;
	const profile: AwkRuntimePreflightProfile = {
		...BUNDLED_AWK_RUNTIME_PROFILE,
		manifestFingerprint,
		workerReceipt,
		goShimReceipt: { bytes: goShimBytes.byteLength, sha256: sha256(goShimBytes) },
		wasmReceipt: {
			bytes: wasmBytes.byteLength,
			sha256: sha256(wasmBytes),
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: sha256(wasmBytes)
		}
	};
	const runtimePreflight: AwkRuntimePreflightPayload = {
		protocol: 'wasm-idle-awk-runtime-v2',
		goShimBytes,
		wasmBytes
	};
	return {
		manifestUrl: `https://assets.example.com/wasm-awk/runtime-manifest.v2.json?v=${manifestFingerprint}`,
		maxAssetBytes: AWK_MAX_ASSET_BYTES,
		profile,
		runnerWorkerBytes,
		runtimePreflight,
		workerReceipt
	};
}

describe('AWK LSP outer-to-nested worker boundary', () => {
	beforeEach(() => {
		mocks.runRuntimeWorkerDiagnostics.mockReset();
		mocks.runRuntimeWorkerDiagnostics.mockResolvedValue({});
	});

	it('clones and transfers only verified runtime bytes to the network-free runner', async () => {
		const config = createWorkerConfig();
		const service = createAwkWorkerService();

		await service.initialize?.(config, context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledOnce();
		const request = mocks.runRuntimeWorkerDiagnostics.mock.calls[0]?.[0];
		const payload = request.message.runtimePreflight as AwkRuntimePreflightPayload;
		expect(request).toMatchObject({
			runtime: 'awk',
			workerAsset: AWK_RUNTIME_WORKER_PATH,
			workerReceipt: config.workerReceipt,
			workerBytes: config.runnerWorkerBytes,
			timeoutMessage: 'AWK diagnostics timed out',
			message: {
				run: true,
				code: document.text,
				activePath: 'main.awk',
				args: [],
				stdin: '',
				diagnose: true,
				log: false
			}
		});
		expect(Object.keys(payload).sort()).toEqual(['goShimBytes', 'protocol', 'wasmBytes']);
		expect(payload.goShimBytes).toEqual(config.runtimePreflight.goShimBytes);
		expect(payload.wasmBytes).toEqual(config.runtimePreflight.wasmBytes);
		expect(payload.goShimBytes.buffer).not.toBe(config.runtimePreflight.goShimBytes.buffer);
		expect(payload.wasmBytes.buffer).not.toBe(config.runtimePreflight.wasmBytes.buffer);
		expect(request.messageTransfer).toEqual([
			payload.goShimBytes.buffer,
			payload.wasmBytes.buffer
		]);
		expect(config.runtimePreflight.goShimBytes.byteLength).toBeGreaterThan(0);
		expect(config.runtimePreflight.wasmBytes.byteLength).toBeGreaterThan(0);
	});

	it('rejects corrupt verified payloads before constructing a nested worker', async () => {
		const config = createWorkerConfig();
		config.runtimePreflight.wasmBytes[0] ^= 0xff;
		const service = createAwkWorkerService();

		await expect(service.initialize?.(config, context)).rejects.toThrow(/SHA-256 mismatch/iu);
		expect(mocks.runRuntimeWorkerDiagnostics).not.toHaveBeenCalled();
	});

	it('keeps cached verified buffers intact across multiple diagnostic workers', async () => {
		const config = createWorkerConfig();
		const service = createAwkWorkerService();
		const secondDocument = { ...document, version: 2, text: 'BEGIN { print "next" }\n' };

		await service.initialize?.(config, context);
		await service.diagnostics?.(document, context);
		await service.diagnostics?.(secondDocument, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
		const first = mocks.runRuntimeWorkerDiagnostics.mock.calls[0]?.[0].message
			.runtimePreflight as AwkRuntimePreflightPayload;
		const second = mocks.runRuntimeWorkerDiagnostics.mock.calls[1]?.[0].message
			.runtimePreflight as AwkRuntimePreflightPayload;
		expect(first.goShimBytes.buffer).not.toBe(second.goShimBytes.buffer);
		expect(first.wasmBytes.buffer).not.toBe(second.wasmBytes.buffer);
		expect(first.goShimBytes.buffer).not.toBe(config.runtimePreflight.goShimBytes.buffer);
		expect(second.wasmBytes.buffer).not.toBe(config.runtimePreflight.wasmBytes.buffer);
		expect(config.runtimePreflight.goShimBytes.byteLength).toBeGreaterThan(0);
		expect(config.runtimePreflight.wasmBytes.byteLength).toBeGreaterThan(0);
	});

	it('rejects legacy URLs, extra config keys, and non-owned transferred views', async () => {
		const service = createAwkWorkerService();
		await expect(
			service.initialize?.(
				{
					baseUrl: 'https://assets.example.com/wasm-awk/',
					workerUrl: `https://assets.example.com/wasm-awk/${AWK_RUNTIME_WORKER_PATH}`
				},
				context
			)
		).rejects.toThrow('exact verified runtime configuration');

		const config = createWorkerConfig();
		await expect(
			service.initialize?.({ ...config, unexpected: true }, context)
		).rejects.toThrow('exact verified runtime configuration');
		const symbolConfig = { ...config, [Symbol('unexpected')]: true };
		await expect(service.initialize?.(symbolConfig, context)).rejects.toThrow(
			'exact verified runtime configuration'
		);
		const getter = vi.fn(() => config.manifestUrl);
		const accessorConfig = { ...config } as Record<string, unknown>;
		Object.defineProperty(accessorConfig, 'manifestUrl', { enumerable: true, get: getter });
		await expect(service.initialize?.(accessorConfig, context)).rejects.toThrow(
			'exact verified runtime configuration'
		);
		expect(getter).not.toHaveBeenCalled();
		const backing = new Uint8Array(config.runtimePreflight.wasmBytes.byteLength + 1);
		backing.set(config.runtimePreflight.wasmBytes, 1);
		await expect(
			service.initialize?.(
				{
					...config,
					runtimePreflight: {
						...config.runtimePreflight,
						wasmBytes: new Uint8Array(
							backing.buffer,
							1,
							config.runtimePreflight.wasmBytes.byteLength
						)
					}
				},
				context
			)
		).rejects.toThrow(/strict runtime preflight payload|owned runtime preflight bytes/iu);

		const disguisedRunner = new Uint16Array([0x656c, 0x6167]);
		Object.defineProperty(disguisedRunner, Symbol.toStringTag, { value: 'Uint8Array' });
		await expect(
			service.initialize?.(
				createWorkerConfig({
					runnerWorkerBytes: disguisedRunner as unknown as Uint8Array
				}),
				context
			)
		).rejects.toThrow('receipt-sized runner bytes');
		expect(mocks.runRuntimeWorkerDiagnostics).not.toHaveBeenCalled();
	});

	it('keys cached diagnostics by the complete pinned profile identity', async () => {
		const service = createAwkWorkerService();

		await service.initialize?.(
			createWorkerConfig({ manifestFingerprint: 'a'.repeat(64) }),
			context
		);
		await service.diagnostics?.(document, context);
		await service.initialize?.(
			createWorkerConfig({ manifestFingerprint: 'b'.repeat(64) }),
			context
		);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('allows at most one active nested diagnostic worker', async () => {
		let releaseFirst!: () => void;
		const firstFinished = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let activeWorkers = 0;
		let maximumActiveWorkers = 0;
		mocks.runRuntimeWorkerDiagnostics.mockImplementation(async () => {
			activeWorkers += 1;
			maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
			if (mocks.runRuntimeWorkerDiagnostics.mock.calls.length === 1) {
				await firstFinished;
			}
			activeWorkers -= 1;
			return {};
		});
		const service = createAwkWorkerService();
		await service.initialize?.(createWorkerConfig(), context);

		const first = service.diagnostics?.(document, context);
		await vi.waitFor(() => expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(1));
		const secondDocument = {
			...document,
			uri: 'file:///workspace/second.awk',
			text: 'BEGIN { print "second" }\n'
		};
		const second = service.diagnostics?.(secondDocument, context);
		await Promise.resolve();

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(1);
		expect(maximumActiveWorkers).toBe(1);
		releaseFirst();
		await Promise.all([first, second]);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
		expect(maximumActiveWorkers).toBe(1);
	});

	it('skips stale queued document versions before cloning runner payloads', async () => {
		let releaseFirst!: () => void;
		mocks.runRuntimeWorkerDiagnostics
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = () => resolve({});
					})
			)
			.mockResolvedValue({});
		const service = createAwkWorkerService();
		await service.initialize?.(createWorkerConfig(), context);

		const first = service.diagnostics?.(document, context);
		await vi.waitFor(() => expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(1));
		const middleDocument = {
			...document,
			version: 2,
			text: 'BEGIN { print "middle" }\n'
		};
		const latestDocument = {
			...document,
			version: 3,
			text: 'BEGIN { print "latest" }\n'
		};
		const middle = service.diagnostics?.(middleDocument, context);
		const latest = service.diagnostics?.(latestDocument, context);
		releaseFirst();
		await Promise.all([first, middle, latest]);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
		expect(
			mocks.runRuntimeWorkerDiagnostics.mock.calls.map(([request]) => request.message.code)
		).toEqual([document.text, latestDocument.text]);
	});
});
