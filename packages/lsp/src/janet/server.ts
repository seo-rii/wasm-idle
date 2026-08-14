import {
	resolveJanetLanguageServerBaseUrl,
	resolveJanetLanguageServerManifestFingerprint,
	resolveJanetLanguageServerManifestUrl,
	resolveJanetLanguageServerWorkerReceipt,
	resolveJanetLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface JanetLanguageServerConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
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
			workerUrl: resolveJanetLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolveJanetLanguageServerManifestUrl(options, hostOptions?.currentUrl),
			manifestFingerprint: resolveJanetLanguageServerManifestFingerprint(options),
			workerReceipt: resolveJanetLanguageServerWorkerReceipt(options)
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
