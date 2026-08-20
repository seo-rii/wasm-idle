import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({ output: '', error: undefined }))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import { createStaticWorkerDiagnostics } from '../src/static-worker-service.js';
import {
	createPrologWorkerService,
	createPerlWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';
import {
	PROLOG_MAX_ASSET_BYTES,
	PROLOG_PREFLIGHT_PROTOCOL,
	PROLOG_PREFLIGHT_PROTOCOL_VERSION
} from '@wasm-idle/core';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createStaticWorkerDiagnostics', () => {
	it('validates configuration, reports progress, runs diagnostics, and caches results', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'demo error'
		}));
		const diagnostics = createStaticWorkerDiagnostics({
			languageName: 'Demo',
			loadProgressStage: 'load-demo-runtime',
			diagnosticsProgressStage: 'demo-diagnostics',
			defaultActivePath: 'main.demo',
			timeoutMessage: 'Demo diagnostics timed out',
			runDiagnostics,
			createMessage: (request) => ({
				baseUrl: request.baseUrl,
				code: request.code,
				activePath: request.activePath,
				diagnose: true
			}),
			diagnosticsFromResult: (result) =>
				result.error
					? [
							{
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 1 }
								},
								severity: 1,
								source: 'demo',
								message: result.error
							}
						]
					: []
		});
		const document: LspDocument = {
			uri: 'file:///workspace/main.demo',
			languageId: 'demo',
			version: 1,
			text: 'broken\n'
		};
		const context = contextFor(document);

		expect(() => diagnostics.initialize?.({ baseUrl: '/demo/' }, context)).toThrow(
			'Demo language server requires baseUrl and workerUrl'
		);

		diagnostics.initialize?.(
			{ baseUrl: '/demo/', workerUrl: '/demo/runner-worker.js' },
			context
		);
		const first = await diagnostics.diagnostics?.(document, context);
		const second = await diagnostics.diagnostics?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledTimes(1);
		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: '/demo/',
			workerUrl: '/demo/runner-worker.js',
			code: document.text,
			activePath: 'main.demo'
		});
		expect(first).toEqual([
			expect.objectContaining({
				source: 'demo',
				message: 'demo error'
			})
		]);
		expect(second).toBe(first);
		expect(context.reportProgress).toHaveBeenCalledWith('load-demo-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('demo-diagnostics');
	});

	it('uses the fallback active path for untitled documents', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const diagnostics = createStaticWorkerDiagnostics({
			languageName: 'Demo',
			loadProgressStage: 'load-demo-runtime',
			defaultActivePath: 'main.demo',
			timeoutMessage: 'Demo diagnostics timed out',
			runDiagnostics,
			createMessage: () => ({}),
			diagnosticsFromResult: () => []
		});
		const document: LspDocument = {
			uri: '',
			languageId: 'demo',
			version: 1,
			text: 'ok\n'
		};
		const context = contextFor(document);

		diagnostics.initialize?.(
			{ baseUrl: '/demo/', workerUrl: '/demo/runner-worker.js' },
			context
		);
		await diagnostics.diagnostics?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith(
			expect.objectContaining({ activePath: 'main.demo' })
		);
	});

	it('forwards the configured runtime identity to verified worker loading', async () => {
		mocks.runRuntimeWorkerDiagnostics.mockClear();
		const diagnostics = createStaticWorkerDiagnostics({
			languageName: 'Tcl',
			loadProgressStage: 'load-tcl-runtime',
			defaultActivePath: 'main.tcl',
			timeoutMessage: 'Tcl diagnostics timed out',
			runtime: 'tcl',
			createMessage: (request) => ({ code: request.code }),
			diagnosticsFromResult: () => []
		});
		const document: LspDocument = {
			uri: 'file:///workspace/main.tcl',
			languageId: 'tcl',
			version: 1,
			text: 'puts ok\n'
		};
		const context = contextFor(document);
		const workerReceipt = { bytes: 123, sha256: 'a'.repeat(64) };

		diagnostics.initialize?.(
			{
				baseUrl: '/wasm-tcl/',
				workerUrl: '/wasm-tcl/runner-worker.js',
				workerReceipt
			},
			context
		);
		await diagnostics.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'tcl',
			workerUrl: '/wasm-tcl/runner-worker.js',
			workerReceipt,
			timeoutMessage: 'Tcl diagnostics timed out',
			message: { code: document.text }
		});
	});

	it('forwards the complete pinned Perl manifest contract to the verified worker', async () => {
		mocks.runRuntimeWorkerDiagnostics.mockClear();
		const service = createPerlWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'print "ok\\n";\n'
		};
		const context = contextFor(document);
		const workerReceipt = { bytes: 4567, sha256: 'a'.repeat(64) };
		const config = {
			baseUrl: '/wasm-perl/',
			workerUrl: '/wasm-perl/runner-worker.js?v=worker',
			manifestUrl: '/wasm-perl/runtime-manifest.v2.json?v=manifest',
			manifestFingerprint: 'b'.repeat(64),
			workerReceipt
		};

		service.initialize?.(config, context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'perl',
			workerUrl: config.workerUrl,
			workerReceipt,
			timeoutMessage: 'Perl diagnostics timed out',
			message: {
				baseUrl: config.baseUrl,
				manifestUrl: config.manifestUrl,
				manifestFingerprint: config.manifestFingerprint,
				maxAssetBytes: 32 * 1024 * 1024,
				code: document.text,
				activePath: 'main.pl',
				diagnose: true,
				log: false
			}
		});
	});

	it('forwards Prolog runner bytes directly with the strict runtime payload', async () => {
		mocks.runRuntimeWorkerDiagnostics.mockClear();
		const service = createPrologWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.prolog',
			languageId: 'prolog',
			version: 1,
			text: 'main :- true.\n'
		};
		const context = contextFor(document);
		const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const workerReceipt = {
			bytes: runnerWorkerBytes.byteLength,
			sha256: 'a'.repeat(64)
		};
		const runtimePreflight = {
			protocol: PROLOG_PREFLIGHT_PROTOCOL,
			protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
			profileId: 'swipl-wasm-test',
			packageRevision: '1'.repeat(40),
			swiplRevision: '2'.repeat(40),
			manifestFingerprint: '3'.repeat(64),
			manifestBytes: Uint8Array.of(1),
			javascriptBytes: Uint8Array.of(2),
			wasmBytes: Uint8Array.of(3),
			dataBytes: Uint8Array.of(4)
		};

		service.initialize?.(
			{
				workerReceipt,
				runnerWorkerBytes,
				runtimePreflight,
				maxAssetBytes: PROLOG_MAX_ASSET_BYTES
			},
			context
		);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			workerUrl: undefined,
			workerReceipt,
			workerBytes: runnerWorkerBytes,
			timeoutMessage: 'Prolog diagnostics timed out',
			message: {
				runtimePreflight,
				maxAssetBytes: PROLOG_MAX_ASSET_BYTES,
				code: document.text,
				activePath: 'main.prolog',
				diagnose: true,
				log: false
			}
		});
	});
});
