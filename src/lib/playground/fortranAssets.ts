import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export const FORTRAN_EXECUTION_ASSET_NAMES = ['f2c.wasm', 'libf2c.a', 'f2c.h'] as const;

export type FortranExecutionAssetName = (typeof FORTRAN_EXECUTION_ASSET_NAMES)[number];
export type FortranExecutionAssetReceipt = Readonly<
	Required<Pick<RuntimeAssetIntegrityEntry, 'bytes' | 'sha256'>>
>;
export type FortranExecutionAssetReceipts = Readonly<
	Record<FortranExecutionAssetName, FortranExecutionAssetReceipt>
>;

export function snapshotFortranExecutionAssetReceipts(
	value: FortranExecutionAssetReceipts | undefined
): FortranExecutionAssetReceipts {
	const receivedAssets = Object.keys(value || {}).sort();
	const expectedAssets = [...FORTRAN_EXECUTION_ASSET_NAMES].sort();
	if (
		receivedAssets.length !== expectedAssets.length ||
		receivedAssets.some((asset, index) => asset !== expectedAssets[index])
	) {
		throw new TypeError('Fortran execution requires exactly three asset receipts');
	}

	const receipts = Object.fromEntries(
		FORTRAN_EXECUTION_ASSET_NAMES.map((asset) => {
			const receipt = value?.[asset] as RuntimeAssetIntegrityEntry | undefined;
			if (
				!receipt ||
				!Number.isSafeInteger(receipt.bytes) ||
				(receipt.bytes as number) <= 0 ||
				typeof receipt.sha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(receipt.sha256)
			) {
				throw new TypeError(`Fortran execution asset receipt is invalid for ${asset}`);
			}
			return [
				asset,
				Object.freeze({
					bytes: receipt.bytes as number,
					sha256: receipt.sha256
				})
			] as const;
		})
	) as Record<FortranExecutionAssetName, FortranExecutionAssetReceipt>;

	return Object.freeze(receipts);
}
