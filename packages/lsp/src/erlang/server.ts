import {
	resolveErlangLanguageServerBundleUrl,
	resolveErlangLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface ErlangLanguageServerConfig {
	bundleUrl?: string;
	workerUrl?: string;
}

export interface ErlangLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getErlangLanguageServer(
	options?: EditorLanguageServerOptions | ErlangLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as ErlangLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			language: 'erlang',
			bundleUrl: resolveErlangLanguageServerBundleUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveErlangLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
