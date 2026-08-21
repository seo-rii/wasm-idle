import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({}))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import { JANET_MAX_ASSET_BYTES, type JanetRuntimePreflightPayload } from '@wasm-idle/core';
import { BUNDLED_JANET_RUNTIME_PROFILE } from '../src/bundledJanetRuntime.js';
import { createJanetWorkerService, type LspDocumentContext } from '../src/index.js';

const document = {
	uri: 'file:///workspace/main.janet',
	languageId: 'janet',
	version: 1,
	text: '(print "ok")\n'
};

const context: LspDocumentContext = {
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
};

function createWorkerConfig(
	manifestFingerprint = BUNDLED_JANET_RUNTIME_PROFILE.manifestFingerprint
) {
	const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
	const workerReceipt = {
		bytes: runnerWorkerBytes.byteLength,
		sha256: 'b'.repeat(64)
	};
	const runtimePreflight: JanetRuntimePreflightPayload = {
		protocol: 'wasm-idle-janet-preflight',
		protocolVersion: 1,
		profileId: BUNDLED_JANET_RUNTIME_PROFILE.profileId,
		artifactRevision: BUNDLED_JANET_RUNTIME_PROFILE.artifactRevision,
		janetVersion: BUNDLED_JANET_RUNTIME_PROFILE.janetVersion,
		emscriptenVersion: BUNDLED_JANET_RUNTIME_PROFILE.emscriptenVersion,
		manifestFingerprint,
		manifestBytes: Uint8Array.of(1),
		javascriptBytes: Uint8Array.of(2),
		wasmBytes: Uint8Array.of(3)
	};
	return {
		workerReceipt,
		runnerWorkerBytes,
		runtimePreflight,
		maxAssetBytes: JANET_MAX_ASSET_BYTES
	};
}

describe('Janet LSP outer-to-nested worker boundary', () => {
	beforeEach(() => {
		mocks.runRuntimeWorkerDiagnostics.mockClear();
	});

	it('uses verified runner bytes and structured-clones only the logical runtime payload', async () => {
		const config = createWorkerConfig();
		const service = createJanetWorkerService();

		await service.initialize?.(config, context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledOnce();
		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'janet',
			workerReceipt: config.workerReceipt,
			workerBytes: config.runnerWorkerBytes,
			timeoutMessage: 'Janet diagnostics timed out',
			message: {
				runtimePreflight: config.runtimePreflight,
				maxAssetBytes: JANET_MAX_ASSET_BYTES,
				code: document.text,
				args: [],
				stdin: '',
				activePath: 'main.janet',
				diagnose: true,
				log: false
			}
		});
		expect(config.runtimePreflight.wasmBytes.buffer.byteLength).toBe(1);
	});

	it('includes the full runtime identity in the diagnostics cache key', async () => {
		mocks.runRuntimeWorkerDiagnostics.mockResolvedValue({});
		const service = createJanetWorkerService();

		await service.initialize?.(createWorkerConfig('a'.repeat(64)), context);
		await service.diagnostics?.(document, context);
		await service.initialize?.(createWorkerConfig('c'.repeat(64)), context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('rejects legacy URL configs and non-owned transferred views', async () => {
		const service = createJanetWorkerService();
		expect(() =>
			service.initialize?.(
				{
					baseUrl: 'https://assets.example.com/wasm-janet/',
					workerUrl: 'https://assets.example.com/wasm-janet/runner-worker.js'
				},
				context
			)
		).toThrow('exact verified runtime configuration');

		const config = createWorkerConfig();
		const backing = new Uint8Array(config.runnerWorkerBytes.byteLength + 1);
		backing.set(config.runnerWorkerBytes, 1);
		expect(() =>
			service.initialize?.(
				{
					...config,
					runnerWorkerBytes: new Uint8Array(
						backing.buffer,
						1,
						config.runnerWorkerBytes.byteLength
					)
				},
				context
			)
		).toThrow('receipt-sized runner bytes');
	});
});
