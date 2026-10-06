import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';

declare var self: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PostgresqlProtocolMessage {
	name: string;
	fields?: unknown[];
	chunk?: Uint8Array;
	message?: string;
	severity?: string;
	detail?: string;
	hint?: string;
	position?: string;
}

interface PGliteInstance {
	exec(query: string): Promise<unknown>;
	execProtocol(
		message: Uint8Array,
		options?: { throwOnError?: boolean }
	): Promise<{ messages: PostgresqlProtocolMessage[] }>;
	dumpDataDir(compression?: 'none' | 'gzip' | 'auto'): Promise<Blob>;
	close(): Promise<void>;
	_handleBlob(blob?: Blob): Promise<void>;
	_cleanupBlob(): Promise<void>;
}

interface PGliteOptions {
	pgliteWasmModule: WebAssembly.Module;
	initdbWasmModule: WebAssembly.Module;
	fsBundle: Blob;
	loadDataDir?: Blob;
}

interface PGliteConstructor {
	create(options: PGliteOptions): Promise<PGliteInstance>;
}

interface PostgresqlRuntimeModule {
	loadPGlite(): Promise<PGliteConstructor>;
	pgliteWasmUrl: string;
	pgliteInitdbWasmUrl: string;
	pgliteDataUrl: string;
}

interface PostgresqlRuntime {
	PGlite: PGliteConstructor;
	options: PGliteOptions;
	/** Data directory captured right after initdb; every run restores this fresh cluster. */
	snapshot: Blob;
}

let runtimeModuleUrl = '';
let runtimePromise: Promise<PostgresqlRuntime> | null = null;

async function fetchBytes(url: string) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`PostgreSQL runtime asset request failed (${response.status}): ${url}`);
	}
	return await response.arrayBuffer();
}

async function loadPostgresql(moduleUrl: string) {
	if (!moduleUrl) throw new Error('PostgreSQL runtime module URL is not configured.');
	if (runtimeModuleUrl !== moduleUrl) {
		runtimeModuleUrl = moduleUrl;
		runtimePromise = null;
	}
	if (runtimePromise) return await runtimePromise;
	const pending = (async () => {
		const runtime = await importRuntimeModule<PostgresqlRuntimeModule>(moduleUrl);
		const [PGlite, pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
			runtime.loadPGlite(),
			fetchBytes(runtime.pgliteWasmUrl).then((bytes) => WebAssembly.compile(bytes)),
			fetchBytes(runtime.pgliteInitdbWasmUrl).then((bytes) => WebAssembly.compile(bytes)),
			fetchBytes(runtime.pgliteDataUrl).then((bytes) => new Blob([bytes]))
		]);
		const options: PGliteOptions = { pgliteWasmModule, initdbWasmModule, fsBundle };
		const template = await PGlite.create(options);
		try {
			const snapshot = await template.dumpDataDir('none');
			return { PGlite, options, snapshot };
		} finally {
			await template.close().catch(() => {});
		}
	})();
	runtimePromise = pending;
	pending.catch(() => {
		if (runtimePromise === pending) runtimePromise = null;
	});
	return await pending;
}

