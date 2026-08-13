import { describe, expect, it, vi } from 'vitest';

import { createTclWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

const manifestFingerprint = 'a'.repeat(64);
const workerReceipt = { bytes: 123, sha256: 'b'.repeat(64) };
const workerOptions = {
	baseUrl: 'https://static.example.com/wasm-tcl/',
	workerUrl: 'https://static.example.com/wasm-tcl/runner-worker.js',
	manifestUrl: 'https://static.example.com/wasm-tcl/runtime-manifest.v2.json',
	manifestFingerprint,
	workerReceipt
};
const document: LspDocument = {
	uri: 'file:///workspace/main.tcl',
	languageId: 'tcl',
	version: 1,
	text: 'proc main {} {\n  set\n}\n'
};

describe('createTclWorkerService', () => {
	it('uses the Tcl worker for diagnostics, completion, hover, and symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'wrong # args: should be "set varName ?newValue?"\n    while executing\n"set"\n    (file "main.tcl" line 2)'
		}));
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor(document);

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
			{
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 1 }
				},
				severity: 1,
				source: 'tcl',
				message:
					'wrong # args: should be "set varName ?newValue?"\n    while executing\n"set"\n    (file "main.tcl" line 2)'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'puts')).toBe(true);
		expect(hover?.contents.value).toContain('Defines a Tcl procedure');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'main',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-tcl-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('tcl-diagnostics');
	});

	it('requires a pinned manifest and a valid worker receipt', () => {
		const service = createTclWorkerService(vi.fn(async () => ({})));
		const context = contextFor(document);

		expect(() =>
			service.initialize?.({ ...workerOptions, manifestFingerprint: 'not-a-digest' }, context)
		).toThrow('Tcl language server requires a manifest URL and fingerprint');
		expect(() =>
			service.initialize?.(
				{ ...workerOptions, workerReceipt: { bytes: 0, sha256: 'B'.repeat(64) } },
				context
			)
		).toThrow('Tcl language server requires a valid worker receipt');
	});

	it('invalidates cached diagnostics when either trust pin changes', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createTclWorkerService(runDiagnostics);
		const context = contextFor(document);

		await service.initialize?.(workerOptions, context);
		await service.diagnostics?.(document, context);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		await service.initialize?.(
			{ ...workerOptions, manifestFingerprint: 'c'.repeat(64) },
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);

		await service.initialize?.(
			{
				...workerOptions,
				manifestFingerprint: 'c'.repeat(64),
				workerReceipt: { bytes: 456, sha256: 'd'.repeat(64) }
			},
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(3);
	});
});
