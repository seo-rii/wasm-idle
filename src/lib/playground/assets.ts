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

export interface DRuntimeAssetConfig {
	moduleUrl?: string;
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

export interface ErlangRuntimeAssetConfig {
	bundleUrl?: string;
}

export interface TypeScriptRuntimeAssetConfig {
	moduleUrl?: string;
	libUrl?: string;
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

export interface FortranRuntimeAssetConfig {
	baseUrl?: string;
	f2cWasmUrl?: string;
	libf2cUrl?: string;
	f2cHeaderUrl?: string;
	analyzerUrl?: string;
}

export interface ObjectiveCRuntimeAssetConfig {
	baseUrl?: string;
	libobjcUrl?: string;
	headersUrl?: string;
	libgnustepBaseUrl?: string;
	libgnustepBaseObjectUrl?: string;
	foundationHeadersUrl?: string;
	libffiUrl?: string;
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

export interface OctaveRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
}

export interface PrologRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface GleamRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
}

export interface PerlRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface TclRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface AwkRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface PascalRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface ForthRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface JRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface BqnRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface JanetRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface JuliaRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface NimRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface BashRuntimeAssetConfig {
	webcUrl?: string;
}

export interface ClojureScriptRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
}

export interface SwiftRuntimeAssetConfig {
	baseUrl?: string;
	workerUrl?: string;
	manifestUrl?: string;
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
	d?: DRuntimeAssetConfig;
	dotnet?: DotnetRuntimeAssetConfig;
	ocaml?: OcamlRuntimeAssetConfig;
	tinygo?: TinyGoRuntimeAssetConfig;
	elixir?: ElixirRuntimeAssetConfig;
	erlang?: ErlangRuntimeAssetConfig;
	typescript?: TypeScriptRuntimeAssetConfig;
	wat?: WatRuntimeAssetConfig;
	lua?: LuaRuntimeAssetConfig;
	haskell?: HaskellRuntimeAssetConfig;
	fortran?: FortranRuntimeAssetConfig;
	objectivec?: ObjectiveCRuntimeAssetConfig;
	zig?: ZigRuntimeAssetConfig;
	lisp?: LispRuntimeAssetConfig;
	ruby?: RubyRuntimeAssetConfig;
	r?: RRuntimeAssetConfig;
	octave?: OctaveRuntimeAssetConfig;
	prolog?: PrologRuntimeAssetConfig;
	gleam?: GleamRuntimeAssetConfig;
	perl?: PerlRuntimeAssetConfig;
	tcl?: TclRuntimeAssetConfig;
	awk?: AwkRuntimeAssetConfig;
	pascal?: PascalRuntimeAssetConfig;
	forth?: ForthRuntimeAssetConfig;
	j?: JRuntimeAssetConfig;
	bqn?: BqnRuntimeAssetConfig;
	janet?: JanetRuntimeAssetConfig;
	julia?: JuliaRuntimeAssetConfig;
	nim?: NimRuntimeAssetConfig;
	bash?: BashRuntimeAssetConfig;
	clojurescript?: ClojureScriptRuntimeAssetConfig;
	swift?: SwiftRuntimeAssetConfig;
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

export interface ResolvedFortranRuntimeAssetConfig {
	baseUrl: string;
	f2cWasmUrl: string;
	libf2cUrl: string;
	f2cHeaderUrl: string;
	analyzerUrl: string;
}

export interface ResolvedObjectiveCRuntimeAssetConfig {
	baseUrl: string;
	libobjcUrl: string;
	headersUrl: string;
	libgnustepBaseUrl: string;
	libgnustepBaseObjectUrl: string;
	foundationHeadersUrl: string;
	libffiUrl: string;
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

export const RUNTIME_LOAD_ASSETS = {
	python: PYTHON_RUNTIME_LOAD_ASSETS,
	java: JAVA_RUNTIME_LOAD_ASSETS,
	clang: CLANG_RUNTIME_LOAD_ASSETS,
	clangd: CLANGD_RUNTIME_LOAD_ASSETS
} satisfies Record<RuntimeAssetRuntime, readonly string[]>;

interface RuntimeAssetFolderConfig {
	folder: string;
	virtualBaseUrl: string;
	resolveRootBaseUrl?: (rootUrl: string, currentUrl: string) => string;
	resolveConfiguredBaseUrl?: (baseUrl: string, currentUrl: string) => string;
}

const normalizeBaseUrl = (baseUrl: string, currentUrl = '') => {
	const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return currentUrl ? new URL(normalized, currentUrl).href : normalized;
};

const resolveConfiguredUrl = (url: string, currentUrl = '') =>
	currentUrl ? new URL(url, currentUrl).href : url;

const normalizeRootUrl = (rootUrl: string) =>
	rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;

const resolveFolderRuntimeBaseUrl = (folder: string, rootUrl = '', currentUrl = '') =>
	normalizeBaseUrl(`${normalizeRootUrl(rootUrl) || ''}/${folder}/`, currentUrl);

const normalizeTeaVmConfiguredBaseUrl = (baseUrl: string, currentUrl = '') =>
	currentUrl
		? new URL(normalizeTeaVmBaseUrl(baseUrl), currentUrl).href
		: normalizeTeaVmBaseUrl(baseUrl);

const RUNTIME_ASSET_FOLDERS = {
	python: {
		folder: 'pyodide',
		virtualBaseUrl: 'https://wasm-idle.invalid/python/'
	},
	java: {
		folder: 'teavm',
		virtualBaseUrl: 'https://wasm-idle.invalid/java/',
		resolveRootBaseUrl: resolveTeaVmBaseUrl,
		resolveConfiguredBaseUrl: normalizeTeaVmConfiguredBaseUrl
	},
	clang: {
		folder: 'clang',
		virtualBaseUrl: 'https://wasm-idle.invalid/clang/'
	},
	clangd: {
		folder: 'clangd',
		virtualBaseUrl: 'https://wasm-idle.invalid/clangd/'
	}
} satisfies Record<RuntimeAssetRuntime, RuntimeAssetFolderConfig>;

const resolveRuntimeRootBaseUrl = (
	config: RuntimeAssetFolderConfig,
	rootUrl = '',
	currentUrl = ''
) =>
	config.resolveRootBaseUrl?.(rootUrl, currentUrl) ||
	resolveFolderRuntimeBaseUrl(config.folder, rootUrl, currentUrl);

const resolveRuntimeConfiguredBaseUrl = (
	config: RuntimeAssetFolderConfig,
	baseUrl: string,
	currentUrl = ''
) =>
	config.resolveConfiguredBaseUrl?.(baseUrl, currentUrl) || normalizeBaseUrl(baseUrl, currentUrl);

export function resolveRuntimeAssetConfig(
	runtime: RuntimeAssetRuntime,
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig {
	const runtimeFolder = RUNTIME_ASSET_FOLDERS[runtime];
	if (typeof options === 'string') {
		return {
			baseUrl: resolveRuntimeRootBaseUrl(runtimeFolder, options, currentUrl),
			useAssetBridge: false
		};
	}

	const runtimeConfig = options?.[runtime];
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: resolveRuntimeConfiguredBaseUrl(
				runtimeFolder,
				runtimeConfig.baseUrl,
				currentUrl
			),
			loader: runtimeConfig.loader,
			useAssetBridge: !!runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: resolveRuntimeRootBaseUrl(runtimeFolder, options.rootUrl, currentUrl),
			loader: runtimeConfig?.loader,
			useAssetBridge: !!runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: runtimeFolder.virtualBaseUrl,
			loader: runtimeConfig.loader,
			useAssetBridge: true
		};
	}

