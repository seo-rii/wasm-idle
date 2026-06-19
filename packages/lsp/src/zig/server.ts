import {
	resolveZigLanguageServerCompilerUrl,
	resolveZigLanguageServerStdlibUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { ZigLanguageServerTargetTriple } from './service.js';

export interface ZigLanguageServerConfig {
	compilerUrl?: string;
	stdlibUrl?: string;
	targetTriple?: ZigLanguageServerTargetTriple;
	compileArgs?: string[];
}

export interface ZigLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (
	options: EditorLanguageServerOptions | ZigLanguageServerOptions | undefined
) => (typeof options === 'object' ? options.zig || {} : {});

export async function getZigLanguageServer(
	options?: EditorLanguageServerOptions | ZigLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as ZigLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			compilerUrl: resolveZigLanguageServerCompilerUrl(options, hostOptions?.currentUrl),
			stdlibUrl: resolveZigLanguageServerStdlibUrl(options, hostOptions?.currentUrl),
			targetTriple: config.targetTriple,
			compileArgs: config.compileArgs
		},
		onStatus: hostOptions?.onStatus
	});
}
