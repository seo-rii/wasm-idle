const integrityEntry = (bytes: number, sha256: string) => Object.freeze({ bytes, sha256 });

export const BUNDLED_CLANG_ASSET_INTEGRITY = Object.freeze({
	'runtime-manifest.v1.json': integrityEntry(
		876,
		'1420808d0391ff2d8a2fdf2a9f6bbce8f728e06b1ed1651029ed80b226101444'
	),
	'bin/memfs.wasm.gz': integrityEntry(
		345_442,
		'2c72ee42bd9430029dda8c6bafc9f37143f6fe88d5f1ea950a70259ab748bcfe'
	),
	'bin/clang.wasm.gz': integrityEntry(
		44_159_206,
		'60747a8272f337195c961fb7b7140f0789360267845016f1abb026f056aad083'
	),
	'bin/lld.wasm.gz': integrityEntry(
		20_795_796,
		'14f08c475b24ef45313cab7a086693525955c2c000b833faaaf48ad35b2521f8'
	),
	'bin/sysroot.tar.gz': integrityEntry(
		19_312_640,
		'963478e663d6ee2a3ae418ce7427f4535fb59831bb933f95938ccb2253cbb388'
	)
});
