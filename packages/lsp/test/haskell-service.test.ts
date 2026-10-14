import { describe, expect, it, vi } from 'vitest';
import { HASKELL_RUNTIME_ASSET_RECEIPTS } from '@wasm-idle/core';

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

	it('parses GHC 9.6+ diagnostics with error codes, flag tags, and spans', () => {
		expect(
			parseHaskellDiagnostics(`main.hs:3:8: error: [GHC-88464]
    Variable not in scope: nope :: IO ()
  |
3 | main = nope
  |        ^^^^

main.hs:5:15-21: error: [GHC-83865]
    • Couldn't match type ‘[Char]’ with ‘Int’
      Expected: Int
        Actual: String
  |
5 | other = print ("hello" :: Int)
  |               ^^^^^^^

src/Helper.hs:(7,1)-(8,15): warning: [GHC-62161] [-Wincomplete-patterns]
    Pattern match(es) are non-exhaustive
  |
7 | classify 0 = "zero"
  | ^^^^^^^^^^^^^^^^^^^...

main.hs:10:1: error: [GHC-40910] [-Wunused-top-binds, Werror=unused-top-binds]
    Defined but not used: ‘unused’
   |
10 | unused = 1
   | ^^^^^^

main.hs:12:7: error: [GHC-58481] parse error on input ‘=’
   |
12 | broken = = 1
   |          ^`)
		).toEqual([
			{
				fileName: 'main.hs',
				lineNumber: 3,
				columnNumber: 8,
				severity: 'error',
				message: 'Variable not in scope: nope :: IO ()'
			},
			{
				fileName: 'main.hs',
				lineNumber: 5,
				columnNumber: 15,
				severity: 'error',
				message: "• Couldn't match type ‘[Char]’ with ‘Int’"
			},
			{
				fileName: 'src/Helper.hs',
				lineNumber: 7,
				columnNumber: 1,
				severity: 'warning',
				message: 'Pattern match(es) are non-exhaustive'
			},
			{
				fileName: 'main.hs',
				lineNumber: 10,
				columnNumber: 1,
				severity: 'error',
				message: 'Defined but not used: ‘unused’'
			},
			{
				fileName: 'main.hs',
				lineNumber: 12,
				columnNumber: 7,
				severity: 'error',
				message: 'parse error on input ‘=’'
			}
		]);
	});

	it('preserves the active compiler, arguments, and diagnostics cache after failed reinitialization', async () => {
		const compile = vi.fn(async () => ({
			success: true,
			diagnostics: []
		}));
		const loadCompiler = vi
			.fn()
			.mockResolvedValueOnce({ compile })
			.mockRejectedValueOnce(new Error('replacement integrity failure'));
		const service = createHaskellWorkerService(loadCompiler);
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const document: LspDocument = {
			uri: 'file:///workspace/main.hs',
			languageId: 'haskell',
			version: 1,
			text: 'main = pure ()\n'
		};

		await service.initialize?.(
			{
				moduleUrl: 'https://static.example.com/wasm-haskell/dyld.mjs',
				rootfsUrl: 'https://static.example.com/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: 'https://static.example.com/wasm-haskell/bsdtar.wasm',
				integrity: HASKELL_RUNTIME_ASSET_RECEIPTS,
				ghcArgs: '-Wall'
			},
			context
		);
		await service.diagnostics?.(document, context);

		await expect(
			service.initialize?.(
				{
					moduleUrl: 'https://replacement.example.com/dyld.mjs',
					rootfsUrl: 'https://replacement.example.com/rootfs.tar.zst',
					bsdtarUrl: 'https://replacement.example.com/bsdtar.wasm',
					integrity: HASKELL_RUNTIME_ASSET_RECEIPTS,
					ghcArgs: '-Werror'
				},
				context
			)
		).rejects.toThrow('replacement integrity failure');

		await service.diagnostics?.(document, context);
		expect(compile).toHaveBeenCalledOnce();

		const changedDocument = { ...document, version: 2, text: 'main = print 1\n' };
		await service.diagnostics?.(changedDocument, context);
		expect(compile).toHaveBeenCalledTimes(2);
		expect(compile.mock.calls[1][0].ghcArgs).toBe('-Wall');
	});
});
