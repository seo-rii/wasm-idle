import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEhWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbEhWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbMvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

const encoder = new TextEncoder();
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

const bundles: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdbMvpWasmUrl,
		mainWorker: duckdbMvpWorkerUrl
	},
	eh: {
		mainModule: duckdbEhWasmUrl,
		mainWorker: duckdbEhWorkerUrl
	}
};

async function loadDuckDB(log: boolean) {
	if (dbPromise) return await dbPromise;
	dbPromise = (async () => {
		const bundle = await duckdb.selectBundle(bundles);
		if (!bundle.mainWorker) {
			throw new Error('DuckDB selected bundle does not include a browser worker');
		}
		const worker = new Worker(bundle.mainWorker);
		const db = new duckdb.AsyncDuckDB(
			log ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger(),
			worker
		);
		await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
		return db;
	})();
	return await dbPromise;
}

function stringifyCell(value: unknown) {
	if (value == null) return 'NULL';
	if (value instanceof Uint8Array) {
		return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
	}
	if (typeof value === 'bigint') return value.toString();
	return String(value);
}

function formatTable(table: {
	numCols: number;
	numRows: number;
	schema: { fields: { name: string }[] };
	get: (row: number) => Record<string, unknown> | null;
}) {
	if (!table.numCols) return '';
	const columns = table.schema.fields.map((field) => field.name);
	const lines = [columns.join('\t')];
	for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
		const row = table.get(rowIndex);
		lines.push(columns.map((column) => stringifyCell(row?.[column])).join('\t'));
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

function isSqlPath(path: string) {
	const normalized = path.toLowerCase();
	return normalized.endsWith('.sql') || normalized.endsWith('.duckdb');
}

async function registerWorkspaceFiles(
	db: duckdb.AsyncDuckDB,
	activePath: string,
	code: string,
	workspaceFiles: SandboxWorkspaceFile[],
	stdin: unknown
) {
	const setupSql: { path: string; content: string }[] = [];
	const files = workspaceFiles.length
		? workspaceFiles
		: [{ path: activePath || 'main.duckdb', content: code }];
	for (const file of files) {
		if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
		const normalizedPath = normalizeWorkspacePath(file.path);
		if (!normalizedPath) continue;
		const content = normalizedPath === activePath ? code : file.content;
		await db.registerFileText(normalizedPath, content);
		if (isSqlPath(normalizedPath) && normalizedPath !== activePath) {
			setupSql.push({ path: normalizedPath, content });
		}
	}
	if (typeof stdin === 'string') {
		await db.registerFileText('stdin.txt', stdin);
		await db.registerFileBuffer('/dev/stdin', encoder.encode(stdin));
	}
	return setupSql.sort((left, right) => left.path.localeCompare(right.path));
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		code,
		prepare,
		activePath = 'main.duckdb',
		workspaceFiles = [],
		stdin,
		log
	} = event.data;
	try {
		if (load) {
			if (log) {
				console.log('[wasm-idle:duckdb-worker] load');
			}
			await loadDuckDB(Boolean(log));
			postMessage({ load: true });
			return;
		}

		const db = await loadDuckDB(Boolean(log));
		if (prepare) {
			postMessage({ results: true });
			return;
		}

		await db.reset();
		const normalizedActivePath = normalizeWorkspacePath(activePath || 'main.duckdb');
		const setupSql = await registerWorkspaceFiles(
			db,
			normalizedActivePath,
			code,
			workspaceFiles,
			stdin
		);
		const connection = await db.connect();
		try {
			if (log) {
				console.log(
					`[wasm-idle:duckdb-worker] exec start bytes=${code.length} activePath=${normalizedActivePath}`
				);
			}
			for (const setup of setupSql) {
				await connection.query(setup.content);
			}
			const table = await connection.query(code);
			const output = formatTable(table);
			if (output) postMessage({ output });
			if (log) {
				console.log('[wasm-idle:duckdb-worker] exec settled');
			}
		} finally {
			await connection.close().catch(() => {});
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:duckdb-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
