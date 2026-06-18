import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { resolveRustLanguageServerCompilerUrl } from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RustLanguageServerTargetTriple } from './service.js';

export interface RustLanguageServerConfig {
	compilerUrl?: string;
	targetTriple?: RustLanguageServerTargetTriple;
	edition?: string;
}

export interface RustLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function resolveConfig(
	options: EditorLanguageServerOptions | RustLanguageServerOptions | undefined
) {
	return typeof options === 'object' ? options.rust || {} : {};
}

export async function getRustLanguageServer(
	options?: EditorLanguageServerOptions | RustLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as RustLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			compilerUrl: resolveRustLanguageServerCompilerUrl(options, hostOptions?.currentUrl),
			targetTriple: config.targetTriple,
			edition: config.edition
		},
		onStatus: hostOptions?.onStatus
	});
}
