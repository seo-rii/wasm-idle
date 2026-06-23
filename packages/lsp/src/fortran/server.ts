import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { resolveFortranLanguageServerAnalyzerUrl } from '../runtime.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface FortranLanguageServerConfig {
	analyzerUrl?: string;
}

export interface FortranLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getFortranLanguageServer(
	options?: EditorLanguageServerOptions | FortranLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as FortranLanguageServerOptions) : undefined;
	const analyzerUrl = resolveFortranLanguageServerAnalyzerUrl(options, hostOptions?.currentUrl);

	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			analyzerUrl
		},
		onStatus: hostOptions?.onStatus
	});
}
