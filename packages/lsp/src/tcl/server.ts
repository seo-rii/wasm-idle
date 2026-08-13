import {
	resolveTclLanguageServerBaseUrl,
	resolveTclLanguageServerManifestFingerprint,
	resolveTclLanguageServerManifestUrl,
	resolveTclLanguageServerWorkerReceipt,
	resolveTclLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface TclLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
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
			workerUrl: resolveTclLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolveTclLanguageServerManifestUrl(options, hostOptions?.currentUrl),
			manifestFingerprint: resolveTclLanguageServerManifestFingerprint(options),
			workerReceipt: resolveTclLanguageServerWorkerReceipt(options)
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
