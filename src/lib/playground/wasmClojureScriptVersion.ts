export const WASM_CLOJURESCRIPT_RUNTIME_PROFILE = {
	profileId: 'clojurescript-1.12.134-cljs-js-wasm-idle-e8083f4f',
	sourceRevision: 'r1.12.134',
	integrationRevision: 'e8083f4fd57d6d9beebdb38709ba8cc7fa07a2c8',
	manifestFingerprint: '177dfd8dc4e67a33d2096143b3d27af96703bef002006ac9e42bd4a2609e9492',
	manifestReceipt: {
		bytes: 1664,
		sha256: '2adc22e9461d9af25862c0142e9f6cd009ec4caad960aed9b654381e6d242e1d'
	},
	compilerReceipt: {
		bytes: 614204,
		sha256: 'ea4ac9faff58cf89de1187a700b9cc30e267072ecba60064aedc11eea2b96245',
		uncompressedBytes: 6588133,
		uncompressedSha256: '8b055dd50f8c8736db9680924209782ba5027718ab84b6a0a3eb40a913d05b17'
	}
} as const;
export const WASM_CLOJURESCRIPT_ASSET_VERSION =
	WASM_CLOJURESCRIPT_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_CLOJURESCRIPT_RUNNER_RECEIPT = {
	bytes: 17270,
	sha256: 'c535913a7ce1972ceb2c620d1b1bba746e9fda62562ef2ac9032e18ad70940d5'
} as const;
