export const WASM_NIM_RUNTIME_PROFILE = {
	profileId: 'nim-2.2.4-benagastov-ca3471ae',
	artifactRevision: 'ca3471ae124b40b51268da6e202753dfa061731c',
	nimRevision: 'f7145dd26efeeeb6eeae6fff649db244d81b212d',
	llvmRevision: '8e78cdb9caa80f75ed86d6632cb4e9310b22748c',
	memfsRevision: '0399d5a9682b3cef71c653373e38890c63c4c365',
	emscriptenRevision: 'unrecorded',
	manifestFingerprint: 'ee0d08a6d723d4a1afe2ce909bfed2f4d01eb71ddd330898c85c543218b6d2cf',
	manifestReceipt: {
		bytes: 7002,
		sha256: 'b9d11fcc43eab9764b5864c37952e932d2d08e33c33c18278ef4f312ba6c0089'
	},
	nimJavaScriptReceipt: {
		bytes: 1873825,
		sha256: '3b2ba2c1975bc8663ad21e2bd38f4c32b0ae109b3464312163dcc9c5e246ceec',
		uncompressedBytes: 6566418,
		uncompressedSha256: '170a78937e21ac0ec47e7d3f0eccefc261178f336ba92ab43acdb2f73ffd1301'
	},
	nimWasmReceipt: {
		bytes: 1558514,
		sha256: '48f519c32c4f202c1685c0509ad593612e289845549e824fdf95823f36f18f67',
		uncompressedBytes: 4812366,
		uncompressedSha256: '40e8c62fb96ee786fcd91f0ee2306241adeaf38c148bc8ec9788e0cc5cb26567'
	},
	nimbaseReceipt: {
		bytes: 20734,
		sha256: '28491d05916eab446de054370808030b33b63fd5623dcd454212adec27ee934d'
	},
	clangJavaScriptReceipt: {
		bytes: 19511,
		sha256: '06cd96ca1f66204a61133b2cabb0dd97132ddf65931f7fc1586fede9ee01754a'
	},
	clangWasmReceipt: {
		bytes: 10620308,
		sha256: '4b454f6b421ae8d28d14d69c1957aaf8516049c02d1f93f29193af84502c8778',
		uncompressedBytes: 31214472,
		uncompressedSha256: '2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d'
	},
	lldWasmReceipt: {
		bytes: 6769787,
		sha256: 'e1da2a0166cf6fe4ed8b18fb46de565d07dd7f252176ecf1948bbca3eef83340',
		uncompressedBytes: 19490094,
		uncompressedSha256: '36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48'
	},
	memfsWasmReceipt: {
		bytes: 18974,
		sha256: 'd86f141eacd58a93511fbfb7c4e81d498eb7106a8a57df1bea7d33df3ce1f403',
		uncompressedBytes: 345442,
		uncompressedSha256: '2c72ee42bd9430029dda8c6bafc9f37143f6fe88d5f1ea950a70259ab748bcfe'
	},
	sysrootReceipt: {
		bytes: 1829599,
		sha256: '9ba7e60b92b824c45f9b3a983dfa2f4d4feed627f276c6369d7518c15f133cf4',
		uncompressedBytes: 9297920,
		uncompressedSha256: '2435a7b549af30c2be7ec249c405bc2e911ab0c6003012f0909ec3c131bff867'
	}
} as const;
export const WASM_NIM_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_NIM_RUNTIME_PROFILE,
	workerReceipt: {
		bytes: 42466,
		sha256: 'cac66760f7ce01874be93b58949f5e0ebdd185531920c56307f21bafa7966670'
	}
});
export const WASM_NIM_ASSET_VERSION = WASM_NIM_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_NIM_RUNNER_RECEIPT = WASM_NIM_RUNTIME_BUNDLE.workerReceipt;
