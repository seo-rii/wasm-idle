import { describe, expect, it, vi } from 'vitest';
import { pathToUri, uriToPath, type LspDocument, type LspDocumentContext } from '../src/lsp.js';
import { createTypeScriptWorkerService } from '../src/typescript/service.js';
import { createLuaWorkerService } from '../src/lua/service.js';
import { createLispWorkerService } from '../src/lisp/service.js';

describe('LSP file URIs', () => {
	it.each(['lua', 'lisp'] as const)(
		'decodes an encoded filename before passing it to the %s compiler',
		async (language) => {
			const extension = language === 'lua' ? 'lua' : 'scm';
			const document: LspDocument = {
				uri: `file:///workspace/main%20%23%3F%2520.${extension}`,
				languageId: language,
				version: 1,
				text: language === 'lua' ? 'print(1)' : '(display 1)'
			};
			const context: LspDocumentContext = {
				documents: new Map([[document.uri, document]]),
				publishDiagnostics: vi.fn(),
				reportProgress: vi.fn()
			};
			const compile = vi.fn(async () => ({ success: true }));
			const service =
				language === 'lua'
					? createLuaWorkerService(async () => ({ compile }))
					: createLispWorkerService(async () => ({ compile }));
			await service.initialize?.(
				{
					moduleUrl: 'https://example.test/compiler.js',
					manifestFingerprint: 'a'.repeat(64)
				},
				context
			);
			await service.diagnostics?.(document, context);
			expect(compile).toHaveBeenCalledWith(
				expect.objectContaining({ fileName: `main #?%20.${extension}` })
			);
		}
	);

	it.each([
		['/workspace/main.ts', 'file:///workspace/main.ts'],
		['workspace/main.ts', 'file:///workspace/main.ts'],
		['/workspace/main#draft.ts', 'file:///workspace/main%23draft.ts'],
		['/workspace/main?draft.ts', 'file:///workspace/main%3Fdraft.ts'],
		['/workspace/main%20draft.ts', 'file:///workspace/main%2520draft.ts'],
		['/workspace/main draft.ts', 'file:///workspace/main%20draft.ts'],
		['/workspace/한글/문서.ts', 'file:///workspace/%ED%95%9C%EA%B8%80/%EB%AC%B8%EC%84%9C.ts'],
		['/workspace/line\nbreak.ts', 'file:///workspace/line%0Abreak.ts']
	])('round-trips the literal path %j', (path, expectedUri) => {
		expect(pathToUri(path)).toBe(expectedUri);
		expect(uriToPath(expectedUri)).toBe(path.startsWith('/') ? path : `/${path}`);
		expect(new URL(expectedUri).hash).toBe('');
		expect(new URL(expectedUri).search).toBe('');
	});

	it.each([
		'file:///workspace/main%23draft.ts',
		'file:///workspace/main%3Fdraft.ts',
		'file:///workspace/main%2520draft.ts',
		'file:///workspace/main%20draft.ts'
	])('returns TypeScript definitions to the same encoded document %s', async (uri) => {
		const document: LspDocument = {
			uri,
			languageId: 'typescript',
			version: 1,
			text: 'const target = 1;\ntarget;'
		};
		const context: LspDocumentContext = {
			documents: new Map([[uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createTypeScriptWorkerService('typescript', async () => ({}));
		await service.initialize?.({ compilerOptions: { noLib: true } }, context);
		try {
			expect(
				await service.definition?.(document, { line: 1, character: 2 }, context)
			).toEqual([
				{
					uri,
					range: {
						start: { line: 0, character: 6 },
						end: { line: 0, character: 12 }
					}
				}
			]);
		} finally {
			await service.dispose?.();
		}
	});
});
