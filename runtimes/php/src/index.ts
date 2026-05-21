export const PHP_WASM_WEB_PACKAGE = '@php-wasm/web';
export const PHP_WASM_NODE_PACKAGE = '@php-wasm/node';

export const PHP_SUPPORTED_VERSIONS = [
	'8.5',
	'8.4',
	'8.3',
	'8.2',
	'8.1',
	'8.0',
	'7.4',
	'5.2'
] as const;

export type PhpWasmVersion = (typeof PHP_SUPPORTED_VERSIONS)[number];
export type PhpWasmHost = 'web' | 'node';

export interface PhpRuntimeImportOptions {
	host?: PhpWasmHost;
	moduleName?: string;
}

export interface PhpVersionPackageOptions {
	host?: PhpWasmHost;
	version?: PhpWasmVersion;
}

export interface PhpAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
	version?: PhpWasmVersion;
	host?: PhpWasmHost;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

const normalizePhpVersionForPackage = (version: PhpWasmVersion) => version.replace('.', '-');

export function normalizePhpBaseUrl(baseUrl: string | URL = '/php/', currentUrl?: string | URL) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolvePhpVersionPackage(options: PhpVersionPackageOptions = {}) {
	const { host = 'web', version = '8.4' } = options;
	return `@php-wasm/${host}-${normalizePhpVersionForPackage(version)}`;
}

export function resolvePhpRuntimeModule(options: PhpRuntimeImportOptions = {}) {
	if (options.moduleName) return options.moduleName;
	return options.host === 'node' ? PHP_WASM_NODE_PACKAGE : PHP_WASM_WEB_PACKAGE;
}

export function resolvePhpAssetUrl(asset: string, options: PhpAssetResolverOptions = {}) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizePhpBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createPhpRuntimeManifest(options: PhpAssetResolverOptions = {}) {
	const { host = 'web', version = '8.4' } = options;
	const versionPackage = resolvePhpVersionPackage({ host, version });
	return {
		host,
		version,
		runtimePackage: host === 'node' ? PHP_WASM_NODE_PACKAGE : PHP_WASM_WEB_PACKAGE,
		versionPackage,
		baseUrl: normalizePhpBaseUrl(options.baseUrl, options.currentUrl)
	};
}

export async function importPhpRuntime<T = unknown>(
	options: PhpRuntimeImportOptions = {}
): Promise<T> {
	const moduleName = resolvePhpRuntimeModule(options);
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
