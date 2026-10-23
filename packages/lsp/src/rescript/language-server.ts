import { LanguageServerAssetConfigurationError } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';

export interface ReScriptLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getReScriptLanguageServer(
	options?: EditorLanguageServerOptions | ReScriptLanguageServerOptions
) {
	const config =
		typeof options === 'object' ? (options as ReScriptLanguageServerOptions) : undefined;
	const currentUrl = config?.currentUrl || globalThis.location?.href;
	const rootUrl = typeof options === 'string' ? options : config?.rootUrl;
	if (!config?.rescript?.baseUrl && !rootUrl)
		throw new LanguageServerAssetConfigurationError('rescript', 'rescript.baseUrl or rootUrl');
	let url: URL;
	try {
		if (config?.rescript?.baseUrl) url = new URL(config.rescript.baseUrl, currentUrl);
		else {
			const root = new URL(rootUrl!, currentUrl);
			if (!root.pathname.endsWith('/')) root.pathname += '/';
			url = new URL('wasm-rescript-lsp/', root);
		}
	} catch {
		throw new LanguageServerAssetConfigurationError('rescript', 'a valid HTTP(S) asset root');
	}
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.hash ||
		url.search ||
		url.username ||
		url.password
	) {
		throw new LanguageServerAssetConfigurationError('rescript', 'a plain HTTP(S) asset root');
	}
	const workspaceFiles = (config?.rescript?.workspaceFiles || []).map((file) => ({ ...file }));
	if (workspaceFiles.length > 1000) throw new Error('ReScript workspace exceeds 1000 files');
	let size = 0;
	const seen = new Set<string>();
	for (const file of workspaceFiles) {
		if (
			typeof file.path !== 'string' ||
			!file.path ||
			file.path.startsWith('/') ||
			file.path.includes('\\') ||
			file.path.includes('\0') ||
			file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
			typeof file.content !== 'string'
		)
			throw new Error('Invalid ReScript workspace file');
		if (seen.has(file.path.toLowerCase()))
			throw new Error('Ambiguous ReScript workspace file path');
		seen.add(file.path.toLowerCase());
		size += new TextEncoder().encode(file.content).byteLength;
		if (size > 16 * 1024 * 1024) throw new Error('ReScript workspace exceeds 16 MiB');
	}
	if (workspaceFiles.filter((file) => /\.resi?$/.test(file.path)).length > 64)
		throw new Error('ReScript workspace exceeds 64 source files');
	return createWorkerLanguageServerClient({
		createWorker:
			config?.createWorker ||
			(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })),
		initOptions: { baseUrl: url.href, workspaceFiles },
		onStatus: config?.onStatus,
		lifecycle: { ...config, rootUrl }
	});
}
