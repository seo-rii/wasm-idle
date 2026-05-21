import { resolveVersionedAssetUrl } from './asset-url.js';
import {
	isMissingRuntimeManifestError,
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	resolveTargetManifest
} from './runtime-manifest.js';
import type { SupportedTargetTriple } from './types.js';

export async function loadBundledRuntimeContext(
	loadManifest: typeof loadRuntimeManifest = loadRuntimeManifest,
	targetTriple?: SupportedTargetTriple
) {
	const runtimeBaseUrl = resolveVersionedAssetUrl(import.meta.url, './runtime/');
	let loadedManifest;
	let lastMissingManifestError: unknown = null;
	for (const manifestFileName of [
		'runtime-manifest.v3.json',
		'runtime-manifest.v2.json',
		'runtime-manifest.json'
	]) {
		try {
			loadedManifest = await loadManifest(
				resolveVersionedAssetUrl(runtimeBaseUrl, manifestFileName)
			);
			break;
		} catch (error) {
			if (!isMissingRuntimeManifestError(error)) {
				throw error;
			}
			lastMissingManifestError = error;
		}
	}
	if (!loadedManifest) {
		throw lastMissingManifestError instanceof Error
			? lastMissingManifestError
			: new Error('failed to load a bundled wasm-rust runtime manifest');
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
