import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({}))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import { PASCAL_MAX_ASSET_BYTES, type PascalRuntimePreflightPayload } from '@wasm-idle/core';
import { BUNDLED_PASCAL_RUNTIME_PROFILE } from '../src/bundledPascalRuntime.js';
import { createPascalWorkerService, type LspDocumentContext } from '../src/index.js';

const document = {
	uri: 'file:///workspace/main.pas',
	languageId: 'pascal',
	version: 1,
	text: 'program Demo;\nbegin\n  UnknownThing;\nend.\n'
};

const context: LspDocumentContext = {
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
};

function createWorkerConfig(
	manifestFingerprint = BUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint
) {
	const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
	const workerReceipt = {
		bytes: runnerWorkerBytes.byteLength,
		sha256: 'b'.repeat(64)
	};
	const runtimePreflight: PascalRuntimePreflightPayload = {
		protocol: 'wasm-idle-pascal-preflight',
		protocolVersion: 1,
		profileId: BUNDLED_PASCAL_RUNTIME_PROFILE.profileId,
		artifactRevision: BUNDLED_PASCAL_RUNTIME_PROFILE.artifactRevision,
		pas2jsVersion: BUNDLED_PASCAL_RUNTIME_PROFILE.pas2jsVersion,
		pas2jsRevision: BUNDLED_PASCAL_RUNTIME_PROFILE.pas2jsRevision,
		manifestFingerprint,
		manifestBytes: Uint8Array.of(1),
		compilerJavaScriptBytes: Uint8Array.of(2),
		rtlJavaScriptBytes: Uint8Array.of(3),
		systemPascalBytes: Uint8Array.of(4)
	};
	return {
		workerReceipt,
		runnerWorkerBytes,
		runtimePreflight,
		maxAssetBytes: PASCAL_MAX_ASSET_BYTES
	};
}

describe('Pascal LSP outer-to-nested worker boundary', () => {
	beforeEach(() => {
		mocks.runRuntimeWorkerDiagnostics.mockClear();
	});

	it('uses verified runner bytes and structured-clones the complete logical runtime payload', async () => {
		const config = createWorkerConfig();
		const service = createPascalWorkerService();

		await service.initialize?.(config, context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledOnce();
		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'pascal',
			workerReceipt: config.workerReceipt,
			workerBytes: config.runnerWorkerBytes,
			timeoutMessage: 'Pascal diagnostics timed out',
			message: {
				runtimePreflight: config.runtimePreflight,
				maxAssetBytes: PASCAL_MAX_ASSET_BYTES,
				code: document.text,
				args: [],
				stdin: '',
				activePath: 'main.pas',
				diagnose: true,
				log: false
			}
		});
		expect(config.runtimePreflight.compilerJavaScriptBytes.buffer.byteLength).toBe(1);
	});

	it('includes every profile identity field in the diagnostics cache key', async () => {
		mocks.runRuntimeWorkerDiagnostics.mockResolvedValue({});
		const service = createPascalWorkerService();

		await service.initialize?.(createWorkerConfig('a'.repeat(64)), context);
		await service.diagnostics?.(document, context);
		await service.initialize?.(createWorkerConfig('c'.repeat(64)), context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('rejects legacy URL configs, non-owned views, and aggregate overflow', async () => {
		const service = createPascalWorkerService();
		expect(() =>
			service.initialize?.(
				{
					baseUrl: 'https://assets.example.com/wasm-pascal/',
					workerUrl: 'https://assets.example.com/wasm-pascal/runner-worker.js'
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

		const aggregateOverflow = createWorkerConfig();
		aggregateOverflow.runtimePreflight = {
			...aggregateOverflow.runtimePreflight,
			compilerJavaScriptBytes: new Uint8Array(PASCAL_MAX_ASSET_BYTES),
			rtlJavaScriptBytes: new Uint8Array(PASCAL_MAX_ASSET_BYTES)
		};
		expect(() => service.initialize?.(aggregateOverflow, context)).toThrow(
			'logical payload exceeds the aggregate limit'
		);
	});
});
