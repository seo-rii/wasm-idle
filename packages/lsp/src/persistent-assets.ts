import {
	resolveRuntimeAssetCacheOptions,
	configureRuntimeAssetCache,
	resolveRuntimeAssetLockEntry,
	type RuntimeAssetCacheOptions,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface LanguageToolPersistentOptions {
	/** False disables persistent reads and writes, without changing HTTP cache policy. */
	persistentCache?: RuntimeAssetCacheOptions;
	/** Explicit built-in distribution root used only for pinned asset-lock receipts. */
	assetRoot?: string;
}

// Each language server owns a worker. Its host sends this snapshot explicitly;
// host globals do not otherwise propagate across Worker boundaries.
let workerOptions: LanguageToolPersistentOptions | undefined;

export function configureWorkerLanguageToolPersistentAssets(
	options: LanguageToolPersistentOptions
) {
	workerOptions = {
		persistentCache: resolveRuntimeAssetCacheOptions(options.persistentCache),
		assetRoot: options.assetRoot
	};
	configureRuntimeAssetCache(workerOptions.persistentCache!);
}

export function resolveLanguageToolPersistentOptions(options: LanguageToolPersistentOptions = {}) {
	return {
		persistentCache: resolveRuntimeAssetCacheOptions(
			workerOptions?.persistentCache,
			options.persistentCache
		),
		assetRoot: options.assetRoot ?? workerOptions?.assetRoot
	};
}

export function resolveLanguageToolPersistentReceipt(
	url: string,
	options: LanguageToolPersistentOptions,
	receipt?: string | RuntimeAssetIntegrityEntry
): RuntimeAssetIntegrityEntry | undefined {
	if (receipt !== undefined) return typeof receipt === 'string' ? { sha256: receipt } : receipt;
	const assetRoot = resolveLanguageToolPersistentOptions(options).assetRoot;
	return assetRoot ? resolveRuntimeAssetLockEntry(url, { assetRoot }) : undefined;
}
