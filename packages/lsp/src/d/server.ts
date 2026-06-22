import { resolveDLanguageServerModuleUrl } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface DLanguageServerConfig {
	moduleUrl?: string;
	compileArgs?: string[];
}

export interface DLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (options: EditorLanguageServerOptions | DLanguageServerOptions | undefined) =>
	typeof options === 'object' ? options.d || {} : {};

export async function getDLanguageServer(
	options?: EditorLanguageServerOptions | DLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as DLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolveDLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			compileArgs: config.compileArgs
		},
		onStatus: hostOptions?.onStatus
	});
}
