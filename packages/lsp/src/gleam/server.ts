import {
	resolveGleamLanguageServerBaseUrl,
	resolveGleamLanguageServerManifestUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface GleamLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const currentUrl = () => globalThis.location?.href || '';

export async function getGleamLanguageServer(
	options?: EditorLanguageServerOptions | GleamLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as GleamLanguageServerOptions) : undefined;
	const baseUrl = hostOptions?.currentUrl ?? currentUrl();
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolveGleamLanguageServerBaseUrl(options, baseUrl),
			manifestUrl: resolveGleamLanguageServerManifestUrl(options, baseUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
