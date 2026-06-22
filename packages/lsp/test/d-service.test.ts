import { describe, expect, it, vi } from 'vitest';

import { createDWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createDWorkerService', () => {
	it('uses the wasm-d compiler API for diagnostics, completion, hover, and symbols', async () => {
		const compile = vi.fn(async (request) => {
			request.onProgress?.({ stage: 'compile', completed: 30, total: 100 });
			return {
				success: false,
				diagnostics: [
					{
						fileName: request.fileName,
						lineNumber: 4,
						columnNumber: 5,
						severity: 'error' as const,
						message: 'undefined identifier missing'
					}
				],
				stderr: 'main.d:4:5: Error: undefined identifier missing'
			};
		});
		const service = createDWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.d',
			languageId: 'd',
			version: 1,
			text: 'import std.stdio;\n\nvoid main() {\n    missing();\n}\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				moduleUrl: 'https://static.example.com/wasm-d/index.js',
				compileArgs: ['-preview=dip1000']
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 2, character: 2 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: document.text,
				fileName: 'main.d',
				target: 'wasm32-wasi',
				compileArgs: ['-preview=dip1000'],
				log: false
			})
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 3, character: 4 },
					end: { line: 3, character: 5 }
				},
				severity: 1,
				source: 'd',
				message: 'undefined identifier missing'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'writeln')).toBe(true);
		expect(hover?.contents.value).toContain('absence of a value');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'main',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-d-compiler');
		expect(context.reportProgress).toHaveBeenCalledWith('d-diagnostics');
		expect(context.reportProgress).toHaveBeenCalledWith('compile', 30, 100);
	});
});
