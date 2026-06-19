import { resolvePhpLanguageServerVersion } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface PhpLanguageServerConfig {
	version?: string;
}

export interface PhpLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getPhpLanguageServer(
	options?: EditorLanguageServerOptions | PhpLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as PhpLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			version: resolvePhpLanguageServerVersion(options)
		},
		onStatus: hostOptions?.onStatus
	});
}
