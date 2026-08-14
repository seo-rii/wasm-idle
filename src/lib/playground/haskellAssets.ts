import {
	HASKELL_RUNTIME_ASSET_NAMES,
	snapshotHaskellRuntimeAssetReceipts,
	verifyRuntimeAssetIntegrity,
	type HaskellRuntimeAssetName,
	type HaskellRuntimeAssetReceipt,
	type HaskellRuntimeAssetReceipts
} from '@wasm-idle/core';

import { fetchRuntimeAssetBytes, resolveRuntimeAssetUrl } from './worker/runtimeAssetFetch';

export type { HaskellRuntimeAssetReceipt, HaskellRuntimeAssetReceipts };

export interface HaskellRuntimeAssetConfig {
	readonly moduleUrl: string;
	readonly rootfsUrl: string;
	readonly bsdtarUrl: string;
	readonly integrity: HaskellRuntimeAssetReceipts;
	readonly maxAssetBytes: number;
}

export interface HaskellRuntimeAssetProgress {
	readonly asset: HaskellRuntimeAssetName;
	readonly loaded: number;
	readonly total?: number;
}

export function snapshotHaskellRuntimeAssetConfig(
	config: HaskellRuntimeAssetConfig
): HaskellRuntimeAssetConfig {
	if (!config || typeof config !== 'object') {
		throw new TypeError('Haskell runtime asset configuration is required');
	}
	const moduleUrl = config.moduleUrl;
	const rootfsUrl = config.rootfsUrl;
	const bsdtarUrl = config.bsdtarUrl;
	const integrityInput = config.integrity;
	const maxAssetBytes = config.maxAssetBytes;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new TypeError('Haskell runtime maxAssetBytes must be a positive safe integer');
	}
	const integrity = snapshotHaskellRuntimeAssetReceipts(integrityInput);
	for (const asset of HASKELL_RUNTIME_ASSET_NAMES) {
		if (integrity[asset].bytes > maxAssetBytes) {
			throw new TypeError(`Haskell runtime receipt exceeds its limit for ${asset}`);
		}
	}
	return Object.freeze({
		moduleUrl: resolveRuntimeAssetUrl(moduleUrl, 'Haskell runtime module').href,
		rootfsUrl: resolveRuntimeAssetUrl(rootfsUrl, 'Haskell GHC rootfs').href,
		bsdtarUrl: resolveRuntimeAssetUrl(bsdtarUrl, 'Haskell rootfs extractor').href,
		integrity,
		maxAssetBytes
	});
}

const decoder = new TextDecoder('utf-8', { fatal: true });

export async function loadVerifiedHaskellRuntimeAssets(
	config: HaskellRuntimeAssetConfig,
	options: {
		readonly signal?: AbortSignal;
		readonly onProgress?: (progress: HaskellRuntimeAssetProgress) => void;
	} = {}
) {
	const snapshot = snapshotHaskellRuntimeAssetConfig(config);
	const controller = new AbortController();
	const forwardAbort = () =>
		controller.abort(
			options.signal?.reason ??
				new DOMException('Haskell runtime asset loading was aborted', 'AbortError')
		);
	options.signal?.addEventListener('abort', forwardAbort, { once: true });
	if (options.signal?.aborted) forwardAbort();
	try {
		const [moduleBytes, rootfsBytes, bsdtarBytes] = await Promise.all(
			HASKELL_RUNTIME_ASSET_NAMES.map(async (asset) => {
				const url =
					asset === 'dyld.mjs'
						? snapshot.moduleUrl
						: asset === 'rootfs.tar.zst'
							? snapshot.rootfsUrl
							: snapshot.bsdtarUrl;
				const receipt: HaskellRuntimeAssetReceipt = snapshot.integrity[asset];
				const bytes = await fetchRuntimeAssetBytes({
					url,
					label:
						asset === 'dyld.mjs'
							? 'Haskell runtime module'
							: asset === 'rootfs.tar.zst'
								? 'Haskell GHC rootfs'
								: 'Haskell rootfs extractor',
					cache: 'no-store',
					maxAssetBytes: Math.min(receipt.bytes, snapshot.maxAssetBytes),
					signal: controller.signal,
					onProgress(progress) {
						options.onProgress?.({ asset, ...progress });
					}
				});
				if (controller.signal.aborted) throw controller.signal.reason;
				await verifyRuntimeAssetIntegrity({
					asset,
					bytes,
					expected: receipt,
					runtimeId: 'HASKELL'
				});
				if (controller.signal.aborted) throw controller.signal.reason;
				return bytes;
			})
		);
		let moduleSource: string;
		try {
			moduleSource = decoder.decode(moduleBytes);
		} catch (error) {
			throw new TypeError('Haskell runtime module is not valid UTF-8', { cause: error });
		}
		return Object.freeze({
			config: snapshot,
			moduleSource,
			rootfsBytes: rootfsBytes as Uint8Array<ArrayBuffer>,
			bsdtarBytes: bsdtarBytes as Uint8Array<ArrayBuffer>
		});
	} catch (error) {
		controller.abort(error);
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', forwardAbort);
	}
}
