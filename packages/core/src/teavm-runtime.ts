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

export const TEAVM_RUNTIME_ASSET_VERSION =
	'2ccdddaf88a24761835c97047dccda500fdfb450e8ab1fcacd479e5a394df546';

export const TEAVM_RUNTIME_ASSET_RECEIPTS = Object.freeze({
	'compiler.wasm-runtime.js': Object.freeze({
		bytes: 13_936,
		sha256: 'bd103f277be99fd2f3ffc0248b3558e6c2c85a44902bfeef042c6bedcf0b2c63'
	}),
	'compiler.wasm': Object.freeze({
		bytes: 4_299_273,
		sha256: '9eb047426613c3ed3006838daae49e29929ad0d560ec6b1f8b50e15e2c3865d6'
	}),
	'compile-classlib-teavm.bin': Object.freeze({
		bytes: 200_621,
		sha256: '71746dc82ddad5ad8be829f461c235a747bdaf121d1b7abd16dbbbbe6a17f53d'
	}),
	'runtime-classlib-teavm.bin': Object.freeze({
		bytes: 2_394_175,
		sha256: 'f0c9c8c0426e310d08751e57cc88fdfd63ea2f428e4d6cb1b7e59a3dc20844ad'
	})
}) satisfies TeaVmRuntimeAssetReceipts;

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
