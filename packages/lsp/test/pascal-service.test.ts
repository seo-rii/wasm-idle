import { describe, expect, it, vi } from 'vitest';

import {
	createPascalWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createPascalWorkerService', () => {
	it('uses the Pascal worker for diagnostics, completion, hover, and symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'main.pas(3,3) Error: identifier not found "UnknownThing"\nFatal: Compilation aborted'
		}));
		const service = createPascalWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.pas',
			languageId: 'pascal',
			version: 1,
			text: 'program Demo;\nfunction DoubleIt(Value: Integer): Integer;\nbegin\n  UnknownThing;\nend;\nbegin\n  WriteLn(DoubleIt(21));\nend.\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				baseUrl: 'https://static.example.com/wasm-pascal/',
				workerUrl: 'https://static.example.com/wasm-pascal/runner-worker.js'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 6, character: 7 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: 'https://static.example.com/wasm-pascal/',
			workerUrl: 'https://static.example.com/wasm-pascal/runner-worker.js',
			code: document.text,
			activePath: 'main.pas'
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 2, character: 2 },
					end: { line: 2, character: 3 }
				},
				severity: 1,
				source: 'pascal',
				message: 'identifier not found "UnknownThing"'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'WriteLn')).toBe(true);
		expect(hover?.contents.value).toContain('Writes values followed by a newline');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'Demo',
				kind: 2
			}),
			expect.objectContaining({
				name: 'DoubleIt',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-pascal-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('pascal-diagnostics');
	});
});
