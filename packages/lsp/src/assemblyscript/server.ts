import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';

export interface AssemblyScriptLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getAssemblyScriptLanguageServer(
	options?: EditorLanguageServerOptions | AssemblyScriptLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as AssemblyScriptLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			extraFiles: hostOptions?.assemblyscript?.extraFiles
		},
		onStatus: hostOptions?.onStatus
	});
}
