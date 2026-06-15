const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);

export function resolveRuntimeBaseUrl(baseUrl?: string | URL) {
	return new URL(baseUrl?.toString() || DEFAULT_RUNTIME_BASE_URL.toString());
}

export function resolveVersionedAssetUrl(baseUrl: string | URL, asset: string) {
	const normalizedBase = resolveRuntimeBaseUrl(baseUrl);
	const version = normalizedBase.searchParams.get('v');
	const url = new URL(asset, normalizedBase);
	if (version && !url.searchParams.has('v')) url.searchParams.set('v', version);
	return url;
}

export function runtimeManifestUrl(baseUrl?: string | URL) {
	return resolveVersionedAssetUrl(resolveRuntimeBaseUrl(baseUrl), 'runtime-manifest.v1.json');
}
