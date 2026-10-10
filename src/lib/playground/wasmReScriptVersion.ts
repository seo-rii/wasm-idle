export const WASM_RESCRIPT_RUNTIME_PROFILE = {
	profileId: 'rescript-12.3.1-playground-commonjs',
	sourceRevision: 'v12.3.1',
	manifestFingerprint: 'c5cfee09555006071de09a4793ff080f9c49ef901fdb66d76ca16470dab7efc5',
	manifestReceipt: {
		bytes: 1406,
		sha256: 'dddbbbdf2da0c91280267004875023ff9949c8815c6edff7057444cfcff25e61'
	},
	compilerReceipt: {
		bytes: 1245489,
		sha256: '9d6988eff528fb577c10aa76f720e59c8737dc91c5a4a2f17496930b848ff51d',
		uncompressedBytes: 6496768,
		uncompressedSha256: '17b16598b473bcd56367f29fb76d300ffe0073c814af68710d3b46964b200202'
	}
} as const;
export const WASM_RESCRIPT_ASSET_VERSION = WASM_RESCRIPT_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_RESCRIPT_RUNNER_RECEIPT = {
	bytes: 22497,
	sha256: '9ed95127f988333a79c7591771c40f2d0fde07e5cb79da2543082582ffdd276d'
} as const;
