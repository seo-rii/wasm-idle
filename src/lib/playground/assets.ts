import { env as publicEnv } from '$env/dynamic/public';
import { normalizeTeaVmBaseUrl, resolveTeaVmBaseUrl } from '$lib/playground/teavmConfig';

export type RuntimeAssetRuntime = 'python' | 'java' | 'clang' | 'clangd';

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

export interface DotnetRuntimeAssetConfig {
	moduleUrl?: string;
}

export interface OcamlRuntimeAssetConfig {
	moduleUrl?: string;
	manifestUrl?: string;
}

export interface TinyGoRuntimeAssetConfig {
	moduleUrl?: string;
	appUrl?: string;
	assetLoader?: TinyGoRuntimeAssetLoader;
	assetPacks?: TinyGoRuntimeAssetPackReference[];
}

export interface ElixirRuntimeAssetConfig {
	bundleUrl?: string;
}

export interface TypeScriptRuntimeAssetConfig {
	moduleUrl?: string;
}

export interface WatRuntimeAssetConfig {
	moduleUrl?: string;
}

export interface LuaRuntimeAssetConfig {
	moduleUrl?: string;
}

export interface HaskellRuntimeAssetConfig {
	moduleUrl?: string;
	rootfsUrl?: string;
	bsdtarUrl?: string;
	mainSoPath?: string;
	searchDirs?: string[];
}

export interface ZigRuntimeAssetConfig {
	compilerUrl?: string;
	stdlibUrl?: string;
}

export interface LispRuntimeAssetConfig {
	moduleUrl?: string;
}

export interface RubyRuntimeAssetConfig {
	wasmUrl?: string;
}

export interface RRuntimeAssetConfig {
	baseUrl?: string;
}

export interface SqliteRuntimeAssetConfig {
	wasmUrl?: string;
}

export interface PhpRuntimeAssetConfig {
	version?: string;
}

export interface PlaygroundRuntimeAssets {
	rootUrl?: string;
	python?: RuntimeAssetConfig;
	java?: RuntimeAssetConfig;
	clang?: RuntimeAssetConfig;
	clangd?: RuntimeAssetConfig;
	rust?: RustRuntimeAssetConfig;
	go?: GoRuntimeAssetConfig;
	dotnet?: DotnetRuntimeAssetConfig;
	ocaml?: OcamlRuntimeAssetConfig;
	tinygo?: TinyGoRuntimeAssetConfig;
	elixir?: ElixirRuntimeAssetConfig;
	typescript?: TypeScriptRuntimeAssetConfig;
	wat?: WatRuntimeAssetConfig;
	lua?: LuaRuntimeAssetConfig;
	haskell?: HaskellRuntimeAssetConfig;
	zig?: ZigRuntimeAssetConfig;
	lisp?: LispRuntimeAssetConfig;
	ruby?: RubyRuntimeAssetConfig;
	r?: RRuntimeAssetConfig;
	sqlite?: SqliteRuntimeAssetConfig;
	php?: PhpRuntimeAssetConfig;
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

export const CLANG_RUNTIME_LOAD_ASSETS = [
	'bin/memfs.zip',
	'bin/clang.zip',
	'bin/lld.zip',
	'bin/sysroot.tar.zip'
] as const;

export const CLANGD_RUNTIME_LOAD_ASSETS = ['clangd.js', 'clangd.wasm.gz'] as const;

const PYTHON_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/python/';
const JAVA_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/java/';
const CLANG_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/clang/';
const CLANGD_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/clangd/';

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

const resolveClangRuntimeAssetConfig = (
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig => {
	if (typeof options === 'string') {
		return {
			baseUrl: normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/clang/`, currentUrl),
			useAssetBridge: false
		};
	}

	const runtimeConfig = options?.clang;
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
			loader: runtimeConfig.loader,
			useAssetBridge: !!runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: normalizeBaseUrl(
				`${normalizeRootUrl(options.rootUrl) || ''}/clang/`,
				currentUrl
			),
			loader: runtimeConfig?.loader,
			useAssetBridge: !!runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: CLANG_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader,
			useAssetBridge: true
		};
	}

	return {
		baseUrl: normalizeBaseUrl('/clang/', currentUrl),
		useAssetBridge: false
	};
};

const resolveClangdRuntimeAssetConfig = (
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig => {
	if (typeof options === 'string') {
		return {
			baseUrl: normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/clangd/`, currentUrl),
			useAssetBridge: false
		};
	}

	const runtimeConfig = options?.clangd;
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
			loader: runtimeConfig.loader,
			useAssetBridge: !!runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: normalizeBaseUrl(
				`${normalizeRootUrl(options.rootUrl) || ''}/clangd/`,
				currentUrl
			),
			loader: runtimeConfig?.loader,
			useAssetBridge: !!runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: CLANGD_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader,
			useAssetBridge: true
		};
	}

	return {
		baseUrl: normalizeBaseUrl('/clangd/', currentUrl),
		useAssetBridge: false
	};
};

