export const WASM_CLOJURESCRIPT_RUNTIME_PROFILE = {
	profileId: 'clojurescript-1.12.134-cljs-js-wasm-idle-e8083f4f',
	sourceRevision: 'r1.12.134',
	integrationRevision: 'e8083f4fd57d6d9beebdb38709ba8cc7fa07a2c8',
	manifestFingerprint: '11cf68d6d0987a15fe908464b160396108d4d37e7bb1d8fe02d05222eec7ed7e',
	manifestReceipt: {
		bytes: 1664,
		sha256: 'b3fdb915bf79db5c970fafc9e34ad1ba7f958acebf251d28f307e82d7e72811f'
	},
	compilerReceipt: {
		bytes: 614160,
		sha256: '76bb9862946f341609a28fb14eb079432dfc239350c2515efc7fccc6d3051676',
		uncompressedBytes: 6588008,
		uncompressedSha256: 'ec1d3f02f8ee2ff7d8007acb565ec454c8a0625bd305260db3e974bbf5d3b162'
	}
} as const;
export const WASM_CLOJURESCRIPT_ASSET_VERSION =
	WASM_CLOJURESCRIPT_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_CLOJURESCRIPT_RUNNER_RECEIPT = {
	bytes: 17270,
	sha256: 'c535913a7ce1972ceb2c620d1b1bba746e9fda62562ef2ac9032e18ad70940d5'
} as const;
