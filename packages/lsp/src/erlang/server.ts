import {
	resolveErlangLanguageServerBundleUrl,
	resolveErlangLanguageServerWorkerUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import { BUNDLED_ELIXIR_ASSET_RECEIPTS } from '../bundledElixirRuntimeIntegrity.js';
import {
	snapshotElixirRuntimeAssetReceipts,
	type ElixirRuntimeAssetReceipts
} from '../elixir/assets.js';

export interface ErlangLanguageServerConfig {
	bundleUrl?: string;
	workerUrl?: string;
	integrity?: ElixirRuntimeAssetReceipts;
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
	const config = typeof options === 'object' ? options.erlang || {} : {};
	const sharedElixirConfig = typeof options === 'object' ? options.elixir || {} : {};
	const integrity = snapshotElixirRuntimeAssetReceipts(
		config.integrity ?? sharedElixirConfig.integrity ?? BUNDLED_ELIXIR_ASSET_RECEIPTS
	);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			language: 'erlang',
			bundleUrl: resolveErlangLanguageServerBundleUrl(options, hostOptions?.currentUrl),
			workerUrl: resolveErlangLanguageServerWorkerUrl(options, hostOptions?.currentUrl),
			integrity
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