	return {
		baseUrl: resolveRuntimeRootBaseUrl(runtimeFolder, '', currentUrl),
		useAssetBridge: false
	};
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

export function resolveDModuleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredModuleUrl =
		(typeof options === 'object' && options?.d?.moduleUrl) ||
		(publicEnv.PUBLIC_WASM_D_MODULE_URL || '').trim();

	if (configuredModuleUrl) {
		return resolveConfiguredUrl(configuredModuleUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-d/index.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-d/index.js`,
			currentUrl
		);
	}

	return '';
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

export function resolveErlangBundleUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBundleUrl =
		(typeof options === 'object' && options?.erlang?.bundleUrl) ||
		(publicEnv.PUBLIC_WASM_ERLANG_BUNDLE_URL || '').trim() ||
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

export function resolveFortranBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.fortran?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_FORTRAN_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-fortran/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-fortran/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-fortran/', currentUrl);
}

function resolveFortranAssetUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl: string,
	configKey: keyof Pick<
		FortranRuntimeAssetConfig,
		'f2cWasmUrl' | 'libf2cUrl' | 'f2cHeaderUrl' | 'analyzerUrl'
	>,
	envKey: string,
	defaultAsset: string
) {
	const env = publicEnv as Record<string, string | undefined>;
	const configuredUrl =
		(typeof options === 'object' && options?.fortran?.[configKey]) ||
		(env[envKey] || '').trim();

	if (configuredUrl) {
		return resolveConfiguredUrl(configuredUrl, currentUrl);
	}

	return resolveConfiguredUrl(
		new URL(defaultAsset, resolveFortranBaseUrl(options, currentUrl)).href,
		currentUrl
	);
}

export function resolveFortranF2cWasmUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveFortranAssetUrl(
		options,
		currentUrl,
		'f2cWasmUrl',
		'PUBLIC_WASM_FORTRAN_F2C_WASM_URL',
		'f2c.wasm'
	);
}

export function resolveFortranLibf2cUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveFortranAssetUrl(
		options,
		currentUrl,
		'libf2cUrl',
		'PUBLIC_WASM_FORTRAN_LIBF2C_URL',
		'libf2c.a'
	);
}

export function resolveFortranF2cHeaderUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveFortranAssetUrl(
		options,
		currentUrl,
		'f2cHeaderUrl',
		'PUBLIC_WASM_FORTRAN_F2C_HEADER_URL',
		'f2c.h'
	);
}

export function resolveFortranAnalyzerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveFortranAssetUrl(
		options,
		currentUrl,
		'analyzerUrl',
		'PUBLIC_WASM_FORTRAN_ANALYZER_URL',
		'analyzer.js'
	);
}

export function resolveFortranRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedFortranRuntimeAssetConfig {
	return {
		baseUrl: resolveFortranBaseUrl(options, currentUrl),
		f2cWasmUrl: resolveFortranF2cWasmUrl(options, currentUrl),
		libf2cUrl: resolveFortranLibf2cUrl(options, currentUrl),
		f2cHeaderUrl: resolveFortranF2cHeaderUrl(options, currentUrl),
		analyzerUrl: resolveFortranAnalyzerUrl(options, currentUrl)
	};
}

export function resolveObjectiveCBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.objectivec?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_OBJECTIVEC_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-objectivec/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-objectivec/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-objectivec/', currentUrl);
}

function resolveObjectiveCAssetUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl: string,
	configKey: keyof Pick<
		ObjectiveCRuntimeAssetConfig,
		| 'libobjcUrl'
		| 'headersUrl'
		| 'libgnustepBaseUrl'
		| 'libgnustepBaseObjectUrl'
		| 'foundationHeadersUrl'
		| 'libffiUrl'
	>,
	envKey: string,
	defaultAsset: string
) {
	const env = publicEnv as Record<string, string | undefined>;
	const configuredUrl =
		(typeof options === 'object' && options?.objectivec?.[configKey]) ||
		(env[envKey] || '').trim();

	if (configuredUrl) {
		return resolveConfiguredUrl(configuredUrl, currentUrl);
	}

	return resolveConfiguredUrl(
		new URL(defaultAsset, resolveObjectiveCBaseUrl(options, currentUrl)).href,
		currentUrl
	);
}

export function resolveObjectiveCLibobjcUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'libobjcUrl',
		'PUBLIC_WASM_OBJECTIVEC_LIBOBJC_URL',
		'libobjc.a'
	);
}

export function resolveObjectiveCHeadersUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'headersUrl',
		'PUBLIC_WASM_OBJECTIVEC_HEADERS_URL',
		'headers.json'
	);
}

export function resolveObjectiveCLibgnustepBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'libgnustepBaseUrl',
		'PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_URL',
		'libgnustep-base.a'
	);
}

export function resolveObjectiveCLibgnustepBaseObjectUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'libgnustepBaseObjectUrl',
		'PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL',
		'libgnustep-base.o'
	);
}

export function resolveObjectiveCFoundationHeadersUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'foundationHeadersUrl',
		'PUBLIC_WASM_OBJECTIVEC_FOUNDATION_HEADERS_URL',
		'foundation-headers.json'
	);
}

export function resolveObjectiveCLibffiUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return resolveObjectiveCAssetUrl(
		options,
		currentUrl,
		'libffiUrl',
		'PUBLIC_WASM_OBJECTIVEC_LIBFFI_URL',
		'libffi.a'
	);
}

export function resolveObjectiveCRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
): ResolvedObjectiveCRuntimeAssetConfig {
	return {
		baseUrl: resolveObjectiveCBaseUrl(options, currentUrl),
		libobjcUrl: resolveObjectiveCLibobjcUrl(options, currentUrl),
		headersUrl: resolveObjectiveCHeadersUrl(options, currentUrl),
		libgnustepBaseUrl: resolveObjectiveCLibgnustepBaseUrl(options, currentUrl),
		libgnustepBaseObjectUrl: resolveObjectiveCLibgnustepBaseObjectUrl(options, currentUrl),
		foundationHeadersUrl: resolveObjectiveCFoundationHeadersUrl(options, currentUrl),
		libffiUrl: resolveObjectiveCLibffiUrl(options, currentUrl)
	};
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

export function resolveOctaveBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.octave?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_OCTAVE_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options) || ''}/wasm-octave/runtime/`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-octave/runtime/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-octave/runtime/', currentUrl);
}

export function resolveOctaveWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.octave?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_OCTAVE_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-octave/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-octave/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-octave/runner-worker.js', currentUrl);
}

export function resolveOctaveManifestUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredManifestUrl =
		(typeof options === 'object' && options?.octave?.manifestUrl) ||
		(publicEnv.PUBLIC_WASM_OCTAVE_MANIFEST_URL || '').trim();

