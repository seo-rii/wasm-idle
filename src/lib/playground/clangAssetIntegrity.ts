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
		13_124_999,
		'cc7b6b229af392f439a1ca89dbb8d5e016792264a0a6ee59608ff24e269be982',
		35_597_829,
		'fe7c40c2369d4a1b91d87cd2a38b1a5be11cd7f381373b7888be0b5f209e2d5b'
	),
	'bin/lld.wasm.gz': integrityEntry(
		6_421_841,
		'798ce825f3e3cf9a695b6a049f157ba28d38731a3dc5e699ccdf23d69d3a5c20',
		16_136_490,
		'77949fed32d5481979b8ebe6081009e3ec69c7219cb355e3f388a316746ea9b7'
	),
	'bin/sysroot.tar.gz': integrityEntry(
		6_780_412,
		'6188b500fa7af2dceadcbd6dcf2619b6935fa94c224c1c2078426666ebea1d50',
		35_594_240,
		'fb6d8a8786ec395009d44f62ff24a5bf09ff8672340b7dae9f48e28cf1569cba'
	),
	'bin/c-sysroot.tar.gz': integrityEntry(
		2_006_388,
		'da7a29250b2fe2d928fa8818069ff67e1dcb26c529bbf01f40bbeb251535ecaa',
		12_213_760,
		'517b32208f4e556b22eb5ac775411c39fb75239dfaf81f206e6052e168425b62'
	),
	'bin/cpp-addon.tar.gz': integrityEntry(
		4_776_509,
		'6e243c219561b1f5aad64db4a9ff8bbeb85a97b5e3b5df3ed71d8340d35a8cd7',
		23_382_528,
		'feaf2aa538623ec8c543ccb49e9a833d2a1aa6dee7a9ad502c277deba24ef642'
	),
	'language-sysroots.v1.json': integrityEntry(
		426_858,
		'08f6c2c87b4bebc9599193334e1d0ed322ebb38cbdd2bbb83d2b8c3a4cb61263'
	)
});
