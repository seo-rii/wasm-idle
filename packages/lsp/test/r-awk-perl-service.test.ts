import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
	createAwkWorkerService,
	createPerlWorkerService,
	createRWorkerService,
	type LspDocument,
	type LspDocumentContext,
	type AwkWorkerOptions,
	type PerlWorkerOptions
} from '../src/index.js';
import {
	AWK_MAX_ASSET_BYTES,
	PERL_MAX_ASSET_BYTES,
	type AwkRuntimePreflightPayload,
	type PerlRuntimePreflightPayload
} from '@wasm-idle/core';
import { BUNDLED_AWK_RUNTIME_PROFILE } from '../src/bundledAwkRuntime.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createRWorkerService', () => {
	it('uses WebR-backed parser hooks and exposes R editor features', async () => {
		const parser = {
			parse: vi.fn(async () => [
				{
					lineNumber: 2,
					columnNumber: 4,
					message: '<text>:2:4: unexpected end of input'
				}
			]),
			dispose: vi.fn()
		};
		const loadParser = vi.fn(async () => parser);
		const service = createRWorkerService(loadParser);
		const document: LspDocument = {
			uri: 'file:///workspace/main.R',
			languageId: 'r',
			version: 1,
			text: 'main <- function() {\n  print(\n'
		};
		const context = contextFor(document);

		await service.initialize?.({ baseUrl: '/webr/0.6.0/' }, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(document, { line: 0, character: 9 }, context);
		await service.dispose?.();

		expect(loadParser).toHaveBeenCalledWith({ baseUrl: '/webr/0.6.0/' });
		expect(parser.parse).toHaveBeenCalledWith(document.text);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'r',
				message: '<text>:2:4: unexpected end of input',
				range: {
					start: { line: 1, character: 3 },
					end: { line: 1, character: 4 }
				}
			})
		]);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(hover?.contents.value).toContain('Defines an R function');
		expect(parser.dispose).toHaveBeenCalled();
		expect(context.reportProgress).toHaveBeenCalledWith('load-r-runtime');
	});
});

describe('createAwkWorkerService', () => {
	const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
	const createWorkerOptions = (): AwkWorkerOptions => {
		const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const goShimBytes = new TextEncoder().encode('globalThis.Go = class {};');
		const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
		const runtimePreflight: AwkRuntimePreflightPayload = {
			protocol: 'wasm-idle-awk-runtime-v2',
			goShimBytes,
			wasmBytes
		};
		const workerReceipt = {
			bytes: runnerWorkerBytes.byteLength,
			sha256: sha256(runnerWorkerBytes)
		};
		return {
			manifestUrl: `https://assets.example.com/wasm-awk/runtime-manifest.v2.json?v=${BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint}`,
			maxAssetBytes: AWK_MAX_ASSET_BYTES,
			profile: {
				...BUNDLED_AWK_RUNTIME_PROFILE,
				workerReceipt,
				goShimReceipt: { bytes: goShimBytes.byteLength, sha256: sha256(goShimBytes) },
				wasmReceipt: {
					bytes: wasmBytes.byteLength,
					sha256: sha256(wasmBytes),
					uncompressedBytes: wasmBytes.byteLength,
					uncompressedSha256: sha256(wasmBytes)
				}
			},
			runnerWorkerBytes,
			runtimePreflight,
			workerReceipt
		};
	};

	it('checks syntax through the configured GoAWK worker and exposes AWK symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'parse error at 2:5: unexpected newline'
		}));
		const service = createAwkWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.awk',
			languageId: 'awk',
			version: 1,
			text: 'function total(x) {\n  print(\n}\n'
		};
		const context = contextFor(document);
		const workerOptions = createWorkerOptions();

		await service.initialize?.(workerOptions, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			...workerOptions,
			code: document.text,
			activePath: 'main.awk'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'awk',
				message: 'parse error at 2:5: unexpected newline',
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === 'BEGIN')).toBe(true);
		expect(symbols).toEqual([expect.objectContaining({ name: 'total' })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-awk-runtime');
	});
});

