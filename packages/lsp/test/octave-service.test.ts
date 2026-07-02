import { describe, expect, it, vi } from 'vitest';

import {
	createOctaveWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createOctaveWorkerService', () => {
	it('uses the Octave worker for diagnostics, completion, hover, and symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'error: parse error near line 2 of file /workspace/main.m\n\n  syntax error'
		}));
		const service = createOctaveWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.m',
			languageId: 'octave',
			version: 1,
			text: 'function y = main()\n  y = fgetl(stdin\nend\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				baseUrl: 'https://static.example.com/wasm-octave/runtime/',
				workerUrl: 'https://static.example.com/wasm-octave/runner-worker.js',
				manifestUrl:
					'https://static.example.com/wasm-octave/runtime/runtime-manifest.v1.json'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 1, character: 10 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: 'https://static.example.com/wasm-octave/runtime/',
			workerUrl: 'https://static.example.com/wasm-octave/runner-worker.js',
			manifestUrl: 'https://static.example.com/wasm-octave/runtime/runtime-manifest.v1.json',
			code: document.text,
			activePath: 'main.m'
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 1 }
				},
				severity: 1,
				source: 'octave',
				message:
					'error: parse error near line 2 of file /workspace/main.m\n\n  syntax error'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'function')).toBe(true);
		expect(hover?.contents.value).toContain('Reads a line from a file handle');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'main',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-octave-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('octave-diagnostics');
	});
});
