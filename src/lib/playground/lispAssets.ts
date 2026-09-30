import {
	loadVerifiedLispRuntime,
	type RuntimeAssetCacheOptions,
	type LispRuntimeModuleEnvironment,
	type VerifiedLispRuntime
} from '@wasm-idle/core';
import type { ResolvedLispRuntimeAssetConfig } from './assets';
import { fetchRuntimeAssetBytes, resolveRuntimeAssetUrl } from './worker/runtimeAssetFetch';

const MAX_LISP_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_LISP_ASSET_BYTES = 128 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface LoadVerifiedLispRuntimeAssetsOptions {
	persistentCache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
	maxAssetBytes?: number;
	moduleEnvironment?: LispRuntimeModuleEnvironment;
	decompressGzip?: (
		bytes: Uint8Array,
		expectedBytes: number,
		signal: AbortSignal
	) => Promise<Uint8Array>;
}

function resolveMaxAssetBytes(value: number | undefined) {
	const resolved = value ?? DEFAULT_MAX_LISP_ASSET_BYTES;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) {
		throw new TypeError('Lisp runtime maxAssetBytes must be a positive safe integer');
	}
	return resolved;
}

function assertManifestAssetLimits(value: unknown, maxAssetBytes: number) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return;
	const manifest = value as {
		assets?: Array<{ path?: unknown; size?: unknown }>;
		storage?: Array<{ path?: unknown; size?: unknown }>;
	};
	const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
	const storage = Array.isArray(manifest.storage) ? manifest.storage : [];
	for (const asset of [...assets, ...storage]) {
		if (Number.isSafeInteger(asset?.size) && (asset.size as number) > maxAssetBytes) {
			throw new Error(
				`Lisp runtime asset ${String(asset.path || 'unknown')} exceeds the ${maxAssetBytes} byte limit`
			);
		}
	}
}

function requireLispRuntimeConfig(config: ResolvedLispRuntimeAssetConfig) {
	if (!config.moduleUrl || !config.manifestUrl) {
		throw new TypeError(
			'Lisp runtime requires moduleUrl and manifestUrl from one published runtime profile'
		);
	}
	if (!/^[a-f0-9]{64}$/u.test(config.manifestFingerprint)) {
		throw new TypeError(
			'Lisp runtime requires an explicit 64-character manifestFingerprint trust anchor'
		);
	}
	return {
		moduleUrl: resolveRuntimeAssetUrl(config.moduleUrl, 'Lisp runtime module'),
		manifestUrl: resolveRuntimeAssetUrl(config.manifestUrl, 'Lisp runtime manifest')
	};
}

export async function loadVerifiedLispRuntimeAssets(
	config: ResolvedLispRuntimeAssetConfig,
	options: LoadVerifiedLispRuntimeAssetsOptions = {}
): Promise<VerifiedLispRuntime> {
	const { moduleUrl, manifestUrl } = requireLispRuntimeConfig(config);
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	const manifestBytes = await fetchRuntimeAssetBytes({
		url: manifestUrl.href,
		label: 'Lisp runtime manifest',
		cache: 'no-cache',
		expected: config.manifestReceipt,
		persistentCache: options.persistentCache,
		maxAssetBytes: Math.min(MAX_LISP_MANIFEST_BYTES, maxAssetBytes),
		signal: options.signal
	});
	let manifest: unknown;
	try {
		manifest = JSON.parse(decoder.decode(manifestBytes));
	} catch (error) {
		throw new TypeError(
			`Lisp runtime manifest is not valid UTF-8 JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	assertManifestAssetLimits(manifest, maxAssetBytes);
	const assetBaseUrl = new URL('./', moduleUrl);
	return await loadVerifiedLispRuntime({
		manifest,
		expectedFingerprint: config.manifestFingerprint,
		loadStorageAsset: async (asset, signal, logicalAsset) => {
			const assetUrl = new URL(asset.path, assetBaseUrl);
			assetUrl.search = moduleUrl.search || manifestUrl.search;
			return await fetchRuntimeAssetBytes({
				url: assetUrl.href,
				label: `Lisp runtime asset ${asset.logicalPath}`,
				cache: 'force-cache',
				expected: {
					sha256: asset.sha256,
					bytes: asset.size,
					uncompressedSha256: logicalAsset.sha256,
					uncompressedBytes: logicalAsset.size
				},
				persistentCache: options.persistentCache,
				integrityContext: { asset: asset.logicalPath, runtimeId: 'LISP' },
				maxAssetBytes: Math.min(maxAssetBytes, Math.max(asset.size, logicalAsset.size)),
				signal
			});
		},
		signal: options.signal,
		moduleEnvironment: options.moduleEnvironment,
		decompressGzip: options.decompressGzip
	});
}
