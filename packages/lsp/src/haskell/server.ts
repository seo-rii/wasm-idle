import {
	resolveHaskellLanguageServerBsdtarUrl,
	resolveHaskellLanguageServerModuleUrl,
	resolveHaskellLanguageServerRootfsUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface HaskellLanguageServerConfig {
	moduleUrl?: string;
	rootfsUrl?: string;
	bsdtarUrl?: string;
	mainSoPath?: string;
	searchDirs?: string[];
	ghcArgs?: string;
}

export interface HaskellLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (
	options: EditorLanguageServerOptions | HaskellLanguageServerOptions | undefined
) => (typeof options === 'object' ? options.haskell || {} : {});

export async function getHaskellLanguageServer(
	options?: EditorLanguageServerOptions | HaskellLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as HaskellLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolveHaskellLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			rootfsUrl: resolveHaskellLanguageServerRootfsUrl(options, hostOptions?.currentUrl),
			bsdtarUrl: resolveHaskellLanguageServerBsdtarUrl(options, hostOptions?.currentUrl),
			mainSoPath: config.mainSoPath,
			searchDirs: config.searchDirs,
			ghcArgs: config.ghcArgs
		},
		onStatus: hostOptions?.onStatus
	});
}
