import {
	resolvePerlLanguageServerBaseUrl,
	resolvePerlLanguageServerManifestFingerprint,
	resolvePerlLanguageServerManifestUrl,
	resolvePerlLanguageServerWorkerReceipt,
	resolvePerlLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface PerlLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
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
			workerUrl: resolvePerlLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolvePerlLanguageServerManifestUrl(options, hostOptions?.currentUrl),
			manifestFingerprint: resolvePerlLanguageServerManifestFingerprint(options),
			workerReceipt: resolvePerlLanguageServerWorkerReceipt(options)
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
