import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface GraphqlLanguageServerConfig {
	schema?: string;
}

export interface GraphqlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' ? options.graphql || {} : {};

export async function getGraphqlLanguageServer(
	options?: EditorLanguageServerOptions | GraphqlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as GraphqlLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			schema: config.schema
		},
		onStatus: hostOptions?.onStatus
	});
}