	if (configuredManifestUrl) {
		return resolveConfiguredUrl(configuredManifestUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-octave/runtime/runtime-manifest.v1.json`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-octave/runtime/runtime-manifest.v1.json`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-octave/runtime/runtime-manifest.v1.json', currentUrl);
}

export function resolveOctaveRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveOctaveBaseUrl(options, currentUrl),
		workerUrl: resolveOctaveWorkerUrl(options, currentUrl),
		manifestUrl: resolveOctaveManifestUrl(options, currentUrl)
	};
}

export function resolvePrologBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.prolog?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_PROLOG_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-prolog/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-prolog/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-prolog/', currentUrl);
}

export function resolvePrologWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.prolog?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_PROLOG_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-prolog/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-prolog/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-prolog/runner-worker.js', currentUrl);
}

export function resolvePrologRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolvePrologBaseUrl(options, currentUrl),
		workerUrl: resolvePrologWorkerUrl(options, currentUrl)
	};
}

export function resolveGleamBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.gleam?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_GLEAM_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-gleam/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-gleam/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-gleam/', currentUrl);
}

export function resolveGleamWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.gleam?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_GLEAM_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-gleam/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-gleam/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-gleam/runner-worker.js', currentUrl);
}

export function resolveGleamManifestUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredManifestUrl =
		(typeof options === 'object' && options?.gleam?.manifestUrl) ||
		(publicEnv.PUBLIC_WASM_GLEAM_MANIFEST_URL || '').trim();

	if (configuredManifestUrl) {
		return resolveConfiguredUrl(configuredManifestUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-gleam/source-manifest.v1.json`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-gleam/source-manifest.v1.json`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-gleam/source-manifest.v1.json', currentUrl);
}

export function resolveGleamRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveGleamBaseUrl(options, currentUrl),
		workerUrl: resolveGleamWorkerUrl(options, currentUrl),
		manifestUrl: resolveGleamManifestUrl(options, currentUrl)
	};
}

