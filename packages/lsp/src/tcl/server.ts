import { resolveTclLanguageServerBaseUrl, resolveTclLanguageServerWorkerUrl } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface TclLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface TclLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getTclLanguageServer(
	options?: EditorLanguageServerOptions | TclLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as TclLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolveTclLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveTclLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
