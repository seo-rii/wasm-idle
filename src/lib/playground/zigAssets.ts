import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export const ZIG_EXECUTION_ASSET_NAMES = ['zig_small.wasm', 'std.tar.gz'] as const;

export type ZigExecutionAssetName = (typeof ZIG_EXECUTION_ASSET_NAMES)[number];
export type ZigExecutionAssetReceipt = Readonly<
	Required<Pick<RuntimeAssetIntegrityEntry, 'bytes' | 'sha256'>> &
		Pick<RuntimeAssetIntegrityEntry, 'uncompressedBytes' | 'uncompressedSha256'>
>;
export type ZigExecutionAssetReceipts = Readonly<
	Record<ZigExecutionAssetName, ZigExecutionAssetReceipt>
>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function snapshotZigExecutionAssetReceipts(
	value: ZigExecutionAssetReceipts | undefined
): ZigExecutionAssetReceipts {
	const receivedAssets = Object.keys(value || {}).sort();
	const expectedAssets = [...ZIG_EXECUTION_ASSET_NAMES].sort();
	if (
		receivedAssets.length !== expectedAssets.length ||
		receivedAssets.some((asset, index) => asset !== expectedAssets[index])
	) {
		throw new TypeError('Zig execution requires exactly two asset receipts');
	}

	const receipts = Object.fromEntries(
		ZIG_EXECUTION_ASSET_NAMES.map((asset) => {
			const receipt = value?.[asset] as RuntimeAssetIntegrityEntry | undefined;
			if (
				!receipt ||
				!Number.isSafeInteger(receipt.bytes) ||
				(receipt.bytes as number) <= 0 ||
				typeof receipt.sha256 !== 'string' ||
				!SHA256_PATTERN.test(receipt.sha256)
			) {
				throw new TypeError(`Zig execution asset receipt is invalid for ${asset}`);
			}

			const hasUncompressedBytes = receipt.uncompressedBytes !== undefined;
			const hasUncompressedSha256 = receipt.uncompressedSha256 !== undefined;
			if (asset === 'std.tar.gz') {
				if (
					!hasUncompressedBytes ||
					!hasUncompressedSha256 ||
					!Number.isSafeInteger(receipt.uncompressedBytes) ||
					(receipt.uncompressedBytes as number) <= 0 ||
					typeof receipt.uncompressedSha256 !== 'string' ||
					!SHA256_PATTERN.test(receipt.uncompressedSha256)
				) {
					throw new TypeError(
						'Zig execution asset receipt is invalid for std.tar.gz uncompressed bytes'
					);
				}
			} else if (hasUncompressedBytes || hasUncompressedSha256) {
				throw new TypeError(
					'Zig execution asset receipt must not declare an uncompressed compiler stage'
				);
			}

			return [
				asset,
				Object.freeze({
					bytes: receipt.bytes as number,
					sha256: receipt.sha256,
					...(asset === 'std.tar.gz'
						? {
								uncompressedBytes: receipt.uncompressedBytes as number,
								uncompressedSha256: receipt.uncompressedSha256 as string
							}
						: {})
				})
			] as const;
		})
	) as Record<ZigExecutionAssetName, ZigExecutionAssetReceipt>;

	return Object.freeze(receipts);
}
