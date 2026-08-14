import {
	loadVerifiedLispRuntime,
	type LispRuntimeModuleEnvironment,
	type VerifiedLispRuntime
} from '@wasm-idle/core';
import type { ResolvedLispRuntimeAssetConfig } from './assets';
import { fetchRuntimeAssetBytes, resolveRuntimeAssetUrl } from './worker/runtimeAssetFetch';

const MAX_LISP_MANIFEST_BYTES = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface LoadVerifiedLispRuntimeAssetsOptions {
	signal?: AbortSignal;
	moduleEnvironment?: LispRuntimeModuleEnvironment;
	decompressGzip?: (
		bytes: Uint8Array,
		expectedBytes: number,
		signal: AbortSignal
	) => Promise<Uint8Array>;
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
	const manifestBytes = await fetchRuntimeAssetBytes({
		url: manifestUrl.href,
		label: 'Lisp runtime manifest',
		cache: 'no-cache',
		maxAssetBytes: MAX_LISP_MANIFEST_BYTES,
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
				maxAssetBytes: Math.max(asset.size, logicalAsset.size),
				signal
			});
		},
		signal: options.signal,
		moduleEnvironment: options.moduleEnvironment,
		decompressGzip: options.decompressGzip
	});
}
