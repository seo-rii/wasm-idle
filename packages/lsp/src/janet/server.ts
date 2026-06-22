import {
	resolveJanetLanguageServerBaseUrl,
	resolveJanetLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface JanetLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface JanetLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getJanetLanguageServer(
	options?: EditorLanguageServerOptions | JanetLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as JanetLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolveJanetLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveJanetLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
