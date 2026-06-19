import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LspDocument, LspDocumentContext } from '../src/lsp';
import { createTypeScriptWorkerService } from '../src/typescript/service';

describe('TypeScript worker service', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('loads bundled standard libraries from the gzipped asset', async () => {
		const libraries = {
			'lib.es2022.full.d.ts':
				'interface Array<T> {}\ndeclare const console: { log(...args: unknown[]): void };'
		};
		const compressed = gzipSync(JSON.stringify(libraries), { level: 9, mtime: 0 });
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			expect(String(url)).toMatch(/typescript-libs\.json\.gz$/);
			return new Response(compressed, {
				status: 200,
				headers: {
					'content-length': String(compressed.byteLength),
					'content-type': 'application/gzip'
				}
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const reportProgress = vi.fn();
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};
		const service = createTypeScriptWorkerService('typescript');

		await service.initialize?.({ language: 'typescript' }, context);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(reportProgress).toHaveBeenCalledWith('load-typescript-libs');
	});

	it('loads standard libraries from an explicit URL when provided', async () => {
		const libraries = {
			'lib.es2022.full.d.ts': 'declare const console: { log(...args: unknown[]): void };'
		};
		const compressed = gzipSync(JSON.stringify(libraries), { level: 9, mtime: 0 });
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			expect(String(url)).toBe('/lsp/typescript-libs.json.gz');
			return new Response(compressed, {
				status: 200,
				headers: {
					'content-type': 'application/gzip'
				}
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const service = createTypeScriptWorkerService('typescript');

		await service.initialize?.(
			{ language: 'typescript', libUrl: '/lsp/typescript-libs.json.gz' },
			{
				documents: new Map(),
				publishDiagnostics: vi.fn(),
				reportProgress: vi.fn()
			}
		);

		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('returns TypeScript diagnostics, completions, and hover details from the language service', async () => {
		const invalidDocument: LspDocument = {
			uri: 'file:///workspace/main.ts',
			languageId: 'typescript',
			version: 1,
			text: 'const value: string = ;\n'
		};
		const completionDocument: LspDocument = {
			uri: 'file:///workspace/completion.ts',
			languageId: 'typescript',
			version: 1,
			text: 'const alpha = 1;\nconst beta = al'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[invalidDocument.uri, invalidDocument],
				[completionDocument.uri, completionDocument]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createTypeScriptWorkerService('typescript', async () => ({
			'lib.es2022.full.d.ts': ''
		}));

		await service.initialize?.(
			{
				language: 'typescript',
				compilerOptions: {
					noLib: true
				}
			},
			context
		);

		const diagnostics = await service.diagnostics?.(invalidDocument, context);
		const completions = (await service.completion?.(
			completionDocument,
			{ line: 1, character: 15 },
			context
		)) as { items: Array<{ label: string }> };
		const hover = await service.hover?.(completionDocument, { line: 0, character: 7 }, context);

		expect(diagnostics?.some((diagnostic) => diagnostic.message.includes('Expression expected'))).toBe(
			true
		);
		expect(completions.items.some((item) => item.label === 'alpha')).toBe(true);
		expect(hover?.contents.value).toContain('const alpha');
	});

	it('uses checked JavaScript mode for JavaScript documents', async () => {
		const document: LspDocument = {
			uri: 'file:///workspace/main.js',
			languageId: 'javascript',
			version: 1,
			text: 'const amount = 1;\nconst next = amo'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createTypeScriptWorkerService('javascript', async () => ({
			'lib.es2022.full.d.ts': ''
		}));

		await service.initialize?.(
			{
				language: 'javascript',
				compilerOptions: {
					noLib: true
				}
			},
			context
		);

		const completions = (await service.completion?.(
			document,
			{ line: 1, character: 16 },
			context
		)) as { items: Array<{ label: string }> };

		expect(completions.items.some((item) => item.label === 'amount')).toBe(true);
	});
});
