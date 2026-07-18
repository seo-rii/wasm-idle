import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	resolveRubyLanguageServerModuleUrl,
	resolveRubyLanguageServerWasmUrl
} from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface RubyLanguageServerConfig {
	moduleUrl?: string;
	wasmUrl?: string;
}

export interface RubyLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getRubyLanguageServer(
	options?: EditorLanguageServerOptions | RubyLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as RubyLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolveRubyLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			wasmUrl: resolveRubyLanguageServerWasmUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
