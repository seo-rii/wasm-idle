const integrityEntry = (
	bytes: number,
	sha256: string,
	uncompressedBytes = bytes,
	uncompressedSha256 = sha256
) => Object.freeze({ bytes, sha256, uncompressedBytes, uncompressedSha256 });

export const BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES = Object.freeze({
	c: Object.freeze({ asset: 'bin/c-sysroot.tar.gz' }),
	cppAddon: Object.freeze({ asset: 'bin/cpp-addon.tar.gz' })
});

export const BUNDLED_CLANG_ASSET_INTEGRITY = Object.freeze({
	'runtime-manifest.v1.json': integrityEntry(
		967,
		'0b854bc6b41924420cfcc840509ecbe03af3c63ca3edd4940897917e32c8d8ad'
	),
	'libc-printscan-long-double.a.gz': integrityEntry(
		52_723,
		'b3f11e17e40fb13371a97244fdde00d5bd951ad8e20dfdf88a069167d6be628b',
		111_062,
		'33e04007d3547095068391b42189d1ac5398dd04e9da3118dfa644ffea7f4148'
	),
	'bin/memfs.wasm.gz': integrityEntry(
		16_111,
		'a3e43451bc15ae69a7f113009e2ee82ab4db711625c1782cd45d0d3c4d38175a',
		38_071,
		'5b741e03dd3502bcfd80e4e5055232b5d633604e1461752efed0189f93407dc3'
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
		6_741_773,
		'8f31e0be44b45bef4b22e41b3e8381ccbd5410d4b328bad76b12cc8765d6cbb5',
		35_328_000,
		'91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402'
	),
	'bin/c-sysroot.tar.gz': integrityEntry(
		1_964_664,
		'4a22b52adb6d4c02bfb666d89262de49475ba983b04294a4b7b91bed2d33824f',
		11_944_960,
		'83a1cf62bde6757ac9174ac1d3b9d0132e1c63b9d7ac96e3b45d2ea5ffac14cd'
	),
	'bin/cpp-addon.tar.gz': integrityEntry(
		4_776_509,
		'6e243c219561b1f5aad64db4a9ff8bbeb85a97b5e3b5df3ed71d8340d35a8cd7',
		23_382_528,
		'feaf2aa538623ec8c543ccb49e9a833d2a1aa6dee7a9ad502c277deba24ef642'
	),
	'language-sysroots.v1.json': integrityEntry(
		423_904,
		'e6b2b196dc73ba9f5738eee8ffd628bf3767cd4959bbbb50167c10c5574dcd32'
	)
});