export function resolvePerlBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.perl?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_PERL_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-perl/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-perl/', currentUrl);
}

export function resolvePerlWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.perl?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_PERL_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-perl/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-perl/runner-worker.js', currentUrl);
}

export function resolvePerlRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolvePerlBaseUrl(options, currentUrl),
		workerUrl: resolvePerlWorkerUrl(options, currentUrl)
	};
}

export function resolveTclBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.tcl?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_TCL_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-tcl/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tcl/`, currentUrl);
	}

	return normalizeBaseUrl('/wasm-tcl/', currentUrl);
}

export function resolveTclWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.tcl?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_TCL_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-tcl/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tcl/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-tcl/runner-worker.js', currentUrl);
}

export function resolveTclRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveTclBaseUrl(options, currentUrl),
		workerUrl: resolveTclWorkerUrl(options, currentUrl)
	};
}

export function resolveAwkBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.awk?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_AWK_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-awk/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-awk/`, currentUrl);
	}

	return normalizeBaseUrl('/wasm-awk/', currentUrl);
}

export function resolveAwkWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.awk?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_AWK_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-awk/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-awk/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-awk/runner-worker.js', currentUrl);
}

export function resolveAwkRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveAwkBaseUrl(options, currentUrl),
		workerUrl: resolveAwkWorkerUrl(options, currentUrl)
	};
}

