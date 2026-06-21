import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface FortranLanguageServerConfig {
	analyzerUrl?: string;
	parserWasmUrl?: string;
	grammarUrl?: string;
}

export interface FortranLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' ? options.fortran || {} : {};

export async function getFortranLanguageServer(
	options?: EditorLanguageServerOptions | FortranLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as FortranLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			analyzerUrl: config.analyzerUrl,
			parserWasmUrl: config.parserWasmUrl,
			grammarUrl: config.grammarUrl
		},
		onStatus: hostOptions?.onStatus
	});
}
