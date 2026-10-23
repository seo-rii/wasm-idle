import { resolveBashLanguageServerModuleUrl } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface BashLanguageServerConfig {
	/** Browser bundle built from the pinned original bash-language-server release. */
	moduleUrl?: string;
	/** Workspace source files for upstream source resolution and background discovery. */
	files?: Readonly<Record<string, string>>;
}

export interface BashLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getBashLanguageServer(
	options?: EditorLanguageServerOptions | BashLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as BashLanguageServerOptions) : undefined;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolveBashLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			files: hostOptions?.bash?.files
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: {
			...hostOptions,
			rootUrl: typeof options === 'string' ? options : hostOptions?.rootUrl
		}
	});
}
