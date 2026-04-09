import { resolveVersionedAssetUrl } from './asset-url.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';
export async function loadBundledRuntimeContext(loadManifest = loadRuntimeManifest, targetTriple) {
    const runtimeBaseUrl = resolveVersionedAssetUrl(import.meta.url, './runtime/');
    let loadedManifest;
    try {
        loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v3.json'));
    }
    catch {
        try {
            loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v2.json'));
        }
        catch {
            loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.json'));
        }
    }
    const manifest = normalizeRuntimeManifest(loadedManifest);
    const targetConfig = resolveTargetManifest(manifest, targetTriple);
    const versionedModuleBaseUrl = new URL(import.meta.url);
    versionedModuleBaseUrl.searchParams.set('v', manifest.version);
    const versionedRuntimeBaseUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './runtime/');
    return {
        manifest,
        targetConfig,
        versionedModuleBaseUrl,
        versionedRuntimeBaseUrl
    };
}
