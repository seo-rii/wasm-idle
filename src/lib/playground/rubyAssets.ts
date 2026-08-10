import {
	rewriteRuntimeModuleAssetSpecifier,
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_NAMES,
	snapshotRubyRuntimeAssetReceipts,
	verifyRuntimeAssetIntegrity,
	type RubyRuntimeAssetReceipts,
	type RubyRuntimeAssetReceipt
} from '@wasm-idle/core';

import { fetchRuntimeAssetBytes, resolveRuntimeAssetUrl } from './worker/runtimeAssetFetch';

export type RubyRuntimeAssetName = (typeof RUBY_RUNTIME_ASSET_NAMES)[number];
export type { RubyRuntimeAssetReceipt, RubyRuntimeAssetReceipts };

export interface RubyRuntimeAssetConfig {
	moduleUrl: string;
	wasmUrl: string;
	integrity: RubyRuntimeAssetReceipts;
	maxAssetBytes: number;
}

export function snapshotRubyRuntimeAssetConfig(
	config: RubyRuntimeAssetConfig
): RubyRuntimeAssetConfig {
	if (!config || typeof config !== 'object') {
		throw new TypeError('Ruby runtime asset configuration is required');
	}
	const maxAssetBytes = config.maxAssetBytes;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new TypeError('Ruby runtime maxAssetBytes must be a positive safe integer');
	}
	const integrity = snapshotRubyRuntimeAssetReceipts(config.integrity);
	for (const asset of RUBY_RUNTIME_ASSET_NAMES) {
		if (integrity[asset].bytes > maxAssetBytes) {
			throw new TypeError(`Ruby runtime receipt exceeds its limit for ${asset}`);
		}
	}
	const moduleUrl = resolveRuntimeAssetUrl(config.moduleUrl, 'Ruby runtime module').href;
	const wasmUrl = resolveRuntimeAssetUrl(config.wasmUrl, 'Ruby WASM asset').href;
	return Object.freeze({
		moduleUrl,
		wasmUrl,
		maxAssetBytes,
		integrity
	});
}

const fetchVerifiedAsset = async (
	asset: RubyRuntimeAssetName,
	url: string,
	receipt: RubyRuntimeAssetReceipt,
	signal: AbortSignal
) => {
	const bytes = await fetchRuntimeAssetBytes({
		url,
		label: asset === 'runtime.mjs' ? 'Ruby runtime module' : 'Ruby WASM asset',
		cache: 'no-store',
		maxAssetBytes: receipt.bytes,
		signal
	});
	await verifyRuntimeAssetIntegrity({
		asset,
		bytes,
		expected: receipt,
		runtimeId: 'RUBY'
	});
	return bytes;
};

export async function loadVerifiedRubyRuntimeAssets(config: RubyRuntimeAssetConfig) {
	const snapshot = snapshotRubyRuntimeAssetConfig(config);
	const controller = new AbortController();
	let moduleBytes: Uint8Array;
	let wasmBytes: Uint8Array;
	try {
		[moduleBytes, wasmBytes] = await Promise.all([
			fetchVerifiedAsset(
				'runtime.mjs',
				snapshot.moduleUrl,
				snapshot.integrity['runtime.mjs'],
				controller.signal
			),
			fetchVerifiedAsset(
				RUBY_RUNTIME_ASSET_PATH,
				snapshot.wasmUrl,
				snapshot.integrity[RUBY_RUNTIME_ASSET_PATH],
				controller.signal
			)
		]);
	} catch (error) {
		controller.abort(error);
		throw error;
	}
	const moduleSource = rewriteRuntimeModuleAssetSpecifier({
		bytes: moduleBytes,
		assetPath: RUBY_RUNTIME_ASSET_PATH,
		assetUrl: snapshot.wasmUrl,
		label: 'Ruby runtime module'
	});
	return {
		config: snapshot,
		moduleSource,
		wasmBytes: wasmBytes as Uint8Array<ArrayBuffer>
	};
}
