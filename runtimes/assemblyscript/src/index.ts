export const ASSEMBLYSCRIPT_PACKAGE = 'assemblyscript';
export const ASSEMBLYSCRIPT_ASC_MODULE = 'assemblyscript/asc';
export const ASSEMBLYSCRIPT_LOADER_MODULE = '@assemblyscript/loader';

export const ASSEMBLYSCRIPT_PACKAGE_ASSETS = [
	'dist/asc.js',
	'dist/assemblyscript.js',
	'dist/web.js',
	'std/assembly/index.d.ts',
	'std/portable/index.js'
] as const;

export type AssemblyScriptPackageAsset = (typeof ASSEMBLYSCRIPT_PACKAGE_ASSETS)[number];
export type AssemblyScriptRuntime = 'incremental' | 'minimal' | 'stub';
export type AssemblyScriptBindings = 'esm' | 'raw';

export interface AssemblyScriptAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface AssemblyScriptCompileArgsOptions {
	entry?: string;
	outFile?: string;
	textFile?: string;
	runtime?: AssemblyScriptRuntime;
	bindings?: AssemblyScriptBindings;
	optimize?: boolean;
	exportRuntime?: boolean;
	sourceMap?: boolean | string;
	extraArgs?: string[];
}

export interface AssemblyScriptCompilerModule {
	main?: (args: string[], options?: unknown, callback?: unknown) => unknown;
	[key: string]: unknown;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeAssemblyScriptBaseUrl(
	baseUrl: string | URL = '/assemblyscript/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveAssemblyScriptAssetUrl(
	asset: AssemblyScriptPackageAsset | string,
	options: AssemblyScriptAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeAssemblyScriptBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createAssemblyScriptAssetManifest(
	options: AssemblyScriptAssetResolverOptions = {}
) {
	return Object.fromEntries(
		ASSEMBLYSCRIPT_PACKAGE_ASSETS.map((asset) => [
			asset,
			resolveAssemblyScriptAssetUrl(asset, options)
		])
	) as Record<AssemblyScriptPackageAsset, string>;
}

export function createAssemblyScriptCompileArgs(options: AssemblyScriptCompileArgsOptions = {}) {
	const {
		entry = 'assembly/index.ts',
		outFile = 'module.wasm',
		textFile,
		runtime = 'incremental',
		bindings = 'esm',
		optimize = true,
		exportRuntime = true,
		sourceMap,
		extraArgs = []
	} = options;
	const args = [entry, '--outFile', outFile, '--runtime', runtime, '--bindings', bindings];
	if (textFile) args.push('--textFile', textFile);
	if (optimize) args.push('--optimize');
	if (exportRuntime) args.push('--exportRuntime');
	if (sourceMap) args.push('--sourceMap', typeof sourceMap === 'string' ? sourceMap : '');
	args.push(...extraArgs);
	return args;
}

export async function importAssemblyScriptCompiler<T = AssemblyScriptCompilerModule>(
	moduleName = ASSEMBLYSCRIPT_ASC_MODULE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}

export async function importAssemblyScriptLoader<T = unknown>(
	moduleName = ASSEMBLYSCRIPT_LOADER_MODULE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