export function resolvePascalBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.pascal?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_PASCAL_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-pascal/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-pascal/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-pascal/', currentUrl);
}

export function resolvePascalWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.pascal?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_PASCAL_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-pascal/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-pascal/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-pascal/runner-worker.js', currentUrl);
}

export function resolvePascalRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolvePascalBaseUrl(options, currentUrl),
		workerUrl: resolvePascalWorkerUrl(options, currentUrl)
	};
}

export function resolveClojureScriptBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.clojurescript?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_CLOJURESCRIPT_BASE_URL || '').trim();

	if (configuredBaseUrl) return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	if (typeof options === 'string') {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options) || ''}/wasm-clojurescript/`,
			currentUrl
		);
	}
	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-clojurescript/`,
			currentUrl
		);
	}
	return normalizeBaseUrl('/wasm-clojurescript/', currentUrl);
}

export function resolveClojureScriptWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.clojurescript?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL || '').trim();

	if (configuredWorkerUrl) return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-clojurescript/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-clojurescript/runner-worker.js`,
			currentUrl
		);
	}
	return resolveConfiguredUrl('/wasm-clojurescript/runner-worker.js', currentUrl);
}

export function resolveClojureScriptRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveClojureScriptBaseUrl(options, currentUrl),
		workerUrl: resolveClojureScriptWorkerUrl(options, currentUrl)
	};
}

export function resolveForthBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.forth?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_FORTH_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-forth/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-forth/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-forth/', currentUrl);
}

export function resolveForthWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.forth?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_FORTH_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-forth/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-forth/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-forth/runner-worker.js', currentUrl);
}

export function resolveForthRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveForthBaseUrl(options, currentUrl),
		workerUrl: resolveForthWorkerUrl(options, currentUrl)
	};
}

export function resolveJBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.j?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_J_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-j/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-j/`, currentUrl);
	}

	return normalizeBaseUrl('/wasm-j/', currentUrl);
}

export function resolveJWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.j?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_J_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-j/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-j/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-j/runner-worker.js', currentUrl);
}

export function resolveJRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveJBaseUrl(options, currentUrl),
		workerUrl: resolveJWorkerUrl(options, currentUrl)
	};
}