function normalizeWorkspacePath(path: string) {
	return path
		.replace(/^\/+/, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'))
		.join('/');
}

function collectSetupSql(activePath: string, workspaceFiles: SandboxWorkspaceFile[]) {
	const setupSql: { path: string; content: string }[] = [];
	for (const file of workspaceFiles) {
		if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
		const normalizedPath = normalizeWorkspacePath(file.path);
		if (!normalizedPath || normalizedPath === activePath) continue;
		if (!normalizedPath.toLowerCase().endsWith('.sql')) continue;
		setupSql.push({ path: normalizedPath, content: file.content });
	}
	return setupSql.sort((left, right) => left.path.localeCompare(right.path));
}

/** Frame one simple-query protocol message; the server runs the script exactly as written. */
function simpleQueryMessage(sql: string) {
	const text = encoder.encode(sql);
	const message = new Uint8Array(text.byteLength + 6);
	message[0] = 0x51; // 'Q'
	new DataView(message.buffer).setInt32(1, text.byteLength + 5);
	message.set(text, 5);
	return message;
}

function stringifyCell(value: unknown) {
	if (value == null) return 'NULL';
	return String(value);
}

function lineAndColumn(source: string, position: number) {
	// The server reports a 1-based character (code point) offset into the query text.
	const before = Array.from(source)
		.slice(0, position - 1)
		.join('');
	const lines = before.split('\n');
	return { lineNumber: lines.length, columnNumber: lines[lines.length - 1].length + 1 };
}

function formatServerMessage(message: PostgresqlProtocolMessage) {
	const lines = [`${message.severity || 'ERROR'}:  ${message.message || ''}`];
	if (message.detail) lines.push(`DETAIL:  ${message.detail}`);
	if (message.hint) lines.push(`HINT:  ${message.hint}`);
	return lines.join('\n');
}

/**
 * Converts the backend's protocol replies into terminal text in server order. Rows use the
 * server's own text representation, matching the tab-separated SQLite/DuckDB output.
 */
function renderMessages(messages: PostgresqlProtocolMessage[]) {
	const chunks: string[] = [];
	let error: PostgresqlProtocolMessage | null = null;
	for (const message of messages) {
		switch (message.name) {
			case 'rowDescription':
				chunks.push(
					`${((message.fields || []) as { name: string }[]).map((field) => field.name).join('\t')}\n`
				);
				break;
			case 'dataRow':
				chunks.push(`${(message.fields || []).map(stringifyCell).join('\t')}\n`);
				break;
			case 'copyData':
				if (message.chunk) chunks.push(decoder.decode(message.chunk));
				break;
			case 'notice':
				chunks.push(`${formatServerMessage(message)}\n`);
				break;
			case 'error':
				error = message;
				break;
		}
	}
	return { output: chunks.join(''), error };
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		code,
		prepare,
		activePath = 'main.sql',
		workspaceFiles = [],
		stdin,
		log
	} = event.data;
	try {
		if (load) {
			if (log) console.log('[wasm-idle:postgresql-worker] load');
			await loadPostgresql(nextModuleUrl || runtimeModuleUrl);
			postMessage({ load: true });
			return;
		}

		const runtime = await loadPostgresql(runtimeModuleUrl);
		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const db = await runtime.PGlite.create({
			...runtime.options,
			loadDataDir: runtime.snapshot
		});
		try {
			const normalizedActivePath = normalizeWorkspacePath(activePath || 'main.sql');
			for (const setup of collectSetupSql(normalizedActivePath, workspaceFiles)) {
				await db.exec(setup.content);
			}
			// PGlite exposes caller-provided bytes as the server-side file /dev/blob, so
			// `COPY ... FROM '/dev/blob'` and `pg_read_file('/dev/blob')` read program stdin.
			await db._handleBlob(new Blob([typeof stdin === 'string' ? stdin : '']));
			postMessage({
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'PostgreSQL query started'
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:postgresql-worker] exec start bytes=${code.length} activePath=${normalizedActivePath}`
				);
			}
			let rendered: ReturnType<typeof renderMessages>;
			try {
				const result = await db.execProtocol(simpleQueryMessage(code), {
					throwOnError: false
				});
				rendered = renderMessages(result.messages);
			} finally {
				await db._cleanupBlob().catch(() => {});
			}
			if (rendered.output) postMessage({ output: rendered.output });
			if (rendered.error) {
				const position = Number(rendered.error.position);
				if (Number.isSafeInteger(position) && position > 0) {
					postMessage({
						diagnostic: {
							fileName: normalizedActivePath,
							...lineAndColumn(code, position),
							severity: 'error',
							message: rendered.error.message || 'PostgreSQL error'
						}
					});
				}
				postMessage({ error: formatServerMessage(rendered.error) });
				return;
			}
			if (log) console.log('[wasm-idle:postgresql-worker] exec settled');
		} finally {
			await db.close().catch(() => {});
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) console.error('[wasm-idle:postgresql-worker] failed', error);
		postMessage({ error: error?.message || String(error) });
	}
};
