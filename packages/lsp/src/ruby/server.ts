import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { resolveRubyLanguageServerWasmUrl } from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface RubyLanguageServerConfig {
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
			wasmUrl: resolveRubyLanguageServerWasmUrl(options, hostOptions?.currentUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}
