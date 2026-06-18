import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { resolveGoLanguageServerCompilerUrl } from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { GoLanguageServerTarget } from './service.js';

export interface GoLanguageServerConfig {
	compilerUrl?: string;
	target?: GoLanguageServerTarget;
}

export interface GoLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function resolveConfig(options: EditorLanguageServerOptions | GoLanguageServerOptions | undefined) {
	return typeof options === 'object' ? options.go || {} : {};
}

export async function getGoLanguageServer(
	options?: EditorLanguageServerOptions | GoLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as GoLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			compilerUrl: resolveGoLanguageServerCompilerUrl(options, hostOptions?.currentUrl),
			target: config.target
		},
		onStatus: hostOptions?.onStatus
	});
}
