import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	resolvePrologLanguageServerBaseUrl,
	resolvePrologLanguageServerWorkerUrl
} from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface PrologLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface PrologLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getPrologLanguageServer(
	options?: EditorLanguageServerOptions | PrologLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as PrologLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolvePrologLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolvePrologLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
