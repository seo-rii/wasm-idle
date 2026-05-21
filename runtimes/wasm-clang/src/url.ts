const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);

export const normalizeBaseUrl = (prefix: string | URL) => {
	const href = prefix.toString();
	const normalized = href.endsWith('/') ? href : `${href}/`;
	return new URL(normalized, typeof location !== 'undefined' ? location.href : import.meta.url);
};

export const resolveVersionedAssetUrl = (prefix: string | URL, assetPath: string) =>
	new URL(assetPath, normalizeBaseUrl(prefix)).toString();

const resolveRuntimeAssetUrl = (prefix: string | URL, assetPath: string) =>
	resolveVersionedAssetUrl(prefix, assetPath);

export const DEFAULT_BROWSER_CLANG_RUNTIME_PATH = DEFAULT_RUNTIME_BASE_URL.toString().replace(
	/\/$/,
	''
);

export const resolveRuntimeBaseUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	normalizeBaseUrl(prefix).toString();

export const runtimeManifestUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'runtime-manifest.v1.json');

export const memfsUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'bin/memfs.zip');

export const clangUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'bin/clang.zip');

export const lldUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'bin/lld.zip');

export const rootUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'bin/sysroot.tar.zip');

export const clangdJsUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'clangd/clangd.js');

export const clangdWasmUrl = (prefix: string | URL = DEFAULT_BROWSER_CLANG_RUNTIME_PATH) =>
	resolveRuntimeAssetUrl(prefix, 'clangd/clangd.wasm.gz');
