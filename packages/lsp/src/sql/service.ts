import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import type { DuckDBBundles } from '../types.js';

export type SqlLanguageServerDialect = 'sql' | 'sqlite' | 'duckdb';
type SqlWorkspaceFile = { path: string; content: string; encoding?: 'base64' };

export interface SqlWorkerOptions {
	dialect?: SqlLanguageServerDialect;
	moduleUrl?: string;
	wasmUrl?: string;
	duckdbBundles?: DuckDBBundles;
	workspaceFiles?: readonly SqlWorkspaceFile[];
}

interface SqlJsDatabase {
	exec(code: string): unknown;
	iterateStatements?(code: string): Iterable<{ step(): boolean }> & { getRemainingSQL(): string };
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
	dropFiles(): Promise<unknown>;
	registerFileText(name: string, text: string): Promise<void>;
	registerFileBuffer(name: string, bytes: Uint8Array): Promise<void>;
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
	statementOffset?: number;
	setupFile?: string;
	lineNumber?: number;
	columnNumber?: number;
	severity?: 'error' | 'warning' | 'info';
}

export interface SqlEngine {
	validate(
		code: string,
		fileName: string,
		setupFiles?: readonly SqlWorkspaceFile[],
		workspaceFiles?: readonly SqlWorkspaceFile[]
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
	const start = diagnostic.statementOffset ?? 0;
	if (token) {
		// Match whole tokens so quoted values, identifiers and comments cannot supply a keyword.
		const tokens =
			/--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*(?:'|$)|"(?:""|[^"])*(?:"|$)|\x60(?:\x60\x60|[^\x60])*(?:\x60|$)|\[[^\]]*(?:\]|$)|[\p{L}\p{N}_$]+|[^\s]/gu;
		tokens.lastIndex = start;
		for (const match of text.matchAll(tokens)) {
			if (match[0].toLowerCase() === token.toLowerCase())
				return positionAt(text, match.index);
		}
	}
	return positionAt(text, start);
};

const diagnosticFor = (text: string, diagnostic: SqlEngineDiagnostic): LspDiagnostic => {
	const start = diagnostic.setupFile
		? { line: 0, character: 0 }
		: positionForSqlError(text, diagnostic);
	return {
		range: {
			start,
			end: diagnostic.setupFile ? start : { line: start.line, character: start.character + 1 }
		},
		severity: severityFor(diagnostic.severity),
		source: 'sql',
		message: diagnostic.setupFile
			? 'Workspace setup (' + diagnostic.setupFile + '): ' + diagnostic.message
			: diagnostic.message
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
			async validate(code, _fileName, setupFiles = [], workspaceFiles = []) {
				if (!code.trim()) return [];
				let connection: Awaited<ReturnType<typeof db.connect>> | null = null;
				let setupFile: string | undefined;
				try {
					await db.reset();
					// Native database reset leaves the worker's virtual file registrations intact.
					await db.dropFiles();
					for (const file of workspaceFiles) {
						setupFile = file.path;
						if (file.encoding === 'base64') {
							const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
							await db.registerFileBuffer(file.path, bytes);
						} else {
							await db.registerFileText(file.path, file.content);
						}
					}
					setupFile = undefined;
					connection = await db.connect();
					for (const file of setupFiles) {
						setupFile = file.path;
						await connection.query(file.content);
					}
					setupFile = undefined;
					await connection.query(code);
					return [];
				} catch (error) {
					return [
						{
							message: error instanceof Error ? error.message : String(error),
							setupFile,
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
		validate(code, _fileName, setupFiles = []) {
			if (!code.trim()) return [];
			const db = new SQL.Database();
			let setupFile: string | undefined;
			try {
				for (const file of setupFiles) {
					setupFile = file.path;
					db.exec(file.content);
				}
				setupFile = undefined;
				const statements = db.iterateStatements?.(code);
				if (!statements) {
					db.exec(code);
					return [];
				}
				try {
					for (const statement of statements) {
						try {
							while (statement.step()) {
								/* Validate all rows. */
							}
						} catch (error) {
							return [
								{ message: error instanceof Error ? error.message : String(error) }
							];
						}
					}
				} catch (error) {
					// On a prepare error the iterator retains the suffix beginning at the failed statement.
					return [
						{
							message: error instanceof Error ? error.message : String(error),
							statementOffset: code.length - statements.getRemainingSQL().length
						}
					];
				}
				return [];
			} catch (error) {
				return [
					{
						message: error instanceof Error ? error.message : String(error),
						severity: 'error',
						setupFile
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
	let workspace: readonly SqlWorkspaceFile[] = [];
	let pending: Promise<unknown> = Promise.resolve();
	let cached: { key: string; result: Promise<LspDiagnostic[]> } | undefined;

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
			workspace = config.workspaceFiles ?? [];
			context.reportProgress(
				dialect === 'duckdb'
					? 'load-duckdb-language-service'
					: 'load-sqlite-language-service'
			);
			engine = await loadEngine(config);
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			const current = engine;
			if (!current) return [];
			const { uri, text } = document;
			const root = uri.startsWith('file:///workspace/')
				? 'file:///workspace/'
				: uri.slice(0, uri.lastIndexOf('/') + 1);
			const rootPath = uriToPath(root);
			const active = uriToPath(uri).slice(rootPath.length);
			const files = new Map(workspace.map((file) => [file.path, file]));
			for (const open of context.documents.values()) {
				if (open.uri.startsWith(root)) {
					const path = uriToPath(open.uri).slice(rootPath.length);
					files.set(path, { path, content: open.text });
				}
			}
			files.set(active, { path: active, content: text });
			const workspaceFiles = dialect === 'duckdb' ? [...files.values()] : undefined;
			files.delete(active);
			const setupFiles = [...files.values()].filter(
				(file) =>
					!file.encoding &&
					(dialect === 'duckdb' ? /\.(sql|duckdb)$/iu : /\.sql$/iu).test(file.path)
			);
			if (dialect === 'duckdb') setupFiles.sort((a, b) => a.path.localeCompare(b.path));
			const key = JSON.stringify([dialect, uri, workspaceFiles ?? [text, setupFiles]]);
			if (cached?.key === key) return cached.result;
			const result = pending.then(async () => {
				const diagnostics = await current.validate(
					text,
					active.split('/').pop() || 'main.sql',
					setupFiles,
					workspaceFiles
				);
				return diagnostics.map((diagnostic) => diagnosticFor(text, diagnostic));
			});
			cached = { key, result };
			pending = result.catch(() => {
				if (cached?.result === result) cached = undefined;
			});
			return result;
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
			const current = engine;
			engine = null;
			cached = undefined;
			await pending;
			await current?.dispose?.();
		}
	};
}