export function resolveRuntimeAssetConfig(
	runtime: RuntimeAssetRuntime,
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig {
	switch (runtime) {
		case 'python':
			return resolvePythonRuntimeAssetConfig(options, currentUrl);
		case 'java':
			return resolveJavaRuntimeAssetConfig(options, currentUrl);
		case 'clang':
			return resolveClangRuntimeAssetConfig(options, currentUrl);
		case 'clangd':
			return resolveClangdRuntimeAssetConfig(options, currentUrl);
	}
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

export function resolveDotnetModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.dotnet?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-dotnet/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-dotnet/index.js`,
			currentUrl
		);
	}

	return '';
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
			? new URL(
					`${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native/src/index.js`,
					currentUrl
				).href
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
			? new URL(
					`${normalizeRootUrl(options)}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json`,
					currentUrl
				).href
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
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}

	return '';
}

export function resolveTypeScriptModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.typescript?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-typescript/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-typescript/index.js`,
			currentUrl
		);
	}

	return '';
}

export function resolveWatModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.wat?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_WAT_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-wat/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-wat/index.js`,
			currentUrl
		);
	}

	return '';
}

export function resolveLuaModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.lua?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_LUA_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-lua/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-lua/index.js`,
			currentUrl
		);
	}

	return '';
}

export function resolveZigCompilerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredCompilerUrl =
		(typeof options === 'object' && options?.zig?.compilerUrl) ||
		(publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL || '').trim();

	if (configuredCompilerUrl) {
		return resolveConfiguredUrl(configuredCompilerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-zig/zig_small.wasm`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-zig/zig_small.wasm`,
			currentUrl
		);
	}

	return '';
}

export function resolveHaskellModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.haskell?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/dyld.mjs`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/dyld.mjs`,
			currentUrl
		);
	}

	return '';
}

export function resolveHaskellRootfsUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredRootfsUrl =
		(typeof options === 'object' && options?.haskell?.rootfsUrl) ||
		(publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL || '').trim();

	if (configuredRootfsUrl) {
		return resolveConfiguredUrl(configuredRootfsUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/rootfs.tar.zst`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/rootfs.tar.zst`,
			currentUrl
		);
	}

	return '';
}

export function resolveHaskellBsdtarUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBsdtarUrl =
		(typeof options === 'object' && options?.haskell?.bsdtarUrl) ||
		(publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL || '').trim();

	if (configuredBsdtarUrl) {
		return resolveConfiguredUrl(configuredBsdtarUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/bsdtar.wasm`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/bsdtar.wasm`,
			currentUrl
		);
	}

	return '';
}

export function resolveZigStdlibUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredStdlibUrl =
		(typeof options === 'object' && options?.zig?.stdlibUrl) ||
		(publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL || '').trim();

	if (configuredStdlibUrl) {
		return resolveConfiguredUrl(configuredStdlibUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-zig/std.zip`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-zig/std.zip`,
			currentUrl
		);
	}

	return '';
}

export function resolveLispModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.lisp?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_LISP_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-lisp/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-lisp/index.js`,
			currentUrl
		);
	}

	return '';
}

export function resolveRubyWasmUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWasmUrl =
		(typeof options === 'object' && options?.ruby?.wasmUrl) ||
		(publicEnv.PUBLIC_WASM_RUBY_WASM_URL || '').trim();

	if (configuredWasmUrl) {
		return resolveConfiguredUrl(configuredWasmUrl, currentUrl);
	}

	return '';
}

export function resolveRBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.r?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_R_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/webr/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/webr/`, currentUrl);
	}

	return '';
}

export function resolveSqliteWasmUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWasmUrl =
		(typeof options === 'object' && options?.sqlite?.wasmUrl) ||
		(publicEnv.PUBLIC_WASM_SQLITE_WASM_URL || '').trim();

	if (configuredWasmUrl) {
		return resolveConfiguredUrl(configuredWasmUrl, currentUrl);
	}

	return '';
}

export function resolvePhpVersion(options: string | PlaygroundRuntimeAssets | undefined) {
	const configuredVersion =
		(typeof options === 'object' && options?.php?.version) ||
		(publicEnv.PUBLIC_WASM_PHP_VERSION || '').trim();

	return configuredVersion || '8.4';
}
