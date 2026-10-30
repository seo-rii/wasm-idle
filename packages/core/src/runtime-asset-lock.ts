import { RUNTIME_ASSET_LOCK } from './runtime-asset-lock.generated.js';
import {
	resolveRuntimeAssetLockEntryFromManifest,
	type ResolveRuntimeAssetLockOptions,
	type RuntimeAssetLockEntry
} from './runtime-asset-lock-manifest.js';

export type {
	ResolveRuntimeAssetLockOptions,
	RuntimeAssetLockEntry,
	RuntimeAssetLockManifest
} from './runtime-asset-lock-manifest.js';

/** Synchronous compatibility API; async asset loaders should use loadRuntimeAssetLockEntry. */
export function resolveRuntimeAssetLockEntry(
	input: string | URL,
	options: ResolveRuntimeAssetLockOptions
): RuntimeAssetLockEntry | undefined {
	try {
		return resolveRuntimeAssetLockEntryFromManifest(input, {
			assetRoot: options.assetRoot,
			assetPrefix: options.assetPrefix,
			manifest: options.manifest ?? RUNTIME_ASSET_LOCK
		});
	} catch {
		return undefined;
	}
}
