import {
	HASKELL_RUNTIME_GENERATED_ASSET_RECEIPTS,
	HASKELL_RUNTIME_GENERATED_ASSET_VERSION
} from './haskell-runtime.generated';

export const HASKELL_RUNTIME_ASSET_NAMES = ['dyld.mjs', 'rootfs.tar.zst', 'bsdtar.wasm'] as const;

export type HaskellRuntimeAssetName = (typeof HASKELL_RUNTIME_ASSET_NAMES)[number];

export interface HaskellRuntimeAssetReceipt {
	readonly bytes: number;
	readonly sha256: string;
}

export type HaskellRuntimeAssetReceipts = Readonly<
	Record<HaskellRuntimeAssetName, Readonly<HaskellRuntimeAssetReceipt>>
>;

export const HASKELL_RUNTIME_ASSET_VERSION = HASKELL_RUNTIME_GENERATED_ASSET_VERSION;

export const HASKELL_RUNTIME_ASSET_RECEIPTS =
	HASKELL_RUNTIME_GENERATED_ASSET_RECEIPTS satisfies HaskellRuntimeAssetReceipts;

const snapshotReceipt = (
	asset: HaskellRuntimeAssetName,
	value: unknown
): Readonly<HaskellRuntimeAssetReceipt> => {
	if (!value || typeof value !== 'object') {
		throw new TypeError(`Haskell runtime receipt is invalid for ${asset}`);
	}
	const receipt = value as Partial<HaskellRuntimeAssetReceipt>;
	const bytes = receipt.bytes;
	const sha256 = receipt.sha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256)
	) {
		throw new TypeError(`Haskell runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
};

export function snapshotHaskellRuntimeAssetReceipts(
	value: unknown = HASKELL_RUNTIME_ASSET_RECEIPTS
): HaskellRuntimeAssetReceipts {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Haskell runtime integrity must describe exactly three assets');
	}
	const receivedNames = Object.keys(value).sort();
	const expectedNames = [...HASKELL_RUNTIME_ASSET_NAMES].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('Haskell runtime integrity must describe exactly three assets');
	}
	const receipts = value as Record<HaskellRuntimeAssetName, unknown>;
	return Object.freeze({
		'dyld.mjs': snapshotReceipt('dyld.mjs', receipts['dyld.mjs']),
		'rootfs.tar.zst': snapshotReceipt('rootfs.tar.zst', receipts['rootfs.tar.zst']),
		'bsdtar.wasm': snapshotReceipt('bsdtar.wasm', receipts['bsdtar.wasm'])
	});
}
