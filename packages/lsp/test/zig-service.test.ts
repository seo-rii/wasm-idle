import { describe, expect, it, vi } from 'vitest';

import { createZigWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createZigWorkerService', () => {
	it('uses the wasm-zig compiler host for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async (request) => ({
			success: false,
			diagnostics: [
				{
					fileName: request.activePath,
					lineNumber: 2,
					columnNumber: 9,
					severity: 'error' as const,
					message: 'use of undeclared identifier missing'
				}
			],
			stderr: 'main.zig:2:9: error: use of undeclared identifier missing'
		}));
		const service = createZigWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.zig',
			languageId: 'zig',
			version: 1,
			text: 'pub fn main() void {\n    missing();\n}\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[document.uri, document],
				[
					'file:///workspace/src/helper.zig',
					{
						uri: 'file:///workspace/src/helper.zig',
						languageId: 'zig',
						version: 1,
						text: 'pub const helper = 1;\n'
					}
				]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				compilerUrl: 'https://static.example.com/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://static.example.com/wasm-zig/std.zip'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 4 }, context);

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: document.text,
				activePath: 'main.zig',
				targetTriple: 'wasm64-wasi',
				compileArgs: [],
				log: false
			})
		);
		expect(compile.mock.calls[0][0].workspaceFiles).toEqual(
			expect.arrayContaining([
				{ path: 'main.zig', content: document.text },
				{ path: 'src/helper.zig', content: 'pub const helper = 1;\n' }
			])
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 8 },
					end: { line: 1, character: 9 }
				},
				severity: 1,
				source: 'zig',
				message: 'use of undeclared identifier missing'
			}
		]);
		expect(completions?.items.some((item) => item.label === '@import')).toBe(true);
		expect(hover?.contents.value).toContain('Declares a function');
		expect(context.reportProgress).toHaveBeenCalledWith('load-zig-compiler');
		expect(context.reportProgress).toHaveBeenCalledWith('zig-diagnostics');
	});
});
