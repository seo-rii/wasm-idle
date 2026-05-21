export const WEBR_PACKAGE = 'webr';

export const WEBR_CORE_ASSETS = [
	'dist/webr.mjs',
	'dist/webr.js',
	'dist/webr-worker.js',
	'dist/R.js',
	'dist/R.wasm',
	'dist/libRblas.so',
	'dist/libRlapack.so'
] as const;

export type WebRCoreAsset = (typeof WEBR_CORE_ASSETS)[number];

export interface WebRAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface WebRImportOptions {
	moduleName?: string;
}

export interface WebRConstructorLike {
	new (options?: Record<string, unknown>): unknown;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeWebRBaseUrl(baseUrl: string | URL = '/webr/', currentUrl?: string | URL) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveWebRAssetUrl(
	asset: WebRCoreAsset | string,
	options: WebRAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeWebRBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createWebRAssetManifest(options: WebRAssetResolverOptions = {}) {
	return Object.fromEntries(
		WEBR_CORE_ASSETS.map((asset) => [asset, resolveWebRAssetUrl(asset, options)])
	) as Record<WebRCoreAsset, string>;
}

export function createWebRRuntimeOptions(options: WebRAssetResolverOptions = {}) {
	const baseUrl = normalizeWebRBaseUrl(options.baseUrl, options.currentUrl);
	return {
		baseUrl,
		RHome: `${baseUrl}dist/vfs/usr/lib/R`,
		assets: createWebRAssetManifest({ baseUrl })
	};
}

export async function importWebRModule<T = { WebR?: WebRConstructorLike }>(
	options: WebRImportOptions = {}
): Promise<T> {
	const moduleName = options.moduleName ?? WEBR_PACKAGE;
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
