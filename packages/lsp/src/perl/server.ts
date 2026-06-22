import {
	resolvePerlLanguageServerBaseUrl,
	resolvePerlLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface PerlLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface PerlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getPerlLanguageServer(
	options?: EditorLanguageServerOptions | PerlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as PerlLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolvePerlLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolvePerlLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
