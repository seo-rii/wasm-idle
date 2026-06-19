import { describe, expect, it, vi } from 'vitest';

import { createLuaWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createLuaWorkerService', () => {
	it('uses the wasm-lua compiler for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					lineNumber: 2,
					columnNumber: 7,
					endColumnNumber: 10,
					severity: 'error' as const,
					message: 'unexpected symbol near end'
				}
			]
		}));
		const service = createLuaWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.lua',
			languageId: 'lua',
			version: 1,
			text: 'local value = 1\nprint(value + )\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				moduleUrl: 'https://static.example.com/wasm-lua/index.js'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 1, character: 2 }, context);

		expect(compile).toHaveBeenCalledWith({
			code: document.text,
			fileName: 'main.lua',
			log: false
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 6 },
					end: { line: 1, character: 9 }
				},
				severity: 1,
				source: 'lua',
				message: 'unexpected symbol near end'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'local')).toBe(true);
		expect(hover?.contents.value).toContain('Writes values to standard output');
		expect(context.reportProgress).toHaveBeenCalledWith('load-lua-compiler');
		expect(context.reportProgress).toHaveBeenCalledWith('lua-diagnostics');
	});
});
