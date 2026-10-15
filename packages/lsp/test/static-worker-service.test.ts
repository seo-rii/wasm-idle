import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	runRuntimeWorkerDiagnostics: vi.fn(async () => ({ output: '', error: undefined }))
}));

vi.mock('../src/runtime-worker.js', () => ({
	runRuntimeWorkerDiagnostics: mocks.runRuntimeWorkerDiagnostics
}));

import {
	createStaticWorkerDiagnostics,
	type StaticWorkerDiagnosticConfig,
	type StaticWorkerDiagnosticRunner
} from '../src/static-worker-service.js';
import {
	createPrologWorkerService,
	createPerlWorkerService,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';
import {
	PERL_MAX_ASSET_BYTES,
	PERL_PREFLIGHT_PROTOCOL,
	PERL_PREFLIGHT_PROTOCOL_VERSION,
	PROLOG_MAX_ASSET_BYTES,
	PROLOG_PREFLIGHT_PROTOCOL,
	PROLOG_PREFLIGHT_PROTOCOL_VERSION
} from '@wasm-idle/core';
import { BUNDLED_PERL_RUNTIME_PROFILE } from '../src/bundledPerlRuntime.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

const diagnosticFor = (message: string): LspDiagnostic => ({
	range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
	message
});

const createTestService = (
	runDiagnostics: StaticWorkerDiagnosticRunner<StaticWorkerDiagnosticConfig & { mode?: string }>,
	singleFlight = true
) =>
	createStaticWorkerDiagnostics({
		languageName: 'Demo',
		loadProgressStage: 'load-demo-runtime',
		defaultActivePath: 'main.demo',
		timeoutMessage: 'Demo diagnostics timed out',
		singleFlight,
		runDiagnostics,
		createMessage: () => ({}),
		diagnosticsFromResult: (result) => (result.error ? [diagnosticFor(result.error)] : [])
	});

const testDocument: LspDocument = {
	uri: 'file:///workspace/a/main.demo',
	languageId: 'demo',
	version: 1,
	text: 'BAD'
};
const testConfig = { baseUrl: '/demo/', workerUrl: '/demo/runner-worker.js' };

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
		expect(second).toEqual(first);
		expect(second).not.toBe(first);
		expect(context.reportProgress).toHaveBeenCalledWith('load-demo-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('demo-diagnostics');
	});

	it('keeps same-basename documents independent when one document is edited', async () => {
		let releaseFirst!: (result: { error: string }) => void;
		const runDiagnostics = vi
			.fn<StaticWorkerDiagnosticRunner<StaticWorkerDiagnosticConfig>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve;
					})
			)
			.mockImplementation(async ({ code }) =>
				code === 'BAD' ? { error: 'bad syntax' } : {}
			);
		const service = createTestService(runDiagnostics);
		const context = contextFor(testDocument);
		service.initialize?.(testConfig, context);
		const first = service.diagnostics?.(testDocument, context);
		await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
		const other = service.diagnostics?.(
			{ ...testDocument, uri: 'file:///workspace/b/main.demo' },
			context
		);
		const edited = service.diagnostics?.(
			{ ...testDocument, text: 'GOOD', version: 2 },
			context
		);
		releaseFirst({ error: 'bad syntax' });

		await expect(first).resolves.toEqual([]);
		await expect(other).resolves.toEqual([diagnosticFor('bad syntax')]);
		await expect(edited).resolves.toEqual([]);
		expect(runDiagnostics).toHaveBeenCalledTimes(3);
	});

	it('shares consecutive duplicate requests without sharing mutable results', async () => {
		let release!: (result: { error: string }) => void;
		const runDiagnostics = vi.fn<StaticWorkerDiagnosticRunner<StaticWorkerDiagnosticConfig>>(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const service = createTestService(runDiagnostics);
		const context = contextFor(testDocument);
		service.initialize?.(testConfig, context);
		const first = service.diagnostics?.(testDocument, context);
		const second = service.diagnostics?.(testDocument, context);
		await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
		release({ error: 'bad syntax' });
		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toEqual([diagnosticFor('bad syntax')]);
		expect(secondResult).toEqual(firstResult);
		expect(secondResult).not.toBe(firstResult);
		firstResult![0].range.start.character = 100;
		firstResult![0].message = 'changed';
		firstResult!.push(diagnosticFor('extra'));
		expect(secondResult).toEqual([diagnosticFor('bad syntax')]);
		const cached = await service.diagnostics?.(testDocument, context);
		expect(cached).toEqual([diagnosticFor('bad syntax')]);
		cached![0].range.end.character = 100;
		await expect(service.diagnostics?.(testDocument, context)).resolves.toEqual([
			diagnosticFor('bad syntax')
		]);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);
	});

	it('does not revive superseded work when a document changes from A to B to A', async () => {
		let releaseFirst!: (result: { error: string }) => void;
		const runDiagnostics = vi
			.fn<StaticWorkerDiagnosticRunner<StaticWorkerDiagnosticConfig>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve;
					})
			)
			.mockResolvedValue({ error: 'latest diagnostics' });
		const service = createTestService(runDiagnostics);
		const context = contextFor(testDocument);
		service.initialize?.(testConfig, context);
		const original = service.diagnostics?.(testDocument, context);
		await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
		const middle = service.diagnostics?.(
			{ ...testDocument, version: 2, text: 'GOOD' },
			context
		);
		const latestDocument = { ...testDocument, version: 3 };
		const latest = service.diagnostics?.(latestDocument, context);
		releaseFirst({ error: 'superseded diagnostics' });

		await expect(original).resolves.toEqual([]);
		await expect(middle).resolves.toEqual([]);
		await expect(latest).resolves.toEqual([diagnosticFor('latest diagnostics')]);
		await expect(service.diagnostics?.(latestDocument, context)).resolves.toEqual([
			diagnosticFor('latest diagnostics')
		]);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);
		expect(runDiagnostics.mock.calls.map(([request]) => request.code)).toEqual(['BAD', 'BAD']);
	});

	it.each([false, true])(
		'invalidates cached diagnostics on reinitialize (singleFlight=%s)',
		async (singleFlight) => {
			const runDiagnostics = vi.fn(
				async ({ mode }: StaticWorkerDiagnosticConfig & { mode?: string }) => ({
					error: mode
				})
			);
			const service = createTestService(runDiagnostics, singleFlight);
			const context = contextFor(testDocument);
			service.initialize?.({ ...testConfig, mode: 'first mode' }, context);
			await expect(service.diagnostics?.(testDocument, context)).resolves.toEqual([
				diagnosticFor('first mode')
			]);
			service.initialize?.({ ...testConfig, mode: 'second mode' }, context);
			await expect(service.diagnostics?.(testDocument, context)).resolves.toEqual([
				diagnosticFor('second mode')
			]);
			expect(runDiagnostics).toHaveBeenCalledTimes(2);
		}
	);

	it.each([false, true])(
		'discards in-flight results from a previous initialization (singleFlight=%s)',
		async (singleFlight) => {
			let releaseFirst!: (result: { error: string }) => void;
			const runDiagnostics = vi
				.fn<StaticWorkerDiagnosticRunner<StaticWorkerDiagnosticConfig>>()
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							releaseFirst = resolve;
						})
				)
				.mockResolvedValue({ error: 'new generation' });
			const service = createTestService(runDiagnostics, singleFlight);
			const context = contextFor(testDocument);
			service.initialize?.(testConfig, context);
			const old = service.diagnostics?.(testDocument, context);
			await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
			service.initialize?.(testConfig, context);
			const latest = service.diagnostics?.(testDocument, context);
			await Promise.resolve();
			if (singleFlight) expect(runDiagnostics).toHaveBeenCalledTimes(1);
			releaseFirst({ error: 'old generation' });

			await expect(old).resolves.toEqual([]);
			await expect(latest).resolves.toEqual([diagnosticFor('new generation')]);
			await expect(service.diagnostics?.(testDocument, context)).resolves.toEqual([
				diagnosticFor('new generation')
			]);
			expect(runDiagnostics).toHaveBeenCalledTimes(2);
		}
	);

	it('owns a copy of diagnostics returned by the result converter', async () => {
		const source = [diagnosticFor('original')];
		const service = createStaticWorkerDiagnostics({
			languageName: 'Demo',
			loadProgressStage: 'load-demo-runtime',
			defaultActivePath: 'main.demo',
			timeoutMessage: 'Demo diagnostics timed out',
			runDiagnostics: async () => ({}),
			createMessage: () => ({}),
			diagnosticsFromResult: () => source
		});
		const context = contextFor(testDocument);
		service.initialize?.(testConfig, context);
		await service.diagnostics?.(testDocument, context);
		source[0].range.start.line = 10;
		source[0].range.end.line = 10;
		source[0].message = 'mutated';
		source.push(diagnosticFor('extra'));

		await expect(service.diagnostics?.(testDocument, context)).resolves.toEqual([
			diagnosticFor('original')
		]);
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
		const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const workerReceipt = {
			bytes: runnerWorkerBytes.byteLength,
			sha256: 'a'.repeat(64)
		};
		const runtimePreflight = {
			protocol: PERL_PREFLIGHT_PROTOCOL,
			protocolVersion: PERL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: BUNDLED_PERL_RUNTIME_PROFILE.profileId,
			artifactRevision: BUNDLED_PERL_RUNTIME_PROFILE.artifactRevision,
			webperlRevision: BUNDLED_PERL_RUNTIME_PROFILE.webperlRevision,
			perlRevision: BUNDLED_PERL_RUNTIME_PROFILE.perlRevision,
			emscriptenRevision: BUNDLED_PERL_RUNTIME_PROFILE.emscriptenRevision,
			manifestFingerprint: BUNDLED_PERL_RUNTIME_PROFILE.manifestFingerprint,
			manifestBytes: Uint8Array.of(1),
			javascriptBytes: Uint8Array.of(2),
			wasmBytes: Uint8Array.of(3),
			dataBytes: Uint8Array.of(4)
		};
		const config = {
			runnerWorkerBytes,
			runtimePreflight,
			maxAssetBytes: PERL_MAX_ASSET_BYTES,
			workerReceipt
		};

		service.initialize?.(config, context);
		await service.diagnostics?.(document, context);

		expect(mocks.runRuntimeWorkerDiagnostics).toHaveBeenCalledWith({
			runtime: 'perl',
			workerUrl: undefined,
			workerReceipt,
			workerBytes: runnerWorkerBytes,
			timeoutMessage: 'Perl diagnostics timed out',
			message: {
				runtimePreflight,
				maxAssetBytes: PERL_MAX_ASSET_BYTES,
				code: document.text,
				activePath: 'main.pl',
				args: [],
				stdin: '',
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
