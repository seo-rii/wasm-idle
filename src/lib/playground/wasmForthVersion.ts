export const WASM_FORTH_RUNTIME_PROFILE = {
	profileId: 'waforth-0.20.1',
	implementationVersion: '0.20.1',
	manifestFingerprint: '86da4fe96b8e3b6f7b0f6b01660b08cc12ae88d8f8418cc01a33a353c4d6cbf4',
	manifestReceipt: {
		bytes: 364,
		sha256: '1b8a12f15b6c2056b249c9b7680823ebaf7df4e86444e1efd5c0c70072c88c3c'
	},
	runtimeReceipt: {
		bytes: 33434,
		sha256: '254a973285f5c63b2be52db4a74090029075d8fe2cc52909d40e4c5f6d28eeb0'
	}
} as const;
export const WASM_FORTH_ASSET_VERSION =
	WASM_FORTH_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_FORTH_RUNNER_RECEIPT = {
	bytes: 10867,
	sha256: '781144fbc7590cd6820df60615d8a4f5c287fad68a66617ee695ee77cd51f4f9'
} as const;
