export const WASM_TCL_RUNTIME_PROFILE = {
	profileId: 'wacl-pages-045aa904-tcl-8.6.6',
	artifactRevision: '045aa904c2073eeded1be803cf5416901f6ce8ee',
	waclRevision: '9daacabb0102a9986f33263261350edfeebdd83b',
	tclRevision: '27696b490b9b339a869a8f6fe3113d05ebcbf565',
	requireJsRevision: 'f2335026867afd80c394247bfe5278d2bd8f32ee',
	emscriptenRevision: 'f1222cc8c315e47ba3541a42ab391bd3b1d9be14',
	manifestFingerprint: '4687ad97c5bb5e96d4354a24e9faffeb9dc9eb1ee7e8c9b0c0ea289c5d9a2baa',
	manifestReceipt: {
		bytes: 4870,
		sha256: 'df616e22d937820997f4263ad341082eb86e05f3891729fabd3e0892f7c5e1db'
	},
	requireJsReceipt: {
		bytes: 17831,
		sha256: '0ca49b7de8f5e006ba5eb976937a3f9fb96b05ebfbb11d685c0b21ead94aacaf'
	},
	customDataReceipt: {
		bytes: 976,
		sha256: '46874b6dfe04b9c693815fe904a52e3583260323857dee46ac7373c484e3b2f8'
	},
	libraryDataReceipt: {
		bytes: 593060,
		sha256: '909811fc942d947e1d5efb0ee425447dce9f267bfd6207c4d5af91dedca1ae8a',
		uncompressedBytes: 2307994,
		uncompressedSha256: '3a8e166c2197920e36c874e2fefae4ca6e0c4a920a443b8e1d2282c344d485f0'
	},
	glueReceipt: {
		bytes: 240157,
		sha256: 'c3377f974386190f1e465ffd66b528b0e33ea7a66bcde3b8c1695d4d720276af'
	},
	wasmReceipt: {
		bytes: 640669,
		sha256: '35a913cb5400f1eaa350de61bf9b6276fb6114d2a6ac7d16e5ee58d5c8b83ac4',
		uncompressedBytes: 1884110,
		uncompressedSha256: '9f55db5a617fd154882bb93bbf333dad5af1d0d697e8076ed05896fb91b22e99'
	}
} as const;
export const WASM_TCL_ASSET_VERSION = WASM_TCL_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_TCL_RUNNER_RECEIPT = {
	bytes: 31494,
	sha256: '2ffb2e10396ebaf68ba67415b50c6f0e893d72c58152c6166e82bc398af4cbf7'
} as const;
export const WASM_TCL_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_TCL_RUNTIME_PROFILE,
	workerReceipt: WASM_TCL_RUNNER_RECEIPT
});
