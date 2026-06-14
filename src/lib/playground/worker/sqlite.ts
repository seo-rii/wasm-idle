import initSqlJs, { type Database, type QueryExecResult } from 'sql.js';
import sqliteWasmDefaultUrl from 'sql.js/dist/sql-wasm.wasm?url';

declare var self: any;

let wasmUrl = '';
let loadedWasmUrl = '';
let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function locateSqliteWasm(url: string) {
	const maybeProcess =
		typeof process === 'undefined' ? null : (process as unknown as { cwd?: () => string });
	if (url.startsWith('/') && maybeProcess?.cwd) {
		return `${maybeProcess.cwd()}${url}`;
	}
	return url;
}

async function loadSqlite(url: string) {
	const nextUrl = url || sqliteWasmDefaultUrl;
	if (loadedWasmUrl === nextUrl && sqlPromise) {
		return await sqlPromise;
	}
	loadedWasmUrl = nextUrl;
	sqlPromise = initSqlJs({
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
		wasmUrl: nextWasmUrl,
		code,
		prepare,
		activePath = 'main.sql',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			wasmUrl = nextWasmUrl || '';
			if (log) {
				console.log(
					`[wasm-idle:sqlite-worker] load wasmUrl=${wasmUrl || sqliteWasmDefaultUrl}`
				);
			}
			await loadSqlite(wasmUrl);
			postMessage({ load: true });
			return;
		}

		const SQL = await loadSqlite(wasmUrl);
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
