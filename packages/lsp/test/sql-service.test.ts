import { describe, expect, it, vi } from 'vitest';

import { createSqlWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createSqlWorkerService', () => {
	it('validates through the configured SQL engine and provides editor features', async () => {
		const loadEngine = vi.fn(async () => ({
			validate: vi.fn(() => [
				{
					message: 'near "FROM": syntax error',
					severity: 'error' as const
				}
			])
		}));
		const service = createSqlWorkerService(loadEngine);
		const document: LspDocument = {
			uri: 'file:///workspace/main.sql',
			languageId: 'sql',
			version: 1,
			text: 'SELECT FROM users;'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.({ dialect: 'sqlite', wasmUrl: '/sql-wasm.wasm' }, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 2 }, context);

		expect(loadEngine).toHaveBeenCalledWith({
			dialect: 'sqlite',
			wasmUrl: '/sql-wasm.wasm'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'sql',
				message: 'near "FROM": syntax error',
				range: {
					start: { line: 0, character: 7 },
					end: { line: 0, character: 8 }
				}
			})
		]);
		expect(completions?.items.some((item) => item.label === 'SELECT')).toBe(true);
		expect(hover?.contents.value).toContain('Reads rows');
		expect(context.reportProgress).toHaveBeenCalledWith('load-sqlite-language-service');
	});

	it('passes DuckDB bundles to the configured SQL engine', async () => {
		const duckdbBundles = {
			mvp: {
				mainModule: '/duckdb-mvp.wasm',
				mainWorker: '/duckdb-browser-mvp.worker.js'
			}
		};
		const loadEngine = vi.fn(async () => ({
			validate: vi.fn(() => [])
		}));
		const service = createSqlWorkerService(loadEngine);
		const document: LspDocument = {
			uri: 'file:///workspace/main.sql',
			languageId: 'sql',
			version: 1,
			text: "SELECT 'ok';"
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.({ dialect: 'duckdb', duckdbBundles }, context);
		await service.diagnostics?.(document, context);

		expect(loadEngine).toHaveBeenCalledWith({
			dialect: 'duckdb',
			duckdbBundles
		});
		expect(context.reportProgress).toHaveBeenCalledWith('load-duckdb-language-service');
	});
});
