import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export const D_OUTER_ASSETS = ['index.js', 'runtime/runtime-manifest.v1.json'] as const;

export type DOuterAssetName = (typeof D_OUTER_ASSETS)[number];
export type DOuterAssetReceipt = Readonly<
	Required<
		Pick<
			RuntimeAssetIntegrityEntry,
			'bytes' | 'sha256' | 'uncompressedBytes' | 'uncompressedSha256'
		>
	>
>;
export type DOuterAssetReceipts = Readonly<Record<DOuterAssetName, DOuterAssetReceipt>>;

const snapshotReceipt = (
	asset: DOuterAssetName,
	value: RuntimeAssetIntegrityEntry | undefined
): DOuterAssetReceipt => {
	if (
		!value ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		!/^[a-f0-9]{64}$/u.test(value.sha256) ||
		value.uncompressedBytes !== value.bytes ||
		value.uncompressedSha256 !== value.sha256
	) {
		throw new TypeError(`D outer asset receipt is invalid for ${asset}`);
	}
	return Object.freeze({
		bytes: value.bytes as number,
		sha256: value.sha256,
		uncompressedBytes: value.uncompressedBytes as number,
		uncompressedSha256: value.uncompressedSha256
	});
};

export function snapshotDOuterAssetReceipts(
	value: DOuterAssetReceipts | undefined
): DOuterAssetReceipts {
	const receivedAssets = Object.keys(value || {}).sort();
	const expectedAssets = [...D_OUTER_ASSETS].sort();
	if (
		receivedAssets.length !== expectedAssets.length ||
		receivedAssets.some((asset, index) => asset !== expectedAssets[index])
	) {
		throw new TypeError('D language server requires exactly two outer asset receipts');
	}
	return Object.freeze({
		'index.js': snapshotReceipt('index.js', value?.['index.js']),
		'runtime/runtime-manifest.v1.json': snapshotReceipt(
			'runtime/runtime-manifest.v1.json',
			value?.['runtime/runtime-manifest.v1.json']
		)
	});
}
