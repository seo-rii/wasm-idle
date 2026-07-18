import { importRuntimeModule } from '$lib/playground/runtimeModule';

declare var self: any;

let wasmUrl = '';
let loadedWasmUrl = '';
let runtimeModuleUrl = '';
let sqlPromise: Promise<SqlJsStatic> | null = null;

interface QueryExecResult {
	columns: string[];
	values: unknown[][];
}

interface Database {
	exec(sql: string): QueryExecResult[];
	close(): void;
}

interface SqlJsStatic {
	Database: new () => Database;
}

interface SqliteRuntimeModule {
	default(options: { locateFile(file: string): string }): Promise<SqlJsStatic>;
	sqliteWasmUrl: string;
}

function locateSqliteWasm(url: string) {
	const maybeProcess =
		typeof process === 'undefined' ? null : (process as unknown as { cwd?: () => string });
	if (url.startsWith('/') && maybeProcess?.cwd) {
		return `${maybeProcess.cwd()}${url}`;
	}
	return url;
}

async function loadSqlite(moduleUrl: string, url: string) {
	if (!moduleUrl) throw new Error('SQLite runtime module URL is not configured.');
	const runtime = await importRuntimeModule<SqliteRuntimeModule>(moduleUrl);
	const nextUrl = url || runtime.sqliteWasmUrl;
	if (runtimeModuleUrl === moduleUrl && loadedWasmUrl === nextUrl && sqlPromise) {
		return await sqlPromise;
	}
	runtimeModuleUrl = moduleUrl;
	loadedWasmUrl = nextUrl;
	sqlPromise = runtime.default({
		locateFile(file) {
			return file.endsWith('.wasm') ? locateSqliteWasm(nextUrl) : file;
		}
	});
	return await sqlPromise;
}

function stringifyCell(value: unknown) {
	if (value == null) return 'NULL';
	if (value instanceof Uint8Array) {
		return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
	}
	return String(value);
}

function formatResult(result: QueryExecResult) {
	const lines = [result.columns.join('\t')];
	for (const row of result.values) {
		lines.push(row.map(stringifyCell).join('\t'));
	}
	return `${lines.join('\n')}\n`;
}

function normalizeWorkspacePath(path: string) {
	return path
		.replace(/^\/+/, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'))
		.join('/');
}

function loadWorkspaceFiles(db: Database, workspaceFiles: { path: string; content: string }[]) {
	for (const file of workspaceFiles) {
		const normalizedPath = normalizeWorkspacePath(file.path);
		if (!normalizedPath || !normalizedPath.endsWith('.sql')) continue;
		if (normalizedPath === 'main.sql') continue;
		db.exec(file.content);
	}
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		wasmUrl: nextWasmUrl,
		code,
		prepare,
		activePath = 'main.sql',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			const moduleUrl = nextModuleUrl || runtimeModuleUrl;
			wasmUrl = nextWasmUrl || '';
			if (log) {
				console.log(
					`[wasm-idle:sqlite-worker] load moduleUrl=${moduleUrl} wasmUrl=${wasmUrl || 'default'}`
				);
			}
			await loadSqlite(moduleUrl, wasmUrl);
			postMessage({ load: true });
			return;
		}

		const SQL = await loadSqlite(runtimeModuleUrl, wasmUrl);
		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const db = new SQL.Database();
		try {
			loadWorkspaceFiles(db, workspaceFiles);
			if (log) {
				console.log(
					`[wasm-idle:sqlite-worker] exec start bytes=${code.length} activePath=${activePath}`
				);
			}
			for (const result of db.exec(code)) {
				postMessage({ output: formatResult(result) });
			}
			if (log) {
				console.log('[wasm-idle:sqlite-worker] exec settled');
			}
		} finally {
			db.close();
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:sqlite-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
