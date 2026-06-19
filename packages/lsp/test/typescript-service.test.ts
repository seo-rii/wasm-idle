import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LspDocumentContext } from '../src/lsp';
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
});