export function resolveBqnBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.bqn?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_BQN_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-bqn/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-bqn/`, currentUrl);
	}

	return normalizeBaseUrl('/wasm-bqn/', currentUrl);
}

export function resolveBqnWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.bqn?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_BQN_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-bqn/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-bqn/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-bqn/runner-worker.js', currentUrl);
}

export function resolveBqnRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveBqnBaseUrl(options, currentUrl),
		workerUrl: resolveBqnWorkerUrl(options, currentUrl)
	};
}

export function resolveJanetBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.janet?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_JANET_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-janet/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-janet/', currentUrl);
}

export function resolveJanetWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.janet?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_JANET_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-janet/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-janet/runner-worker.js', currentUrl);
}

export function resolveJanetRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveJanetBaseUrl(options, currentUrl),
		workerUrl: resolveJanetWorkerUrl(options, currentUrl)
	};
}

export function resolveJuliaBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.julia?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_JULIA_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-julia/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-julia/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-julia/', currentUrl);
}

export function resolveJuliaWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.julia?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_JULIA_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-julia/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-julia/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-julia/runner-worker.js', currentUrl);
}

export function resolveJuliaRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveJuliaBaseUrl(options, currentUrl),
		workerUrl: resolveJuliaWorkerUrl(options, currentUrl)
	};
}

export function resolveNimBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.nim?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_NIM_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-nim/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-nim/`, currentUrl);
	}

	return normalizeBaseUrl('/wasm-nim/', currentUrl);
}

export function resolveNimWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.nim?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_NIM_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-nim/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-nim/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-nim/runner-worker.js', currentUrl);
}

export function resolveNimRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveNimBaseUrl(options, currentUrl),
		workerUrl: resolveNimWorkerUrl(options, currentUrl)
	};
}

export function resolveSwiftBaseUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredBaseUrl =
		(typeof options === 'object' && options?.swift?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_SWIFT_BASE_URL || '').trim();

	if (configuredBaseUrl) {
		return normalizeBaseUrl(configuredBaseUrl, currentUrl);
	}

	if (typeof options === 'string') {
		return normalizeBaseUrl(`${normalizeRootUrl(options) || ''}/wasm-swift/`, currentUrl);
	}

	if (options?.rootUrl) {
		return normalizeBaseUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-swift/`,
			currentUrl
		);
	}

	return normalizeBaseUrl('/wasm-swift/', currentUrl);
}

export function resolveSwiftWorkerUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredWorkerUrl =
		(typeof options === 'object' && options?.swift?.workerUrl) ||
		(publicEnv.PUBLIC_WASM_SWIFT_WORKER_URL || '').trim();

	if (configuredWorkerUrl) {
		return resolveConfiguredUrl(configuredWorkerUrl, currentUrl);
	}

	const configuredBaseUrl =
		(typeof options === 'object' && options?.swift?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_SWIFT_BASE_URL || '').trim();
	if (configuredBaseUrl) {
		return resolveConfiguredUrl(
			`${normalizeBaseUrl(configuredBaseUrl, currentUrl)}runner-worker.js`,
			currentUrl
		);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-swift/runner-worker.js`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-swift/runner-worker.js`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-swift/runner-worker.js', currentUrl);
}

export function resolveSwiftManifestUrl(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	const configuredManifestUrl =
		(typeof options === 'object' && options?.swift?.manifestUrl) ||
		(publicEnv.PUBLIC_WASM_SWIFT_MANIFEST_URL || '').trim();

	if (configuredManifestUrl) {
		return resolveConfiguredUrl(configuredManifestUrl, currentUrl);
	}

	const configuredBaseUrl =
		(typeof options === 'object' && options?.swift?.baseUrl) ||
		(publicEnv.PUBLIC_WASM_SWIFT_BASE_URL || '').trim();
	if (configuredBaseUrl) {
		return resolveConfiguredUrl(
			`${normalizeBaseUrl(configuredBaseUrl, currentUrl)}runtime-manifest.v1.json`,
			currentUrl
		);
	}

	if (typeof options === 'string') {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options) || ''}/wasm-swift/runtime-manifest.v1.json`,
			currentUrl
		);
	}

	if (options?.rootUrl) {
		return resolveConfiguredUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-swift/runtime-manifest.v1.json`,
			currentUrl
		);
	}

	return resolveConfiguredUrl('/wasm-swift/runtime-manifest.v1.json', currentUrl);
}

export function resolveSwiftRuntimeAssetConfig(
	options: string | PlaygroundRuntimeAssets | undefined,
	currentUrl = ''
) {
	return {
		baseUrl: resolveSwiftBaseUrl(options, currentUrl),
		workerUrl: resolveSwiftWorkerUrl(options, currentUrl),
		manifestUrl: resolveSwiftManifestUrl(options, currentUrl)
	};
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
