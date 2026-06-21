import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { SqlLanguageServerDialect } from './service.js';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm';

export interface SqlLanguageServerConfig {
	dialect?: SqlLanguageServerDialect;
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

export async function getSqlLanguageServer(
	options?: EditorLanguageServerOptions | SqlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as SqlLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			dialect: config.dialect || 'sqlite',
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
			wasmUrl: config.wasmUrl,
			duckdbBundles: config.duckdbBundles
		},
		onStatus: hostOptions?.onStatus
	});
}
