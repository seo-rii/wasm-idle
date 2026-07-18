import { describe, expect, it, vi } from 'vitest';

import { createSqlWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createSqlWorkerService', () => {
	it('uses the SQLite WASM URL exported by the static runtime module', async () => {
		const stateKey = '__wasmIdleSqliteLspRuntimeTest';
		const state = {
			wasmUrl: '',
			executed: '',
			closed: false
		};
		(globalThis as Record<string, unknown>)[stateKey] = state;
		const moduleUrl = `data:text/javascript,${encodeURIComponent(`
			export const sqliteWasmUrl = '/bundled/sql-wasm.wasm';
			export default async function initSqlJs(options) {
				globalThis.${stateKey}.wasmUrl = options.locateFile('sql-wasm.wasm');
				return {
					Database: class {
						exec(code) { globalThis.${stateKey}.executed = code; }
						close() { globalThis.${stateKey}.closed = true; }
					}
				};
			}
		`)}`;
		const service = createSqlWorkerService();
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

		try {
			await service.initialize?.({ dialect: 'sqlite', moduleUrl }, context);
			expect(await service.diagnostics?.(document, context)).toEqual([]);
			expect(state).toEqual({
				wasmUrl: '/bundled/sql-wasm.wasm',
				executed: "SELECT 'ok';",
				closed: true
			});
		} finally {
			Reflect.deleteProperty(globalThis, stateKey);
		}
	});

	it('uses DuckDB bundles exported by the static runtime module', async () => {
		const stateKey = '__wasmIdleDuckDbLspRuntimeTest';
		const state = {
			selectedBundles: null as unknown,
			instantiated: [] as Array<string | null>,
			queried: '',
			closed: false,
			terminated: false
		};
		(globalThis as Record<string, unknown>)[stateKey] = state;
		const moduleUrl = `data:text/javascript,${encodeURIComponent(`
			export const bundles = {
				mvp: {
					mainModule: '/bundled/duckdb-mvp.wasm',
					mainWorker: '/bundled/duckdb-browser-mvp.worker.js'
				}
			};
			export const duckdb = {
				async selectBundle(value) {
					globalThis.${stateKey}.selectedBundles = value;
					return { ...value.mvp, pthreadWorker: null };
				},
				VoidLogger: class {},
				AsyncDuckDB: class {
					async instantiate(mainModule, pthreadWorker) {
						globalThis.${stateKey}.instantiated = [mainModule, pthreadWorker];
					}
					async reset() {}
					async connect() {
						return {
							async query(code) { globalThis.${stateKey}.queried = code; },
							async close() { globalThis.${stateKey}.closed = true; }
						};
					}
					async terminate() { globalThis.${stateKey}.terminated = true; }
				}
			};
		`)}`;
		const WorkerMock = vi.fn(function MockWorker() {});
		vi.stubGlobal('Worker', WorkerMock);
		const createObjectURL = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValue('blob:duckdb-worker');
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const service = createSqlWorkerService();
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

		try {
			await service.initialize?.({ dialect: 'duckdb', moduleUrl }, context);
			expect(await service.diagnostics?.(document, context)).toEqual([]);
			await service.dispose?.();
			expect(state.selectedBundles).toEqual({
				mvp: {
					mainModule: '/bundled/duckdb-mvp.wasm',
					mainWorker: '/bundled/duckdb-browser-mvp.worker.js'
				}
			});
			expect(state.instantiated).toEqual(['/bundled/duckdb-mvp.wasm', null]);
			expect(state.queried).toBe("SELECT 'ok';");
			expect(state.closed).toBe(true);
			expect(state.terminated).toBe(true);
			expect(WorkerMock).toHaveBeenCalledWith('blob:duckdb-worker');
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:duckdb-worker');
		} finally {
			createObjectURL.mockRestore();
			revokeObjectURL.mockRestore();
			vi.unstubAllGlobals();
			Reflect.deleteProperty(globalThis, stateKey);
		}
	});

	it('requires static SQLite and DuckDB runtime module URLs', async () => {
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await expect(
			createSqlWorkerService().initialize?.({ dialect: 'sqlite' }, context)
		).rejects.toThrow('runtime module URL');
		await expect(
			createSqlWorkerService().initialize?.({ dialect: 'duckdb' }, context)
		).rejects.toThrow('runtime module URL');
	});

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

		await service.initialize?.(
			{
				dialect: 'sqlite',
				moduleUrl: '/wasm-sqlite/runtime.mjs',
				wasmUrl: '/sql-wasm.wasm'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 2 }, context);

		expect(loadEngine).toHaveBeenCalledWith({
			dialect: 'sqlite',
			moduleUrl: '/wasm-sqlite/runtime.mjs',
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

		await service.initialize?.(
			{
				dialect: 'duckdb',
				moduleUrl: '/wasm-duckdb/runtime.mjs',
				duckdbBundles
			},
			context
		);
		await service.diagnostics?.(document, context);

		expect(loadEngine).toHaveBeenCalledWith({
			dialect: 'duckdb',
			moduleUrl: '/wasm-duckdb/runtime.mjs',
			duckdbBundles
		});
		expect(context.reportProgress).toHaveBeenCalledWith('load-duckdb-language-service');
	});
});
