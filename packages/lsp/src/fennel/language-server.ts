import { LanguageServerAssetConfigurationError } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface FennelLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getFennelLanguageServer(
	options?: EditorLanguageServerOptions | FennelLanguageServerOptions
) {
	const config =
		typeof options === 'object' ? (options as FennelLanguageServerOptions) : undefined;
	const currentUrl = config?.currentUrl || globalThis.location?.href;
	const rootUrl = typeof options === 'string' ? options : config?.rootUrl;
	if (!config?.fennel?.baseUrl && !rootUrl)
		throw new LanguageServerAssetConfigurationError('fennel', 'fennel.baseUrl or rootUrl');
	let url: URL;
	try {
		if (config?.fennel?.baseUrl) url = new URL(config.fennel.baseUrl, currentUrl);
		else {
			const root = new URL(rootUrl!, currentUrl);
			if (!root.pathname.endsWith('/')) root.pathname += '/';
			url = new URL('wasm-fennel-lsp/', root);
		}
	} catch {
		throw new LanguageServerAssetConfigurationError('fennel', 'a valid HTTP(S) asset root');
	}
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.hash ||
		url.search ||
		url.username ||
		url.password
	) {
		throw new LanguageServerAssetConfigurationError('fennel', 'a plain HTTP(S) asset root');
	}
	return createWorkerLanguageServerClient({
		createWorker:
			config?.createWorker ||
			(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })),
		initOptions: { baseUrl: url.href },
		onStatus: config?.onStatus,
		lifecycle: { ...config, rootUrl }
	});
}
