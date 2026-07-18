import {
	resolveDuckDbLanguageServerModuleUrl,
	resolveSqliteLanguageServerModuleUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import type { DuckDBBundles } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { SqlLanguageServerDialect } from './service.js';

export interface SqlLanguageServerConfig {
	dialect?: SqlLanguageServerDialect;
	moduleUrl?: string;
	wasmUrl?: string;
	duckdbBundles?: DuckDBBundles;
}

export interface SqlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' ? options.sql || {} : {};

const resolveModuleUrl = (
	options: EditorLanguageServerOptions | undefined,
	dialect: SqlLanguageServerDialect,
	currentUrl = ''
) =>
	dialect === 'duckdb'
		? resolveDuckDbLanguageServerModuleUrl(options, currentUrl)
		: resolveSqliteLanguageServerModuleUrl(options, currentUrl);

export async function getSqlLanguageServer(
	options?: EditorLanguageServerOptions | SqlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as SqlLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	const dialect = config.dialect || 'sqlite';
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			dialect,
			moduleUrl: resolveModuleUrl(options, dialect, hostOptions?.currentUrl),
			wasmUrl: config.wasmUrl,
			duckdbBundles: config.duckdbBundles
		},
		onStatus: hostOptions?.onStatus
	});
}

export async function getDuckDbLanguageServer(
	options?: EditorLanguageServerOptions | SqlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as SqlLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			dialect: 'duckdb',
			moduleUrl: resolveDuckDbLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			wasmUrl: config.wasmUrl,
			duckdbBundles: config.duckdbBundles
		},
		onStatus: hostOptions?.onStatus
	});
}
