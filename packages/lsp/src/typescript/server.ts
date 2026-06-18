import type { CompilerOptions } from 'typescript';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import type { TypeScriptLanguage } from './service.js';

export interface TypeScriptLanguageServerConfig {
	compilerOptions?: CompilerOptions;
	extraLibs?: Record<string, string>;
}

export interface TypeScriptLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function resolveConfig(
	language: TypeScriptLanguage,
	options: EditorLanguageServerOptions | TypeScriptLanguageServerOptions | undefined
) {
	if (!options || typeof options === 'string') return {};
	return language === 'typescript' ? options.typescript || {} : options.javascript || {};
}

async function createLanguageServer(
	language: TypeScriptLanguage,
	options?: EditorLanguageServerOptions | TypeScriptLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as TypeScriptLanguageServerOptions) : undefined;
	const config = resolveConfig(language, options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			language,
			compilerOptions: config.compilerOptions,
			extraLibs: config.extraLibs
		},
		onStatus: hostOptions?.onStatus
	});
}

export const getTypeScriptLanguageServer = (
	options?: EditorLanguageServerOptions | TypeScriptLanguageServerOptions
) => createLanguageServer('typescript', options);

export const getJavaScriptLanguageServer = (
	options?: EditorLanguageServerOptions | TypeScriptLanguageServerOptions
) => createLanguageServer('javascript', options);
