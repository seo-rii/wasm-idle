export function resolveVersionedAssetUrl(baseUrl: string | URL, assetPath: string): URL {
	const base = new URL(baseUrl.toString());
	const resolved = new URL(assetPath, base);
	if (!resolved.search && base.search && resolved.protocol !== 'blob:') {
		resolved.search = base.search;
	}
	return resolved;
}
