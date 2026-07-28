const integrityEntry = (bytes: number, sha256: string) => Object.freeze({ bytes, sha256 });

export const BUNDLED_CLANG_ASSET_INTEGRITY = Object.freeze({
	'runtime-manifest.v1.json': integrityEntry(
		876,
		'1420808d0391ff2d8a2fdf2a9f6bbce8f728e06b1ed1651029ed80b226101444'
	),
	'bin/memfs.wasm.gz': integrityEntry(
		18_974,
		'd86f141eacd58a93511fbfb7c4e81d498eb7106a8a57df1bea7d33df3ce1f403'
	),
	'bin/clang.wasm.gz': integrityEntry(
		15_721_977,
		'b1174438d9a67b7ff11e623541b9a0572c024a9e798084b9b021dd9da2da0874'
	),
	'bin/lld.wasm.gz': integrityEntry(
		7_837_837,
		'f842a9b5df3c6d326f0260bfd313c11c2e22bc8b8ae0387deede9a4af55779cd'
	),
	'bin/sysroot.tar.gz': integrityEntry(
		5_059_892,
		'68437624a81c465b93895615e7afd3f235ff256de17dc1927b124e783614e3e4'
	)
});
