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
		15_721_977,
		'b1174438d9a67b7ff11e623541b9a0572c024a9e798084b9b021dd9da2da0874',
		44_159_206,
		'60747a8272f337195c961fb7b7140f0789360267845016f1abb026f056aad083'
	),
	'bin/lld.wasm.gz': integrityEntry(
		7_837_837,
		'f842a9b5df3c6d326f0260bfd313c11c2e22bc8b8ae0387deede9a4af55779cd',
		20_795_796,
		'14f08c475b24ef45313cab7a086693525955c2c000b833faaaf48ad35b2521f8'
	),
	'bin/sysroot.tar.gz': integrityEntry(
		5_059_892,
		'68437624a81c465b93895615e7afd3f235ff256de17dc1927b124e783614e3e4',
		19_312_640,
		'963478e663d6ee2a3ae418ce7427f4535fb59831bb933f95938ccb2253cbb388'
	)
});
