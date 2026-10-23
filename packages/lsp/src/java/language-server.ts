import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import { snapshotJavaLanguageServerAssets, type JavaLanguageServerAsset } from './assets.js';

export interface JavaLanguageServerConfig {
	/** Directory containing the three verified TeaVM producer assets. */
	baseUrl?: string;
	assets?: readonly JavaLanguageServerAsset[];
	/** Source snapshot used by upstream javacs during initialize, before didOpen. */
	initialFiles?: Readonly<Record<string, string>>;
}

export interface JavaLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

export async function getJavaLanguageServer(
	options?: EditorLanguageServerOptions | JavaLanguageServerOptions
) {
	const settings = typeof options === 'object' ? (options as JavaLanguageServerOptions) : {};
	const root = typeof options === 'string' ? options : settings.rootUrl;
	const base =
		settings.java?.baseUrl || (root ? `${root.replace(/\/$/u, '')}/wasm-java-lsp/` : undefined);
	if (!base) throw new Error('Java LSP requires java.baseUrl or rootUrl');
	const baseUrl = new URL(
		base.endsWith('/') ? base : `${base}/`,
		settings.currentUrl || globalThis.location?.href
	);
	if (
		!['https:', 'http:'].includes(baseUrl.protocol) ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.hash ||
		baseUrl.search
	) {
		throw new Error(
			'Java LSP baseUrl must be an HTTP(S) directory without credentials, query, or fragment'
		);
	}
	const files: Record<string, string> = Object.create(null);
	const canonicalUris: Record<string, string> = Object.create(null);
	const sourcePaths = new Set<string>();
	let sourceBytes = 0;
	for (const [value, text] of Object.entries(settings.java?.initialFiles || {})) {
		const uri = new URL(value);
		if (
			uri.protocol !== 'file:' ||
			uri.host ||
			uri.search ||
			uri.hash ||
			typeof text !== 'string'
		) {
			throw new Error('Java initialFiles requires local file URIs and source strings');
		}
		const pathname = decodeURIComponent(uri.pathname);
		if (
			!pathname.startsWith('/workspace/') ||
			pathname.includes('\0') ||
			pathname.includes('\\') ||
			pathname.split('/').some((part) => part === '.' || part === '..')
		) {
			throw new Error('Java source files must be inside file:///workspace/');
		}
		const key = uri.href.toLowerCase();
		if (canonicalUris[key] && canonicalUris[key] !== uri.href)
			throw new Error('Ambiguous case in Java initial file URIs');
		if (sourcePaths.has(pathname.toLowerCase()))
			throw new Error('Ambiguous or duplicate Java source path');
		sourcePaths.add(pathname.toLowerCase());
		canonicalUris[key] = uri.href;
		files[pathname.slice('/workspace/'.length)] = text;
		sourceBytes += new TextEncoder().encode(text).byteLength;
		if (sourceBytes > 16 * 1024 * 1024)
			throw new Error('Java initial source files exceed 16 MiB');
	}
	return await createWorkerLanguageServerClient({
		createWorker: settings.createWorker || createDefaultWorker,
		initOptions: {
			baseUrl: baseUrl.href,
			assets: snapshotJavaLanguageServerAssets(settings.java?.assets),
			files,
			canonicalUris,
			maxAssetBytes: settings.maxAssetBytes,
			assetTimeoutMs: settings.assetTimeoutMs
		},
		onStatus: settings.onStatus,
		lifecycle: { ...settings, rootUrl: root }
	});
}
