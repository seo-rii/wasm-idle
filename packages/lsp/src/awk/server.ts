import { resolveAwkLanguageServerBaseUrl, resolveAwkLanguageServerWorkerUrl } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface AwkLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface AwkLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getAwkLanguageServer(
	options?: EditorLanguageServerOptions | AwkLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as AwkLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolveAwkLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveAwkLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
