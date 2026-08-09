import {
	resolveElixirLanguageServerBundleUrl,
	resolveElixirLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import { BUNDLED_ELIXIR_ASSET_RECEIPTS } from '../bundledElixirRuntimeIntegrity.js';
import { snapshotElixirRuntimeAssetReceipts, type ElixirRuntimeAssetReceipts } from './assets.js';

export interface ElixirLanguageServerConfig {
	bundleUrl?: string;
	workerUrl?: string;
	integrity?: ElixirRuntimeAssetReceipts;
}

export interface ElixirLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getElixirLanguageServer(
	options?: EditorLanguageServerOptions | ElixirLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as ElixirLanguageServerOptions) : undefined;
	const config = typeof options === 'object' ? options.elixir || {} : {};
	const integrity = snapshotElixirRuntimeAssetReceipts(
		config.integrity || BUNDLED_ELIXIR_ASSET_RECEIPTS
	);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			language: 'elixir',
			bundleUrl: resolveElixirLanguageServerBundleUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveElixirLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			integrity
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
