export const WASM_PROLOG_RUNTIME_PROFILE = {
	profileId: 'swipl-wasm-8.2.1-swipl-10.1.15',
	packageRevision: '85167290994ede92eab1aa5e399007c031e6cb82',
	swiplRevision: '5db27168f89b15186745ea401fbb99a017413788',
	manifestFingerprint: 'c97f050d36f55558811d27021580338dd01e37016c70e1ef2daaaad0a29618b3',
	manifestReceipt: {
		bytes: 2576,
		sha256: 'b67d6f6ff9115bd886d2992b0ad97e7d726aa66cc2a3e288ce7f99a3249d6d47'
	},
	javascriptReceipt: {
		bytes: 193421,
		sha256: '635da02ac0eb18e51303e4a0398b220d17cabfc0e4b7a2acbc7af9e949e4a9c7'
	},
	wasmReceipt: {
		bytes: 820495,
		sha256: 'da8461e22b4513c5020d7eef7f8e62b2086003125381d18fed08f3656eecd793',
		uncompressedBytes: 2275324,
		uncompressedSha256: 'c8831c0ac6a021b6bc67fa1b86e8826d1ea92a1a81b932cfb88fea235361c355'
	},
	dataReceipt: {
		bytes: 1192600,
		sha256: 'ea735ff89940eaed405a4a9b2be8606141d821016f3fc7671983b2203e88e86f',
		uncompressedBytes: 1659074,
		uncompressedSha256: '91e9d9c1d184f1a291c870e96bf6a1bc502ce8787946c966526a663a725ba932'
	}
} as const;
export const WASM_PROLOG_ASSET_VERSION = WASM_PROLOG_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_PROLOG_RUNNER_RECEIPT = {
	bytes: 25342,
	sha256: 'b72014e85132b6ee6bfe3ec0e59ae6ba791f4c137caa1cb744d0a37bab9c60c4'
} as const;
