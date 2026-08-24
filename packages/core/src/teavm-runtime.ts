import {
	TEAVM_RUNTIME_ASSET_RECEIPTS,
	TEAVM_RUNTIME_ASSET_VERSION
} from './teavm-runtime.generated.js';

export {
	TEAVM_RUNTIME_ASSET_RECEIPTS,
	TEAVM_RUNTIME_ASSET_VERSION
} from './teavm-runtime.generated.js';

export const TEAVM_RUNTIME_ASSET_NAMES = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

export type TeaVmRuntimeAssetName = (typeof TEAVM_RUNTIME_ASSET_NAMES)[number];

export interface TeaVmRuntimeAssetReceipt {
	bytes: number;
	sha256: string;
}

export type TeaVmRuntimeAssetReceipts = Readonly<
	Record<TeaVmRuntimeAssetName, Readonly<TeaVmRuntimeAssetReceipt>>
>;

const snapshotTeaVmRuntimeAssetReceipt = (
	asset: TeaVmRuntimeAssetName,
	value: unknown
): Readonly<TeaVmRuntimeAssetReceipt> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`TeaVM runtime receipt is invalid for ${asset}`);
	}
	const receipt = value as Partial<TeaVmRuntimeAssetReceipt>;
	const bytes = receipt.bytes;
	const sha256 = receipt.sha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256)
	) {
		throw new TypeError(`TeaVM runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
};

export function snapshotTeaVmRuntimeAssetReceipts(
	value: unknown = TEAVM_RUNTIME_ASSET_RECEIPTS
): TeaVmRuntimeAssetReceipts {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('TeaVM runtime integrity must describe exactly four assets');
	}
	const receivedNames = Object.keys(value).sort();
	const expectedNames = [...TEAVM_RUNTIME_ASSET_NAMES].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('TeaVM runtime integrity must describe exactly four assets');
	}
	const receipts = value as Record<TeaVmRuntimeAssetName, unknown>;
	return Object.freeze(
		Object.fromEntries(
			TEAVM_RUNTIME_ASSET_NAMES.map((asset) => [
				asset,
				snapshotTeaVmRuntimeAssetReceipt(asset, receipts[asset])
			])
		) as unknown as TeaVmRuntimeAssetReceipts
	);
}
