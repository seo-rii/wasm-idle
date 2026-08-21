import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({}))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import { PERL_MAX_ASSET_BYTES, type PerlRuntimePreflightPayload } from '@wasm-idle/core';
import { createPerlWorkerService, type LspDocumentContext } from '../src/index.js';

describe('Perl LSP outer-to-nested worker boundary', () => {
	it('uses verified runner bytes and structured-clones only the logical runtime payload', async () => {
		const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const workerReceipt = {
			bytes: runnerWorkerBytes.byteLength,
			sha256: 'b'.repeat(64)
		};
		const runtimePreflight: PerlRuntimePreflightPayload = {
			protocol: 'wasm-idle-perl-preflight',
			protocolVersion: 1,
			profileId: 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28',
			artifactRevision: '1'.repeat(40),
			webperlRevision: '2'.repeat(40),
			perlRevision: '3'.repeat(40),
			emscriptenRevision: '4'.repeat(40),
			manifestFingerprint: 'a'.repeat(64),
			manifestBytes: Uint8Array.of(1),
			javascriptBytes: Uint8Array.of(2),
			wasmBytes: Uint8Array.of(3),
			dataBytes: Uint8Array.of(4)
		};
		const document = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'print "ok\\n";\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createPerlWorkerService();

		await service.initialize?.(
			{
				workerReceipt,
				runnerWorkerBytes,
				runtimePreflight,
				maxAssetBytes: PERL_MAX_ASSET_BYTES
			},
			context
		);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledOnce();
		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'perl',
			workerReceipt,
			workerBytes: runnerWorkerBytes,
			timeoutMessage: 'Perl diagnostics timed out',
			message: {
				runtimePreflight,
				maxAssetBytes: PERL_MAX_ASSET_BYTES,
				code: document.text,
				args: [],
				stdin: '',
				activePath: 'main.pl',
				diagnose: true,
				log: false
			}
		});
		expect(runtimePreflight.dataBytes.buffer.byteLength).toBe(1);
	});
});