describe('createPerlWorkerService', () => {
	const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
	const workerReceipt = { bytes: runnerWorkerBytes.byteLength, sha256: 'b'.repeat(64) };
	const createRuntimePreflight = (
		overrides: Partial<PerlRuntimePreflightPayload> = {}
	): PerlRuntimePreflightPayload => ({
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
		dataBytes: Uint8Array.of(4),
		...overrides
	});
	const createWorkerOptions = (
		overrides: Partial<PerlWorkerOptions> = {}
	): PerlWorkerOptions => ({
		workerReceipt,
		runnerWorkerBytes,
		runtimePreflight: createRuntimePreflight(),
		maxAssetBytes: PERL_MAX_ASSET_BYTES,
		...overrides
	});

	it('checks syntax through the configured WebPerl worker and exposes Perl symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'Perl exited with status 255.',
			output: 'syntax error at main.pl line 2, near "print("\\n'
		}));
		const service = createPerlWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'sub main {\n  print(\n}\n'
		};
		const context = contextFor(document);
		const workerOptions = createWorkerOptions();

		await service.initialize?.(workerOptions, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			...workerOptions,
			code: document.text,
			activePath: 'main.pl'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'perl',
				message: 'syntax error at main.pl line 2, near "print("\\n',
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 1 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === 'sub')).toBe(true);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-perl-runtime');
	});

	it('strictly rejects malformed or over-limit verified initialization data', () => {
		const service = createPerlWorkerService(vi.fn(async () => ({})));
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'print "ok\\n";\n'
		};
		const context = contextFor(document);
		const workerOptions = createWorkerOptions();
		const initialize = (value: unknown) => service.initialize?.(value, context);

		expect(() => initialize({ ...workerOptions, unexpected: true })).toThrow(
			'exact verified runtime configuration'
		);
		expect(() =>
			initialize({ ...workerOptions, workerReceipt: { bytes: 0, sha256: 'B'.repeat(64) } })
		).toThrow('valid runner receipt');
		expect(() => initialize({ ...workerOptions, runnerWorkerBytes: Uint8Array.of(1) })).toThrow(
			'receipt-sized runner bytes'
		);
		expect(() =>
			initialize({
				...workerOptions,
				runtimePreflight: { ...workerOptions.runtimePreflight, unexpected: true }
			})
		).toThrow('strict runtime preflight payload');
		const sharedBytes = Uint8Array.of(0, 1, 2);
		expect(() =>
			initialize({
				...workerOptions,
				runtimePreflight: createRuntimePreflight({
					javascriptBytes: sharedBytes.subarray(1)
				})
			})
		).toThrow('owned runtime preflight bytes');
		expect(() => initialize({ ...workerOptions, maxAssetBytes: 0 })).toThrow(
			'valid maxAssetBytes limit'
		);
		expect(() =>
			initialize({
				...workerOptions,
				maxAssetBytes: 1,
				workerReceipt: { bytes: 1, sha256: 'c'.repeat(64) },
				runnerWorkerBytes: Uint8Array.of(1),
				runtimePreflight: createRuntimePreflight({ javascriptBytes: Uint8Array.of(1, 2) })
			})
		).toThrow('runtime preflight exceeds maxAssetBytes');
	});

	it('keys successful diagnostics by the complete content identity', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createPerlWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'print "ok\\n";\n'
		};
		const context = contextFor(document);
		const configurations = [
			createWorkerOptions(),
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'e'.repeat(64) })
			}),
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ webperlRevision: '5'.repeat(40) })
			}),
			createWorkerOptions({
				workerReceipt: { bytes: runnerWorkerBytes.byteLength, sha256: 'f'.repeat(64) }
			}),
			createWorkerOptions({ maxAssetBytes: PERL_MAX_ASSET_BYTES - 1 })
		];
		for (const config of configurations) {
			service.initialize?.(config, context);
			await service.diagnostics?.(document, context);
			await service.diagnostics?.(document, context);
		}

		expect(runDiagnostics).toHaveBeenCalledTimes(configurations.length);
	});

	it('retries a failed verified run and shares only pending successful work', async () => {
		let releaseRun!: (value: { error?: string }) => void;
		const runDiagnostics = vi
			.fn()
			.mockRejectedValueOnce(new Error('runner integrity verification failed'))
			.mockImplementationOnce(
				() =>
					new Promise<{ error?: string }>((resolve) => {
						releaseRun = resolve;
					})
			);
		const service = createPerlWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'print "ok\\n";\n'
		};
		const context = contextFor(document);

		await service.initialize?.(createWorkerOptions(), context);
		await expect(service.diagnostics?.(document, context)).rejects.toThrow(
			'runner integrity verification failed'
		);
		const first = service.diagnostics?.(document, context);
		const second = service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);
		releaseRun({});
		await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual([]);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);
	});
});
