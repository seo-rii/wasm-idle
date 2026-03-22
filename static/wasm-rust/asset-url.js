export function resolveVersionedAssetUrl(baseUrl, assetPath) {
    const base = new URL(baseUrl.toString());
    const resolved = new URL(assetPath, base);
    if (!resolved.search && base.search) {
        resolved.search = base.search;
    }
    return resolved;
}
