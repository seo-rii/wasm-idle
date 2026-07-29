const integrityEntry = (
	bytes: number,
	sha256: string,
	uncompressedBytes = bytes,
	uncompressedSha256 = sha256
) => Object.freeze({ bytes, sha256, uncompressedBytes, uncompressedSha256 });

export const BUNDLED_CLANGD_ASSET_INTEGRITY = Object.freeze({
	'clangd.js': integrityEntry(
		142_904,
		'a7ff1c588eb5374783bbda84d949b92b8027c2381c786072448b96eba90c7027'
	),
	'clangd.wasm.gz': integrityEntry(
		24_921_957,
		'c6d45cb134ee41c0e9b37838c3375aedcf130a7feed902db22f59bc0d2c46b34',
		126_550_863,
		'0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019'
	)
});
