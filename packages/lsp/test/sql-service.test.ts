import { describe, expect, it, vi } from 'vitest';

import { createSqlWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createSqlWorkerService', () => {
	it.each(['sqlite', 'duckdb'] as const)(
		'invalidates %s diagnostics for a sibling schema edit',
		async (dialect) => {
			const main = {
				uri: 'file:///workspace/nested/main.sql',
				languageId: 'sql',
				version: 1,
				text: 'SELECT n FROM task'
			};
			const schema = {
				...main,
				uri: 'file:///workspace/schema%20copy.sql',
				text: 'CREATE TABLE task(n)'
			};
			const docs = new Map([
				[main.uri, main],
				[schema.uri, schema]
			]);
			const ctx: LspDocumentContext = {
				documents: docs,
				publishDiagnostics: vi.fn(),
				reportProgress: vi.fn()
			};
			const validate = vi.fn(() => []);
			const service = createSqlWorkerService(async () => ({ validate }));
			expect(service.workspaceDiagnostics).toBe(true);
			await service.initialize?.(
				{
					dialect,
					workspaceFiles: [
						{ path: 'schema copy.sql', content: 'stale' },
						{ path: 'nested/main.sql', content: 'stale main' },
						{ path: 'data.txt', content: 'not SQL' }
					]
				},
				ctx
			);
			const registered =
				dialect === 'duckdb'
					? expect.arrayContaining([
							{ path: 'data.txt', content: 'not SQL' },
							{ path: 'nested/main.sql', content: main.text }
						])
					: undefined;
			await service.diagnostics?.(main, ctx);
			expect(validate).toHaveBeenLastCalledWith(
				main.text,
				'main.sql',
				[{ path: 'schema copy.sql', content: schema.text }],
				registered
			);
			docs.set(schema.uri, { ...schema, version: 2, text: 'CREATE TABLE task(next)' });
			await service.diagnostics?.(main, ctx);
			expect(validate).toHaveBeenLastCalledWith(
				main.text,
				'main.sql',
				[{ path: 'schema copy.sql', content: 'CREATE TABLE task(next)' }],
				registered
			);
			docs.delete(schema.uri);
			await service.diagnostics?.(main, ctx);
			expect(validate).toHaveBeenLastCalledWith(
				main.text,
				'main.sql',
				[{ path: 'schema copy.sql', content: 'stale' }],
				registered
			);
			await service.dispose?.();
		}
	);

	it('locates the syntax token after preceding comments, strings and identifiers', async () => {
		const ctx: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const doc = {
			uri: 'file:///main.sql',
			languageId: 'sql',
			version: 1,
			text: '-- FROM\n/* FROM */ SELECT \'FROM\' AS "FROM";\nSELECT FROM t;'
		};
		const service = createSqlWorkerService(async () => ({
			validate: () => [{ message: 'near "FROM": syntax error' }]
		}));
		await service.initialize?.({}, ctx);
		expect((await service.diagnostics?.(doc, ctx))?.[0].range.start).toEqual({
			line: 2,
			character: 7
		});
		await service.dispose?.();
	});

	it('shares pending revisions and serializes database resets across revisions', async () => {
		const ctx: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const doc = (text: string): LspDocument => ({
			uri: 'file:///workspace/main.sql',
			languageId: 'sql',
			version: 1,
			text
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const validate = vi.fn(async (text: string) => {
			if (text === 'invalid') {
				await gate;
				return [{ message: 'test syntax error' }];
			}
			return [];
		});
		const service = createSqlWorkerService(async () => ({ validate }));
		await service.initialize?.({}, ctx);
		await service.diagnostics?.(doc('seed'), ctx);
		const a = service.diagnostics?.(doc('invalid'), ctx);
		const b = service.diagnostics?.(doc('invalid'), ctx);
		const next = service.diagnostics?.(doc('new revision'), ctx);
		await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2));
		release();
		const [left, right, other] = await Promise.all([a, b, next]);
		expect(left).toHaveLength(1);
		expect(right).toEqual(left);
		expect(other).toEqual([]);
		expect(validate.mock.calls.map(([text]) => text)).toEqual([
			'seed',
			'invalid',
			'new revision'
		]);
		await service.dispose?.();
	});

	it('retries after an engine validation rejects', async () => {
		const ctx: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const doc = {
			uri: 'file:///main.sql',
			languageId: 'sql',
			version: 1,
			text: 'SELECT FROM;'
		};
		const validate = vi
			.fn()
			.mockRejectedValueOnce(new Error('interrupted'))
			.mockResolvedValue([{ message: 'syntax error' }]);
		const service = createSqlWorkerService(async () => ({ validate }));
		await service.initialize?.({}, ctx);
		await expect(service.diagnostics?.(doc, ctx)).rejects.toThrow('interrupted');
		expect(await service.diagnostics?.(doc, ctx)).toHaveLength(1);
		await service.dispose?.();
	});

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
			files: new Map<string, string | Uint8Array>(),
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
					async dropFiles() { globalThis.${stateKey}.files.clear(); }
					async registerFileText(name, text) { globalThis.${stateKey}.files.set(name, text); }
					async registerFileBuffer(name, text) { globalThis.${stateKey}.files.set(name, text); }
					async connect() {
						return {
							async query(code) {
								globalThis.${stateKey}.queried = code;
								if (code.includes('unknown_col')) throw new Error(JSON.stringify({
									exception_type: 'Binder', exception_message: 'Unknown column',
									position: String(new TextEncoder().encode(code.slice(0, code.indexOf('unknown_col'))).length)
								}));
							},
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
			const csv = { ...document, uri: 'file:///workspace/input/data.csv', text: 'n\n42' };
			const documents = new Map(context.documents);
			const workspace = { ...context, documents };
			documents.set(csv.uri, csv);
			const binary = { path: 'inputs/value.parquet', content: 'AAH/', encoding: 'base64' };
			await service.initialize?.(
				{ dialect: 'duckdb', moduleUrl, workspaceFiles: [binary] },
				workspace
			);
			expect(await service.diagnostics?.(document, workspace)).toEqual([]);
			expect(state.files.get('input/data.csv')).toBe(csv.text);
			expect(state.files.get(binary.path)).toEqual(Uint8Array.of(0, 1, 255));
			documents.delete(csv.uri);
			expect(await service.diagnostics?.(document, workspace)).toEqual([]);
			expect(state.files.has('input/data.csv')).toBe(false);
			expect(state.files.get('main.sql')).toBe(document.text);
			const bad = { ...document, text: "SELECT 1,\n  '한🙂', unknown_col;" };
			const [error] = (await service.diagnostics?.(bad, workspace)) ?? [];
			expect(error).toMatchObject({
				message: 'Binder Error: Unknown column',
				range: { start: { line: 1, character: 9 }, end: { line: 1, character: 10 } }
			});
			await service.dispose?.();
			expect(state.selectedBundles).toEqual({
				mvp: {
					mainModule: '/bundled/duckdb-mvp.wasm',
					mainWorker: '/bundled/duckdb-browser-mvp.worker.js'
				}
			});
			expect(state.instantiated).toEqual(['/bundled/duckdb-mvp.wasm', null]);
			expect(state.queried).toBe(bad.text);
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

	it.each([
		['SELECT count(*)', 10, 'COUNT'],
		['SELECT coalesce(NULL, 3)', 11, 'COALESCE'],
		['SELECT x GROUP BY x', 10, 'GROUP BY'],
		['SELECT x ORDER\tBY x', 15, 'ORDER BY']
	] as const)('finds the hover token in %s', async (text, character, word) => {
		const service = createSqlWorkerService();
		const doc = { uri: 'file:///workspace/main.sql', languageId: 'sql', version: 1, text };
		const ctx = { documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() };
		const result = await service.hover?.(doc, { line: 0, character }, ctx);
		expect(result?.contents.value).toContain(word);
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
