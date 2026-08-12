import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	resolvePrologLanguageServerBaseUrl,
	resolvePrologLanguageServerManifestFingerprint,
	resolvePrologLanguageServerManifestUrl,
	resolvePrologLanguageServerWorkerReceipt,
	resolvePrologLanguageServerWorkerUrl
} from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface PrologLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
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
			workerUrl: resolvePrologLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolvePrologLanguageServerManifestUrl(options, hostOptions?.currentUrl),
			manifestFingerprint: resolvePrologLanguageServerManifestFingerprint(options),
			workerReceipt: resolvePrologLanguageServerWorkerReceipt(options)
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
