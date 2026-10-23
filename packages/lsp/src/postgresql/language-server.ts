import { resolvePostgresqlLanguageServerModuleUrl } from '../runtime.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface PostgresqlLanguageServerConfig {
	/** The unmodified @postgres-language-server/wasm/lsp ESM entry point. */
	moduleUrl?: string;
	/** JSON exported by postgres-language-server schema-export (SchemaCache). */
	schema?: string;
}

export interface PostgresqlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export interface PostgresqlLanguageServerHandle extends EditorLanguageServerHandle {
	/** Replace the exported database schema, or clear it with null. */
	setSchema: (schema: string | null) => Promise<void>;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getPostgresqlLanguageServer(
	options?: EditorLanguageServerOptions | PostgresqlLanguageServerOptions
): Promise<PostgresqlLanguageServerHandle> {
	const hostOptions =
		typeof options === 'object' ? (options as PostgresqlLanguageServerOptions) : undefined;
	const handle = await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolvePostgresqlLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			schema: hostOptions?.postgresql?.schema
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: {
			...hostOptions,
			rootUrl: typeof options === 'string' ? options : hostOptions?.rootUrl
		}
	});
	return {
		...handle,
		async setSchema(schema) {
			const notification = {
				jsonrpc: '2.0',
				method: schema === null ? 'pgls/clearSchema' : 'pgls/setSchema',
				params: schema === null ? {} : { schema }
			};
			await handle.transport.writer.write(notification);
		}
	};
}
