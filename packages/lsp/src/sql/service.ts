import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import type { DuckDBBundles } from '../types.js';

export type SqlLanguageServerDialect = 'sql' | 'sqlite' | 'duckdb';

export interface SqlWorkerOptions {
	dialect?: SqlLanguageServerDialect;
	moduleUrl?: string;
	wasmUrl?: string;
	duckdbBundles?: DuckDBBundles;
}

interface SqlJsDatabase {
	exec(code: string): unknown;
	close(): void;
}

interface SqlJsStatic {
	Database: new () => SqlJsDatabase;
}

interface SqliteRuntimeModule {
	default?: (options: { locateFile(file: string): string }) => Promise<SqlJsStatic>;
	sqliteWasmUrl?: string;
}

interface DuckDBSelectedBundle {
	mainModule: string;
	mainWorker: string | null;
	pthreadWorker: string | null;
}

interface DuckDBConnection {
	query(code: string): Promise<unknown>;
	close(): Promise<void>;
}

interface DuckDBDatabase {
	instantiate(mainModule: string, pthreadWorker: string | null): Promise<void>;
	reset(): Promise<void>;
	connect(): Promise<DuckDBConnection>;
	terminate(): Promise<void>;
}

interface DuckDBRuntimeNamespace {
	selectBundle(bundles: DuckDBBundles): Promise<DuckDBSelectedBundle>;
	VoidLogger: new () => unknown;
	AsyncDuckDB: new (logger: unknown, worker: Worker) => DuckDBDatabase;
}

interface DuckDBRuntimeModule {
	duckdb?: DuckDBRuntimeNamespace;
	bundles?: DuckDBBundles;
}

export interface SqlEngineDiagnostic {
	message: string;
	lineNumber?: number;
	columnNumber?: number;
	severity?: 'error' | 'warning' | 'info';
}

export interface SqlEngine {
	validate(
		code: string,
		fileName: string
	): Promise<SqlEngineDiagnostic[]> | SqlEngineDiagnostic[];
	dispose?: () => void | Promise<void>;
}

export type LoadSqlEngine = (options: SqlWorkerOptions) => Promise<SqlEngine>;

const SQL_KEYWORDS = [
	'SELECT',
	'FROM',
	'WHERE',
	'INSERT',
	'INTO',
	'VALUES',
	'UPDATE',
	'DELETE',
	'CREATE',
	'TABLE',
	'VIEW',
	'INDEX',
	'ALTER',
	'DROP',
	'JOIN',
	'LEFT',
	'RIGHT',
	'INNER',
	'OUTER',
	'ON',
	'GROUP BY',
	'ORDER BY',
	'HAVING',
	'LIMIT',
	'OFFSET',
	'WITH',
	'UNION',
	'EXPLAIN',
	'PRAGMA'
] as const;

const SQL_FUNCTIONS = [
	'count',
	'sum',
	'avg',
	'min',
	'max',
	'coalesce',
	'nullif',
	'lower',
	'upper',
	'length',
	'substr',
	'round',
	'date',
	'datetime',
	'strftime'
] as const;

const SQL_HOVER: Record<string, string> = {
	select: 'Reads rows from one or more relations.',
	from: 'Chooses the relation or subquery used by a SELECT statement.',
	where: 'Filters rows before grouping or projection.',
	join: 'Combines rows from two relations.',
	'group by': 'Groups result rows before aggregate functions are evaluated.',
	'order by': 'Sorts result rows.',
	limit: 'Caps the number of rows returned by a query.',
	create: 'Creates a database object such as a table, view, or index.',
	insert: 'Adds rows to a table.',
	update: 'Changes rows in a table.',
	delete: 'Removes rows from a table.',
	count: 'Returns the number of input rows.',
	coalesce: 'Returns the first non-null argument.',
	strftime: 'Formats a date or time value.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	const left =
		line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_]+)?$/u)?.[0] || '';
	const right = line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '';
	return `${left}${right}`.trim().toLowerCase();
};

const severityFor = (severity: SqlEngineDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'info' ? 3 : 1;

const positionForSqlError = (text: string, diagnostic: SqlEngineDiagnostic) => {
	if (diagnostic.lineNumber) {
		const line = Math.max(0, diagnostic.lineNumber - 1);
		const character = Math.max(0, (diagnostic.columnNumber || 1) - 1);
		return { line, character };
	}
	const token = diagnostic.message.match(/near "([^"]+)"/u)?.[1];
	if (token) {
		const offset = text.toLowerCase().indexOf(token.toLowerCase());
		if (offset >= 0) return positionAt(text, offset);
	}
	return { line: 0, character: 0 };
};

