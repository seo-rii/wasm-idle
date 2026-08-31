import { resolveVersionedAssetUrl } from './asset-url.js';
import {
	isMissingRuntimeManifestError,
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	registerRuntimeManifestAssetReceipts,
	resolveRuntimeAssetDeliveryExpectedBytes,
	resolveTargetManifest
} from './runtime-manifest.js';
import type { WasmRustRuntimeProfile } from './runtime-manifest.js';
import { declareRuntimeAssetDeliveryExpectedBytes } from './runtime-delivery-budget.js';
import type { RuntimeAssetDeliveryBudgetDescriptor, SupportedTargetTriple } from './types.js';

export async function loadBundledRuntimeContext(
	manifestLoader: typeof loadRuntimeManifest = loadRuntimeManifest,
	targetTriple?: SupportedTargetTriple,
	runtimeProfile?: WasmRustRuntimeProfile,
	options: {
		deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor;
		onManifestProgress?: (progress: { loaded: number; total?: number }) => void;
	} = {}
) {
	if (!runtimeProfile && manifestLoader === loadRuntimeManifest) {
		throw new Error('wasm-rust runtime receipt profile is required');
	}
	const effectiveManifestLoader = runtimeProfile ? loadRuntimeManifest : manifestLoader;
	const moduleBaseUrl = runtimeProfile
		? new URL(runtimeProfile.moduleUrl)
		: new URL(import.meta.url);
	const runtimeBaseUrl = resolveVersionedAssetUrl(moduleBaseUrl, './runtime/');
	let loadedManifest;
	let lastMissingManifestError: unknown = null;
	const manifestFileNames = runtimeProfile
		? [runtimeProfile.manifestPath.replace(/^runtime\//u, '')]
		: ['runtime-manifest.v3.json', 'runtime-manifest.v2.json', 'runtime-manifest.json'];
	for (const manifestFileName of manifestFileNames) {
		try {
			loadedManifest = await effectiveManifestLoader(
				resolveVersionedAssetUrl(runtimeBaseUrl, manifestFileName),
				fetch,
				{
					...(runtimeProfile ? { receipt: runtimeProfile.manifestReceipt } : {}),
					...(options.deliveryBudget ? { deliveryBudget: options.deliveryBudget } : {}),
					...(options.onManifestProgress
						? { onProgress: options.onManifestProgress }
						: {})
				}
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
	if (runtimeProfile) {
		registerRuntimeManifestAssetReceipts(runtimeBaseUrl, manifest);
	} else if (manifest.assetReceipts) {
		registerRuntimeManifestAssetReceipts(runtimeBaseUrl, manifest);
	}
	const targetConfig = resolveTargetManifest(manifest, targetTriple);
	if (options.deliveryBudget) {
		if (!runtimeProfile) {
			throw new Error('wasm-rust aggregate asset delivery requires a pinned runtime profile');
		}
		declareRuntimeAssetDeliveryExpectedBytes(
			options.deliveryBudget,
			resolveRuntimeAssetDeliveryExpectedBytes(
				manifest,
				runtimeProfile.manifestReceipt.bytes,
				targetConfig.targetTriple
			)
		);
	}
	const versionedModuleBaseUrl = new URL(moduleBaseUrl);
	if (runtimeProfile) {
		versionedModuleBaseUrl.searchParams.set('v', runtimeProfile.manifestFingerprint);
	} else {
		versionedModuleBaseUrl.searchParams.set('v', manifest.version);
	}
	const versionedRuntimeBaseUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './runtime/');
	return {
		manifest,
		targetConfig,
		versionedModuleBaseUrl,
		versionedRuntimeBaseUrl
	};
}
