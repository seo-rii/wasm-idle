export const TEAVM_LOAD_ASSETS = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

export type TeaVmLoadAsset = (typeof TEAVM_LOAD_ASSETS)[number];

export interface TeaVmAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface TeaVmFetchAssetOptions extends TeaVmAssetResolverOptions {
	fetch?: typeof fetch;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeTeaVmBaseUrl(
	baseUrl: string | URL = '/teavm/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveTeaVmAssetUrl(
	asset: TeaVmLoadAsset | string,
	options: TeaVmAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeTeaVmBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createTeaVmAssetManifest(options: TeaVmAssetResolverOptions = {}) {
	return Object.fromEntries(
		TEAVM_LOAD_ASSETS.map((asset) => [asset, resolveTeaVmAssetUrl(asset, options)])
	) as Record<TeaVmLoadAsset, string>;
}

export async function fetchTeaVmAsset(
	asset: TeaVmLoadAsset,
	options: TeaVmFetchAssetOptions = {}
): Promise<Uint8Array> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	if (!fetchImpl) throw new Error('fetch is required to load TeaVM runtime assets.');
	const response = await fetchImpl(resolveTeaVmAssetUrl(asset, options));
	if (!response.ok) {
		throw new Error(`Failed to load TeaVM runtime asset ${asset}: ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
