import { describe, expect, it, vi } from 'vitest';

import {
	TCL_MAX_ASSET_BYTES,
	TCL_PREFLIGHT_PROTOCOL,
	TCL_PREFLIGHT_PROTOCOL_VERSION,
	type TclRuntimePreflightPayload
} from '@wasm-idle/core';
import {
	createTclWorkerService,
	type LspDocument,
	type LspDocumentContext,
	type TclWorkerOptions
} from '../src/index.js';

const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
const workerReceipt = { bytes: runnerWorkerBytes.byteLength, sha256: 'b'.repeat(64) };

const createRuntimePreflight = (
	overrides: Partial<TclRuntimePreflightPayload> = {}
): TclRuntimePreflightPayload => ({
	protocol: TCL_PREFLIGHT_PROTOCOL,
	protocolVersion: TCL_PREFLIGHT_PROTOCOL_VERSION,
	profileId: 'wacl-test-tcl-8.6.6',
	artifactRevision: '1'.repeat(40),
	waclRevision: '2'.repeat(40),
	tclRevision: '3'.repeat(40),
	requireJsRevision: '4'.repeat(40),
	emscriptenRevision: '5'.repeat(40),
	manifestFingerprint: 'a'.repeat(64),
	manifestBytes: Uint8Array.of(1),
	requireJsBytes: Uint8Array.of(2),
	customDataBytes: Uint8Array.of(3),
	libraryDataBytes: Uint8Array.of(4),
	glueBytes: Uint8Array.of(5),
	wasmBytes: Uint8Array.of(6),
	...overrides
});

const createWorkerOptions = (overrides: Partial<TclWorkerOptions> = {}): TclWorkerOptions => ({
	workerReceipt,
	runnerWorkerBytes,
	runtimePreflight: createRuntimePreflight(),
	maxAssetBytes: TCL_MAX_ASSET_BYTES,
	...overrides
});

const document: LspDocument = {
	uri: 'file:///workspace/main.tcl',
	languageId: 'tcl',
	version: 1,
	text: 'proc main {} {\n  set\n}\n'
};
const contextFor = (): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createTclWorkerService', () => {
	it('forwards only verified bytes and the strict preflight payload to diagnostics', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'wrong # args: should be "set varName ?newValue?"\n    while executing\n"set"\n    (file "main.tcl" line 2)'
		}));
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor();
		const workerOptions = createWorkerOptions();

		await service.initialize?.(workerOptions, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 3 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith({
			...workerOptions,
			code: document.text,
			activePath: 'main.tcl'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'tcl',
				message:
					'wrong # args: should be "set varName ?newValue?"\n    while executing\n"set"\n    (file "main.tcl" line 2)'
			})
		]);
		expect(completions?.items.some((item) => item.label === 'puts')).toBe(true);
		expect(hover?.contents.value).toContain('Defines a Tcl procedure');
		expect(symbols).toEqual([expect.objectContaining({ name: 'main', kind: 12 })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-tcl-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('tcl-diagnostics');
	});

	it('strictly rejects missing, extra, malformed, and over-limit initialization data', () => {
		const context = contextFor();
		const initialize = (value: unknown) =>
			createTclWorkerService(vi.fn(async () => ({}))).initialize?.(value, context);
		const workerOptions = createWorkerOptions();

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
		expect(() => initialize({ ...workerOptions, maxAssetBytes: 0 })).toThrow(
			'valid maxAssetBytes limit'
		);
		expect(() =>
			initialize({
				...workerOptions,
				maxAssetBytes: 1,
				workerReceipt: { bytes: 1, sha256: 'c'.repeat(64) },
				runnerWorkerBytes: Uint8Array.of(1),
				runtimePreflight: createRuntimePreflight({ requireJsBytes: Uint8Array.of(1, 2) })
			})
		).toThrow('runtime preflight exceeds maxAssetBytes');
	});

	it('invalidates cached diagnostics when compact profile or runner identity changes', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor();
		const workerOptions = createWorkerOptions();

		await service.initialize?.(workerOptions, context);
		await service.diagnostics?.(document, context);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		await service.initialize?.(
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'c'.repeat(64) })
			}),
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);

		await service.initialize?.(
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'c'.repeat(64) }),
				workerReceipt: { ...workerReceipt, sha256: 'd'.repeat(64) }
			}),
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(3);
	});

	it('retries a failed verified run and caches only successful diagnostics', async () => {
		const runDiagnostics = vi
			.fn()
			.mockRejectedValueOnce(new Error('worker integrity verification failed'))
			.mockResolvedValueOnce({});
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(createWorkerOptions(), context);
		await expect(service.diagnostics?.(document, context)).rejects.toThrow(
			'worker integrity verification failed'
		);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual([]);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual([]);

		expect(runDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('shares one pending verified run between concurrent requests for the same document', async () => {
		let resolveRun!: (result: { error?: string }) => void;
		const runDiagnostics = vi.fn(
			() =>
				new Promise<{ error?: string }>((resolve) => {
					resolveRun = resolve;
				})
		);
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(createWorkerOptions(), context);
		const first = service.diagnostics?.(document, context);
		const second = service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		resolveRun({ error: 'wrong # args at line 2' });
		const [firstDiagnostics, secondDiagnostics] = await Promise.all([first, second]);

		expect(firstDiagnostics).toEqual(secondDiagnostics);
		expect(firstDiagnostics).toHaveLength(1);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual(firstDiagnostics);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);
	});
});
