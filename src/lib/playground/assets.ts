import { env as publicEnv } from '$env/dynamic/public';
import { normalizeTeaVmBaseUrl, resolveTeaVmBaseUrl } from '$lib/playground/teavmConfig';

export type RuntimeAssetRuntime = 'python' | 'java';

export interface RuntimeAssetLoadRequest {
	runtime: RuntimeAssetRuntime;
	asset: string;
	reportProgress: (loaded: number, total?: number) => void;
}

export interface RuntimeAssetDataResult {
	data: string | ArrayBuffer | Uint8Array | Blob;
	mimeType?: string;
}

export interface RuntimeAssetUrlResult {
	url: string | URL;
}

export type RuntimeAssetLoaderResult =
	| RuntimeAssetDataResult
	| RuntimeAssetUrlResult
	| string
	| URL
	| ArrayBuffer
	| Uint8Array
	| Blob
	| null
	| undefined;

export type RuntimeAssetLoader = (
	request: RuntimeAssetLoadRequest
) => RuntimeAssetLoaderResult | Promise<RuntimeAssetLoaderResult>;

export interface RuntimeAssetConfig {
	baseUrl?: string;
	loader?: RuntimeAssetLoader;
}

export interface RustRuntimeAssetConfig {
	compilerUrl?: string;
}

export interface GoRuntimeAssetConfig {
	compilerUrl?: string;
}

export interface OcamlRuntimeAssetConfig {
	moduleUrl?: string;
	manifestUrl?: string;
}

export interface TinyGoRuntimeAssetConfig {
	moduleUrl?: string;
	appUrl?: string;
	hostCompileUrl?: string;
	disableHostCompile?: boolean;
	assetLoader?: TinyGoRuntimeAssetLoader;
	assetPacks?: TinyGoRuntimeAssetPackReference[];
}

export interface ElixirRuntimeAssetConfig {
	bundleUrl?: string;
}

export interface PlaygroundRuntimeAssets {
	rootUrl?: string;
	python?: RuntimeAssetConfig;
	java?: RuntimeAssetConfig;
	rust?: RustRuntimeAssetConfig;
	go?: GoRuntimeAssetConfig;
	ocaml?: OcamlRuntimeAssetConfig;
	tinygo?: TinyGoRuntimeAssetConfig;
	elixir?: ElixirRuntimeAssetConfig;
}

export interface TinyGoRuntimeAssetLoaderRequest {
	assetPath: string;
	assetUrl: string;
	label: string;
}

export interface TinyGoRuntimeAssetPackReference {
	index: string;
	asset: string;
	fileCount: number;
	totalBytes: number;
}

export type TinyGoRuntimeAssetLoaderResult =
	| RuntimeAssetDataResult
	| RuntimeAssetUrlResult
	| string
	| URL
	| ArrayBuffer
	| Uint8Array
	| Blob
	| null
	| undefined;

export type TinyGoRuntimeAssetLoader = (
	request: TinyGoRuntimeAssetLoaderRequest
) => TinyGoRuntimeAssetLoaderResult | Promise<TinyGoRuntimeAssetLoaderResult>;

export interface ResolvedRuntimeAssetConfig {
	baseUrl: string;
	loader?: RuntimeAssetLoader;
	useAssetBridge: boolean;
}

export const PYTHON_RUNTIME_LOAD_ASSETS = [
	'pyodide.asm.js',
	'pyodide-lock.json',
	'pyodide.asm.wasm',
	'python_stdlib.zip'
] as const;

export const JAVA_RUNTIME_LOAD_ASSETS = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

const PYTHON_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/python/';
const JAVA_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/java/';

const normalizeBaseUrl = (baseUrl: string, currentUrl = '') => {
	const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return currentUrl ? new URL(normalized, currentUrl).href : normalized;
};

const resolveConfiguredUrl = (url: string, currentUrl = '') =>
	currentUrl ? new URL(url, currentUrl).href : url;

const normalizeRootUrl = (rootUrl: string) =>
	rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;

const resolvePythonBaseUrl = (rootUrl = '', currentUrl = '') =>
	normalizeBaseUrl(`${normalizeRootUrl(rootUrl) || ''}/pyodide/`, currentUrl);

const resolvePythonRuntimeAssetConfig = (
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig => {
	if (typeof options === 'string') {
		return {
			baseUrl: resolvePythonBaseUrl(options, currentUrl),
			useAssetBridge: false
		};
	}

	const runtimeConfig = options?.python;
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
			loader: runtimeConfig.loader,
			useAssetBridge: !!runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: resolvePythonBaseUrl(options.rootUrl, currentUrl),
			loader: runtimeConfig?.loader,
			useAssetBridge: !!runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: PYTHON_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader,
			useAssetBridge: true
		};
	}

	return {
		baseUrl: resolvePythonBaseUrl('', currentUrl),
		useAssetBridge: false
	};
};

const resolveJavaBaseUrl = (rootUrl = '', currentUrl = '') =>
	resolveTeaVmBaseUrl(rootUrl, currentUrl);

const resolveJavaRuntimeAssetConfig = (
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig => {
	if (typeof options === 'string') {
		return {
			baseUrl: resolveJavaBaseUrl(options, currentUrl),
			useAssetBridge: false
		};
	}

	const runtimeConfig = options?.java;
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: currentUrl
				? new URL(normalizeTeaVmBaseUrl(runtimeConfig.baseUrl), currentUrl).href
				: normalizeTeaVmBaseUrl(runtimeConfig.baseUrl),
			loader: runtimeConfig.loader,
			useAssetBridge: !!runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: resolveJavaBaseUrl(options.rootUrl, currentUrl),
			loader: runtimeConfig?.loader,
			useAssetBridge: !!runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: JAVA_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader,
			useAssetBridge: true
		};
	}

	return {
		baseUrl: resolveJavaBaseUrl('', currentUrl),
		useAssetBridge: false
	};
};

