export const resolveHostedRuntimeUrl = (value: string | URL, label: string) => {
	const href = value?.toString().trim();
	if (!href) {
		throw new Error(`${label} is required`);
	}

	let resolved: URL;
	try {
		resolved = new URL(href, typeof location !== 'undefined' ? location.href : undefined);
	} catch {
		throw new Error(`${label} must be an absolute HTTP(S) URL`);
	}
	if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
		throw new Error(`${label} must use HTTP(S)`);
	}
	return resolved;
};

export const normalizeBaseUrl = (prefix: string | URL) => {
	const resolved = resolveHostedRuntimeUrl(prefix, 'wasm-clang runtime base URL');
	if (!resolved.pathname.endsWith('/')) resolved.pathname += '/';
	resolved.hash = '';
	return resolved;
};

export const resolveVersionedAssetUrl = (prefix: string | URL, assetPath: string) =>
	new URL(assetPath, normalizeBaseUrl(prefix)).toString();

const resolveRuntimeAssetUrl = (prefix: string | URL, assetPath: string) =>
	resolveVersionedAssetUrl(prefix, assetPath);

export const resolveRuntimeBaseUrl = (prefix: string | URL) => normalizeBaseUrl(prefix).toString();

export const resolveRuntimeBaseUrlFromManifestUrl = (manifestUrl: string | URL) =>
	normalizeBaseUrl(
		new URL('./', resolveHostedRuntimeUrl(manifestUrl, 'wasm-clang runtime manifest URL'))
	).toString();

export const runtimeManifestUrl = (prefix: string | URL) =>
	resolveRuntimeAssetUrl(prefix, 'runtime-manifest.v1.json');

export const memfsUrl = (prefix: string | URL) => resolveRuntimeAssetUrl(prefix, 'bin/memfs.zip');

export const clangUrl = (prefix: string | URL) => resolveRuntimeAssetUrl(prefix, 'bin/clang.zip');

export const lldUrl = (prefix: string | URL) => resolveRuntimeAssetUrl(prefix, 'bin/lld.zip');

export const rootUrl = (prefix: string | URL) =>
	resolveRuntimeAssetUrl(prefix, 'bin/sysroot.tar.zip');

export const clangdJsUrl = (prefix: string | URL) =>
	resolveRuntimeAssetUrl(prefix, 'clangd/clangd.js');

export const clangdWasmUrl = (prefix: string | URL) =>
	resolveRuntimeAssetUrl(prefix, 'clangd/clangd.wasm.gz');
