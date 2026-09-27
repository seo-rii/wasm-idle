const integrityEntry = (
	bytes: number,
	sha256: string,
	uncompressedBytes = bytes,
	uncompressedSha256 = sha256
) => Object.freeze({ bytes, sha256, uncompressedBytes, uncompressedSha256 });

export const BUNDLED_CLANG_ASSET_INTEGRITY = Object.freeze({
	'runtime-manifest.v1.json': integrityEntry(
		876,
		'1420808d0391ff2d8a2fdf2a9f6bbce8f728e06b1ed1651029ed80b226101444'
	),
	'bin/memfs.wasm.gz': integrityEntry(
		18_974,
		'd86f141eacd58a93511fbfb7c4e81d498eb7106a8a57df1bea7d33df3ce1f403',
		345_442,
		'2c72ee42bd9430029dda8c6bafc9f37143f6fe88d5f1ea950a70259ab748bcfe'
	),
	'bin/clang.wasm.gz': integrityEntry(
		13_121_917,
		'8dc032057fbeb41e4a9986dfc54b2336c17532033dee172eb0095eba9c5fbe75',
		35_658_969,
		'd92ef06cdd3fea88acf384db15a6f2a344790c05bcba8e9f13f5b75b36ad4a99'
	),
	'bin/lld.wasm.gz': integrityEntry(
		6_417_339,
		'495813efde8f354c38483749cdface7a7d9e23c8411da45a6f5f80030159eb11',
		16_171_013,
		'34d39bc410c098e7e09933b61cc8e28699447af9a28abf4544d71b6e9cad1f9d'
	),
	'bin/sysroot.tar.gz': integrityEntry(
		5_059_493,
		'c0ef46e903492383a3c7069bfd4aed0e764e8df988f92bb81eb96bea50bf2c00',
		19_312_640,
		'e122f1acec0642d62d8976101c542aaa5346460df6eae5a3f8efb594ff32f5ae'
	)
});
