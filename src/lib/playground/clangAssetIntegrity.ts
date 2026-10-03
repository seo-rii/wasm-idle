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
		5_059_493,
		'c0ef46e903492383a3c7069bfd4aed0e764e8df988f92bb81eb96bea50bf2c00',
		19_312_640,
		'e122f1acec0642d62d8976101c542aaa5346460df6eae5a3f8efb594ff32f5ae'
	),
	'bin/c-sysroot.tar.gz': integrityEntry(
		1_216_797,
		'fb3e1cdacac3eceddcfe2e57cbbf78e593ec2a298f01acb61c06e4b9d24fbbee',
		3_736_064,
		'720c620e459025e918747768b9f5f1aef7b48c6df1b34c1a31fb2e5b1b7a213e'
	),
	'bin/cpp-addon.tar.gz': integrityEntry(
		3_840_608,
		'47e9946c5aaeb3b35a1d42d6a80eae8987c596f4f858b207e492c00d8680af9e',
		15_572_992,
		'7d61b724d377dc4e5670725055fb2884ebc8153d697e05093992004d5859310d'
	),
	'language-sysroots.v1.json': integrityEntry(
		175_348,
		'd69acbdb636009dc5b2243f13f1580264f64a34362f0af67c9cd661388b565d0'
	)
});
