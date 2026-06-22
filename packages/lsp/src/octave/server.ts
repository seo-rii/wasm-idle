import {
	resolveOctaveLanguageServerBaseUrl,
	resolveOctaveLanguageServerManifestUrl,
	resolveOctaveLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface OctaveLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
}

export interface OctaveLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getOctaveLanguageServer(
	options?: EditorLanguageServerOptions | OctaveLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as OctaveLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: resolveOctaveLanguageServerBaseUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveOctaveLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolveOctaveLanguageServerManifestUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
