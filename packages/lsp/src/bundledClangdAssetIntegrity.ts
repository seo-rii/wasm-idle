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
		16_723_115,
		'284e7117da923ca99ea9d64e4d9a80a739cdce4cc1c81dd099b040ab0a8a926f',
		78_993_623,
		'f2bef5c4b4aa8691f0b996286231c5778a17119c41537ae4108c7ff2795f7fc3'
	)
});
