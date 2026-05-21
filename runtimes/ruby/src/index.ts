export const RUBY_WASM_RUNTIME_PACKAGE = '@ruby/wasm-wasi';
export const RUBY_3_4_WASM_PACKAGE = '@ruby/3.4-wasm-wasi';
export const RUBY_DEFAULT_PACKAGE = RUBY_3_4_WASM_PACKAGE;

export const RUBY_WASM_ASSETS = [
	'dist/ruby.wasm',
	'dist/ruby+stdlib.wasm',
	'dist/ruby.debug+stdlib.wasm',
	'dist/browser.script.iife.js',
	'dist/browser.script.umd.js',
	'dist/index.umd.js'
] as const;

export type RubyWasmAsset = (typeof RUBY_WASM_ASSETS)[number];
export type RubyWasmEnvironment = 'browser' | 'node' | 'browser-script';

export interface RubyAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface RubyModuleImportOptions {
	environment?: RubyWasmEnvironment;
	packageName?: string;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeRubyBaseUrl(baseUrl: string | URL = '/ruby/', currentUrl?: string | URL) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveRubyAssetUrl(
	asset: RubyWasmAsset | string,
	options: RubyAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeRubyBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createRubyAssetManifest(options: RubyAssetResolverOptions = {}) {
	return Object.fromEntries(
		RUBY_WASM_ASSETS.map((asset) => [asset, resolveRubyAssetUrl(asset, options)])
	) as Record<RubyWasmAsset, string>;
}

export function resolveRubyModuleSpecifier(options: RubyModuleImportOptions = {}) {
	const { environment = 'browser', packageName = RUBY_DEFAULT_PACKAGE } = options;
	if (environment === 'browser-script') return `${packageName}/dist/esm/browser.script.js`;
	if (environment === 'node') return `${packageName}/dist/esm/node.js`;
	return packageName;
}

export async function importRubyWasmModule<T = unknown>(
	options: RubyModuleImportOptions = {}
): Promise<T> {
	const moduleName = resolveRubyModuleSpecifier(options);
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
