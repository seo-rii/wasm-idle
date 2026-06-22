import {
	resolvePascalLanguageServerBaseUrl,
	resolvePascalLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface PascalLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface PascalLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getPascalLanguageServer(
	options?: EditorLanguageServerOptions | PascalLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as PascalLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker:
			hostOptions?.createWorker ||
			(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })),
		initOptions: {
			baseUrl: resolvePascalLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolvePascalLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
