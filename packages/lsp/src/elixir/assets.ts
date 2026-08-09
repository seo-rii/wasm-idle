import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export const ELIXIR_RUNTIME_ASSETS = ['bundle.avm', 'AtomVM.mjs', 'AtomVM.wasm'] as const;

export type ElixirRuntimeAssetName = (typeof ELIXIR_RUNTIME_ASSETS)[number];
export type ElixirRuntimeAssetReceipt = Readonly<
	Required<
		Pick<
			RuntimeAssetIntegrityEntry,
			'bytes' | 'sha256' | 'uncompressedBytes' | 'uncompressedSha256'
		>
	>
>;
export type ElixirRuntimeAssetReceipts = Readonly<
	Record<ElixirRuntimeAssetName, ElixirRuntimeAssetReceipt>
>;

export function snapshotElixirRuntimeAssetReceipts(
	value: ElixirRuntimeAssetReceipts | undefined
): ElixirRuntimeAssetReceipts {
	const receivedAssets = Object.keys(value || {}).sort();
	const expectedAssets = [...ELIXIR_RUNTIME_ASSETS].sort();
	if (
		receivedAssets.length !== expectedAssets.length ||
		receivedAssets.some((asset, index) => asset !== expectedAssets[index])
	) {
		throw new TypeError('Elixir language server requires exactly three asset receipts');
	}
	const receipts = Object.fromEntries(
		ELIXIR_RUNTIME_ASSETS.map((asset) => {
			const receipt = value?.[asset] as RuntimeAssetIntegrityEntry | undefined;
			if (
				!receipt ||
				!Number.isSafeInteger(receipt.bytes) ||
				(receipt.bytes as number) <= 0 ||
				!/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
				!Number.isSafeInteger(receipt.uncompressedBytes) ||
				(receipt.uncompressedBytes as number) <= 0 ||
				typeof receipt.uncompressedSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(receipt.uncompressedSha256)
			) {
				throw new TypeError(`Elixir language server asset receipt is invalid for ${asset}`);
			}
			return [
				asset,
				Object.freeze({
					bytes: receipt.bytes as number,
					sha256: receipt.sha256,
					uncompressedBytes: receipt.uncompressedBytes as number,
					uncompressedSha256: receipt.uncompressedSha256
				})
			] as const;
		})
	) as Record<ElixirRuntimeAssetName, ElixirRuntimeAssetReceipt>;
	return Object.freeze(receipts);
}
