import { describe, expect, it, vi } from 'vitest';

import {
	createHaskellWorkerService,
	parseHaskellDiagnostics,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createHaskellWorkerService', () => {
	it('uses the wasm GHC host for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async (request) => ({
			success: false,
			diagnostics: [
				{
					fileName: request.activePath,
					lineNumber: 3,
					columnNumber: 9,
					severity: 'error' as const,
					message: 'Variable not in scope: missing'
				}
			],
			stderr: 'main.hs:3:9: error: Variable not in scope: missing'
		}));
		const service = createHaskellWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.hs',
			languageId: 'haskell',
			version: 1,
			text: 'main :: IO ()\nmain = do\n  print missing\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[document.uri, document],
				[
					'file:///workspace/src/Helper.hs',
					{
						uri: 'file:///workspace/src/Helper.hs',
						languageId: 'haskell',
						version: 1,
						text: 'module Helper where\nhelper = 1\n'
					}
				]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				moduleUrl: 'https://static.example.com/wasm-haskell/dyld.mjs',
				rootfsUrl: 'https://static.example.com/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: 'https://static.example.com/wasm-haskell/bsdtar.wasm'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 1, character: 8 }, context);

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: document.text,
				activePath: 'main.hs',
				ghcArgs: '-fno-code -Wall',
				log: false
			})
		);
		expect(compile.mock.calls[0][0].workspaceFiles).toEqual(
			expect.arrayContaining([
				{ path: 'main.hs', content: document.text },
				{ path: 'src/Helper.hs', content: 'module Helper where\nhelper = 1\n' }
			])
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 2, character: 8 },
					end: { line: 2, character: 9 }
				},
				severity: 1,
				source: 'haskell',
				message: 'Variable not in scope: missing'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'module')).toBe(true);
		expect(hover?.contents.value).toContain('Sequences monadic actions');
		expect(context.reportProgress).toHaveBeenCalledWith('haskell-diagnostics');
	});

	it('parses multi-line GHC diagnostics', () => {
		expect(
			parseHaskellDiagnostics(`main.hs:4:7: error:\n    Variable not in scope: missing\n`)
		).toEqual([
			{
				fileName: 'main.hs',
				lineNumber: 4,
				columnNumber: 7,
				severity: 'error',
				message: 'Variable not in scope: missing'
			}
		]);
	});
});
