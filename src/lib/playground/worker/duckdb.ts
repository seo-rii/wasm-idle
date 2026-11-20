import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';

declare var self: any;

const encoder = new TextEncoder();
let dbPromise: Promise<any> | null = null;
let runtimeModuleUrl = '';

interface DuckDbRuntimeModule {
	duckdb: any;
	bundles: Record<string, { mainModule: string; mainWorker?: string; pthreadWorker?: string }>;
}

async function loadDuckDB(moduleUrl: string, log: boolean) {
	if (!moduleUrl) throw new Error('DuckDB runtime module URL is not configured.');
	if (runtimeModuleUrl !== moduleUrl) {
		runtimeModuleUrl = moduleUrl;
		dbPromise = null;
	}
	if (dbPromise) return await dbPromise;
	dbPromise = (async () => {
		const { duckdb, bundles } = await importRuntimeModule<DuckDbRuntimeModule>(moduleUrl);
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

// Logical type identifiers in the Arrow IPC schema returned by the loaded DuckDB bundle.
const arrowDecimal = 7;
const arrowDate = 8;

interface ArrowFieldType {
	typeId: number;
	scale?: number;
}

function formatDecimal(value: unknown, scale: number) {
	// Arrow's decimal vector exposes the exact signed, unscaled integer as a string.
	const integer = String(value);
	if (scale === 0) return integer;
	const negative = integer.startsWith('-');
	const digits = (negative ? integer.slice(1) : integer).padStart(scale + 1, '0');
	return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function formatDate(milliseconds: number) {
	const day = Math.round(milliseconds / 86_400_000);
	// DuckDB reserves the ends of its date range for the SQL infinity literals.
	if (day === 2_147_483_647) return 'infinity';
	if (day === -2_147_483_647) return '-infinity';
	// Gregorian months and leap years repeat every 400 years. Reduce into the JS Date
	// range before extracting UTC components, including for DuckDB's extended years.
	const cycles = Math.floor(day / 146_097);
	const inCycle = new Date((day - cycles * 146_097) * 86_400_000);
	const year = inCycle.getUTCFullYear() + cycles * 400;
	const label = String(year > 0 ? year : 1 - year).padStart(4, '0');
	return `${label}${inCycle.toISOString().slice(4, 10)}${year > 0 ? '' : ' (BC)'}`;
}

function stringifyCell(value: unknown, type: ArrowFieldType) {
	if (value == null) return 'NULL';
	if (type.typeId === arrowDecimal && type.scale !== undefined)
		return formatDecimal(value, type.scale);
	if (type.typeId === arrowDate && typeof value === 'number') return formatDate(value);
	if (value instanceof Uint8Array) {
		return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
	}
	return String(value);
}

function formatTable(table: {
	numCols: number;
	numRows: number;
	schema: { fields: { name: string; type: ArrowFieldType }[] };
	getChildAt: (column: number) => { get: (row: number) => unknown } | null;
}) {
	if (!table.numCols) return '';
	const fields = table.schema.fields;
	const vectors = fields.map((_, index) => table.getChildAt(index));
	const lines = [fields.map((field) => field.name).join('\t')];
	for (let row = 0; row < table.numRows; row++) {
		lines.push(
			vectors
				.map((vector, index) => stringifyCell(vector?.get(row), fields[index].type))
				.join('\t')
		);
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
	db: any,
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
		moduleUrl: nextModuleUrl,
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
			await loadDuckDB(nextModuleUrl || runtimeModuleUrl, Boolean(log));
			postMessage({ load: true });
			return;
		}

		const db = await loadDuckDB(runtimeModuleUrl, Boolean(log));
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
			postMessage({
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'DuckDB query started'
				}
			});
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