export function resolveRuntimeAssetConfig(
	runtime: RuntimeAssetRuntime,
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig {
	return runtime === 'python'
		? resolvePythonRuntimeAssetConfig(options, currentUrl)
		: resolveJavaRuntimeAssetConfig(options, currentUrl);
}

export function resolveRustCompilerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredCompilerUrl =
		(typeof options === 'object' && options?.rust?.compilerUrl) ||
		(publicEnv.PUBLIC_WASM_RUST_COMPILER_URL || '').trim();

	if (!configuredCompilerUrl) return '';
	return currentUrl ? new URL(configuredCompilerUrl, currentUrl).href : configuredCompilerUrl;
}

export function resolveGoCompilerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredCompilerUrl =
		(typeof options === 'object' && options?.go?.compilerUrl) ||
		(publicEnv.PUBLIC_WASM_GO_COMPILER_URL || '').trim();

	if (!configuredCompilerUrl) return '';
	return currentUrl ? new URL(configuredCompilerUrl, currentUrl).href : configuredCompilerUrl;
}

export function resolveOcamlModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.ocaml?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_OCAML_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return currentUrl ? new URL(configuredModuleUrl, currentUrl).href : configuredModuleUrl;
	}
	if (typeof options === 'string') {
		return currentUrl
			? new URL(`${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native/src/index.js`, currentUrl).href
			: `${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native/src/index.js`;
	}
	if (options?.rootUrl) {
		return currentUrl
			? new URL(
					`${normalizeRootUrl(options.rootUrl)}/wasm-of-js-of-ocaml/browser-native/src/index.js`,
					currentUrl
				).href
			: `${normalizeRootUrl(options.rootUrl)}/wasm-of-js-of-ocaml/browser-native/src/index.js`;
	}
	return '';
}

export function resolveOcamlManifestUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredManifestUrl =
		(typeof options === 'object' && options?.ocaml?.manifestUrl) ||
		(publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL || '').trim();

	if (configuredManifestUrl) {
		return currentUrl ? new URL(configuredManifestUrl, currentUrl).href : configuredManifestUrl;
	}
	if (typeof options === 'string') {
		return currentUrl
			? new URL(`${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json`, currentUrl).href
			: `${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json`;
	}
	if (options?.rootUrl) {
		return currentUrl
			? new URL(
					`${normalizeRootUrl(options.rootUrl)}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json`,
					currentUrl
				).href
			: `${normalizeRootUrl(options.rootUrl)}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json`;
	}
	return '';
}

export function resolveTinyGoAppUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredAppUrl =
		(typeof options === 'object' && options?.tinygo?.appUrl) ||
		(publicEnv.PUBLIC_WASM_TINYGO_APP_URL || '').trim();

	if (configuredAppUrl) {
		return resolveConfiguredUrl(configuredAppUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-tinygo/index.html`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tinygo/index.html`,
			currentUrl
		);
	}

	return '';
}

function deriveTinyGoModuleUrlFromAppUrl(appUrl: string, currentUrl = '') {
	const resolvedAppUrl = resolveConfiguredUrl(appUrl, currentUrl);
	const [withoutHash, hash = ''] = resolvedAppUrl.split('#', 2);
	const [withoutQuery, query = ''] = withoutHash.split('?', 2);
	let moduleUrlPath = withoutQuery;
	if (moduleUrlPath.endsWith('/index.html')) {
		moduleUrlPath = `${moduleUrlPath.slice(0, -'index.html'.length)}runtime.js`;
	} else if (moduleUrlPath.endsWith('/')) {
		moduleUrlPath = `${moduleUrlPath}runtime.js`;
	} else {
		moduleUrlPath = `${moduleUrlPath.replace(/\/$/, '')}/runtime.js`;
	}
	return `${moduleUrlPath}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

export function resolveTinyGoModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.tinygo?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	const configuredLegacyAppUrl =
		(typeof options === 'object' && options?.tinygo?.appUrl) ||
		(publicEnv.PUBLIC_WASM_TINYGO_APP_URL || '').trim();

	if (configuredLegacyAppUrl) {
		return deriveTinyGoModuleUrlFromAppUrl(configuredLegacyAppUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-tinygo/runtime.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tinygo/runtime.js`,
			currentUrl
		);
	}

	return '';
}

export function resolveTinyGoHostCompileUrls(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options?.tinygo?.disableHostCompile) {
		return [];
	}

	const configuredHostCompileUrl =
		(typeof options === 'object' && options?.tinygo?.hostCompileUrl) ||
		(publicEnv.PUBLIC_WASM_TINYGO_HOST_COMPILE_URL || '').trim();

	if (configuredHostCompileUrl) {
		return [resolveConfiguredUrl(configuredHostCompileUrl, currentUrl)];
	}

	return [];
}

export function resolveTinyGoHostCompileUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveTinyGoHostCompileUrls(options, currentUrl)[0] || '';
}

export function resolveElixirBundleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBundleUrl =
		(typeof options === 'object' && options?.elixir?.bundleUrl) ||
		(publicEnv.PUBLIC_WASM_ELIXIR_BUNDLE_URL || '').trim();

	if (configuredBundleUrl) {
		return resolveConfiguredUrl(configuredBundleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm`, currentUrl);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}

	return '';
}
