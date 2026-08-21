export const WASM_JULIA_RUNTIME_PROFILE = {
	profileId: 'julia-1.3.0-dev.560-chriskoch-npm-1.0.4-22a55e0d',
	packageRevision: '22a55e0d10ad50f2999d059b325abe4d95cf17b3',
	importedByCommit: 'c9529ad7b7ecfaea8a55c0fe5693c4d07cd0ae26',
	juliaVersion: '1.3.0-DEV.560',
	emscriptenVersion: 'unrecorded',
	manifestFingerprint: 'e6cb5693f34efa56e8ec16dd34484deae1a870ad33ba38ecac4073a28f079d9a',
	manifestReceipt: {
		bytes: 4130,
		sha256: '72984da57e0474eb1922b138564d02558624442a3e169a0f302ee5c31073ef47'
	},
	javascriptReceipt: {
		bytes: 57115,
		sha256: 'fdb4b6d7417c2c02f0becd71ec24d01c11f920e97ec77ace2e3676d1667b9e65',
		uncompressedBytes: 278345,
		uncompressedSha256: '729bebdacd0243b760360c1b9c6c18735db3c85b9047d8cb2ed63d4801a4fb7f'
	},
	wasmReceipt: {
		bytes: 858693,
		sha256: '590d2e91f5360ab663b8a640c51007d3112064ad0c79e347eac85d87c010fddf',
		uncompressedBytes: 2573366,
		uncompressedSha256: '027467183dff7f2e91574da93dbd1ea82f6875be1636d786212bb3c1b3538d45'
	},
	dataReceipt: {
		bytes: 14260930,
		sha256: '6c35eea7607974239cb3350273311c9458b890aa7d5c57c879388395b042e6f8',
		uncompressedBytes: 42960896,
		uncompressedSha256: '8e9347b29cb8b4301cf40fdc4e1f4bdc51a7f06f3f12958fbd2730fba2ba38b1'
	}
} as const;
export const WASM_JULIA_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_JULIA_RUNTIME_PROFILE,
	workerReceipt: {
		bytes: 28124,
		sha256: '1e4980140a6f38b08c03fe0a7b57d4c3a5a289a94c4f96274d16a40a4adb58f0'
	}
});
export const WASM_JULIA_ASSET_VERSION = WASM_JULIA_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_JULIA_RUNNER_RECEIPT = WASM_JULIA_RUNTIME_BUNDLE.workerReceipt;
