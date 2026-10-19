const integrityEntry = (
	bytes: number,
	sha256: string,
	uncompressedBytes = bytes,
	uncompressedSha256 = sha256
) => Object.freeze({ bytes, sha256, uncompressedBytes, uncompressedSha256 });

export const BUNDLED_CLANGD_ASSET_INTEGRITY = Object.freeze({
	'clangd.js': integrityEntry(
		97_002,
		'92dce989f2623a6e8930369dd205301c2815d70cf81312c64de1c47a16302b27'
	),
	'clangd.wasm.gz': integrityEntry(
		16_722_963,
		'17a447dff61020664c23dd8c8516e2cd6bdb93cf244a4e6ee19078b0948fe566',
		78_993_689,
		'f712eb98cba42f560121a09b655567a5fbc900e6568a29a9c6949d81a17fec5c'
	)
});
