export const WASM_BASH_RUNTIME_PROFILE = Object.freeze({
	profileId: 'bash-1.0.25-wasmer-sdk-0.9.0-fc809648',
	bashPackageVersion: '1.0.25',
	bashSourceRevision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
	wasmerSdkVersion: '0.9.0',
	wasmerSdkPackageIntegrity:
		'sha512-k/CY19NfeLCjA9ZpX69JAoZKiuMT3hKjDFJYWdRGkCdfig9NtC9Op7Gpg2LeezuuQKd4WaSSq8bpSMdHw1BMgg==',
	manifestFingerprint: '71a9b5962e7ec1517464c03e4f6ef3aff66dd97adb6807448bc15677e85d069b',
	manifestReceipt: Object.freeze({
		bytes: 4797,
		sha256: 'f356433fbddf7331f187b87fbc7588a12cfe591c9c9eeb69b76bc92b504f10d9'
	}),
	sdkJavaScriptReceipt: Object.freeze({
		bytes: 49233,
		sha256: 'c7e42dbbdf7d5ddbf2692bae24d732f14f09a879f8db1bc4cf23bef086a86b6a'
	}),
	wasmerWasmReceipt: Object.freeze({
		bytes: 2133033,
		sha256: '9fcf1430c0ba5233a2434ccf88248ae45a465f8f749c6efb13f9be125e039e4e',
		uncompressedBytes: 5701868,
		uncompressedSha256: '10b42451b1be2cd25543ee14e1f87adf6019f64aa3e6cb74c296aecd15787509'
	}),
	webcReceipt: Object.freeze({
		bytes: 648807,
		sha256: '6f5be27b3c2e685e3ee823a6ff7380c5143e9c7e353975e39e4dbf297a3ea577',
		uncompressedBytes: 1808682,
		uncompressedSha256: '73e34672254faf20f54fa0e7f8ffa8a6117017e8779aaa75c80682c00e6d8468'
	})
});

export const WASM_BASH_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_BASH_RUNTIME_PROFILE
});

export const WASM_BASH_ASSET_VERSION = WASM_BASH_RUNTIME_PROFILE.manifestFingerprint;

export const WASM_BASH_WEBC_RECEIPT = Object.freeze({
	bytes: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedBytes,
	sha256: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedSha256
});
