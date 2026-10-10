export const WASM_BASH_RUNTIME_PROFILE = Object.freeze({
	profileId: 'bash-1.0.25-wasmer-sdk-0.10.0-fc809648',
	bashPackageVersion: '1.0.25',
	bashSourceRevision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
	wasmerSdkVersion: '0.10.0',
	wasmerSdkPackageIntegrity:
		'sha512-YQ+s5tGag6P/I8kp9BTH+XhjoS9UFvWiZJvnWEEovClHffhYToKhprWr4UJG7wLP7c/2HQpGkF7ZrjoUvKjdmA==',
	manifestFingerprint: '7feb4bf192c1c38e3e129528a5c038405012a4f09bc170719dfb6174cbb63f61',
	manifestReceipt: Object.freeze({
		bytes: 4800,
		sha256: '2e1a5b7e6d8c85ff605252a64ea2a9fba2d0dd2d42be1d0247732fcd57c9f8cd'
	}),
	sdkJavaScriptReceipt: Object.freeze({
		bytes: 48694,
		sha256: 'd5e0424d9de8173c0c7bc6a6b704aecde620d3f424050e0e6a079d863a44d58b'
	}),
	wasmerWasmReceipt: Object.freeze({
		bytes: 2383903,
		sha256: 'f592295111f5140a0afd5c5905e31e3ef1c9126df182d1249c86e7d6d4d260da',
		uncompressedBytes: 6598804,
		uncompressedSha256: '49a6646209f5ab5e7c737eac33407d87d9a9959ac83e5ecaaab9261b2323589e'
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