const diagnosticFor = (text: string, diagnostic: SqlEngineDiagnostic): LspDiagnostic => {
	const start = positionForSqlError(text, diagnostic);
	return {
		range: {
			start,
			end: { line: start.line, character: start.character + 1 }
		},
		severity: severityFor(diagnostic.severity),
		source: 'sql',
		message: diagnostic.message
	};
};

async function loadSqlJsEngine(options: SqlWorkerOptions): Promise<SqlEngine> {
	if (options.dialect === 'duckdb') {
		if (!options.moduleUrl) {
			throw new Error('DuckDB language server requires a runtime module URL');
		}
		const runtime = (await import(/* @vite-ignore */ options.moduleUrl)) as DuckDBRuntimeModule;
		const duckdb = runtime.duckdb;
		if (!duckdb || typeof duckdb.selectBundle !== 'function') {
			throw new Error('DuckDB runtime module does not export the duckdb namespace');
		}
		const bundles = options.duckdbBundles || runtime.bundles;
		if (!bundles || Object.keys(bundles).length === 0) {
			throw new Error('DuckDB language server requires externally hosted bundle URLs');
		}
		const bundle = await duckdb.selectBundle(bundles);
		if (!bundle.mainWorker) {
			throw new Error('DuckDB selected bundle does not include a browser worker');
		}
		const workerUrl = URL.createObjectURL(
			new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], {
				type: 'text/javascript'
			})
		);
		const worker = new Worker(workerUrl);
		const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
		await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

		return {
			async validate(code) {
				if (!code.trim()) return [];
				let connection: Awaited<ReturnType<typeof db.connect>> | null = null;
				try {
					await db.reset();
					connection = await db.connect();
					await connection.query(code);
					return [];
				} catch (error) {
					return [
						{
							message: error instanceof Error ? error.message : String(error),
							severity: 'error'
						}
					];
				} finally {
					await connection?.close().catch(() => {});
				}
			},
			async dispose() {
				await db.terminate();
				URL.revokeObjectURL(workerUrl);
			}
		};
	}

	if (!options.moduleUrl) {
		throw new Error('SQLite language server requires a runtime module URL');
	}
	const runtime = (await import(/* @vite-ignore */ options.moduleUrl)) as SqliteRuntimeModule;
	if (typeof runtime.default !== 'function') {
		throw new Error('SQLite runtime module does not export initSqlJs as default');
	}
	const wasmUrl = options.wasmUrl || runtime.sqliteWasmUrl;
	if (!wasmUrl) {
		throw new Error('SQLite language server requires an externally hosted WASM URL');
	}
	const SQL = await runtime.default({
		locateFile(file) {
			return file.endsWith('.wasm') ? wasmUrl : file;
		}
	});

	return {
		validate(code) {
			if (!code.trim()) return [];
			const db = new SQL.Database();
			try {
				db.exec(code);
				return [];
			} catch (error) {
				return [
					{
						message: error instanceof Error ? error.message : String(error),
						severity: 'error'
					}
				];
			} finally {
				db.close();
			}
		}
	};
}

export function createSqlWorkerService(
	loadEngine: LoadSqlEngine = loadSqlJsEngine
): WorkerLanguageService {
	let engine: SqlEngine | null = null;
	let dialect: SqlLanguageServerDialect = 'sqlite';
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-sql-lsp',
		diagnosticDelay: 250,
		capabilities: {
			completionProvider: { triggerCharacters: [' ', '.'] },
			hoverProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as SqlWorkerOptions;
			dialect = config.dialect || dialect;
			context.reportProgress(
				dialect === 'duckdb'
					? 'load-duckdb-language-service'
					: 'load-sqlite-language-service'
			);
			engine = await loadEngine(config);
		},
		async diagnostics(document: LspDocument) {
			if (!engine) return [];
			const key = `${dialect}\n${document.uri}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			lastKey = key;
			const diagnostics = await engine.validate(
				document.text,
				document.uri.split('/').pop() || 'main.sql'
			);
			lastDiagnostics = diagnostics.map((diagnostic) =>
				diagnosticFor(document.text, diagnostic)
			);
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...SQL_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: `${dialect.toUpperCase()} keyword`
					})),
					...SQL_FUNCTIONS.map((label) => ({
						label,
						kind: 3,
						detail: SQL_HOVER[label] || `${dialect.toUpperCase()} function`
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = SQL_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word.toUpperCase()}\`\n\n${description}`
				}
			};
		},
		async dispose() {
			await engine?.dispose?.();
			engine = null;
		}
	};
}
