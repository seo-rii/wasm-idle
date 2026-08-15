export const WASM_J_RUNTIME_PROFILE = {
	profileId: 'jsoftware-j-playground-wasm-idle-d647850c',
	sourceRevision: 'legacy-import-unrecorded;wasm-idle:d647850cd6448b457f778d01c304358aefa5244b',
	manifestFingerprint: 'ffa037148a6785c5ca7295ca34f00ac28f5057d7354be391d588868c218bab07',
	manifestReceipt: {
		bytes: 1275,
		sha256: '828fbbef8e90aaf6445b0badd121f926f50c42de6e06f43e7332d149a06e3f10'
	},
	moduleReceipt: {
		bytes: 170649,
		sha256: 'a4abe92ddf874d06d01d6873e151b641837b79d4075529fa17541b576eeb92e3'
	},
	wasmReceipt: {
		bytes: 1418554,
		sha256: 'e49723087dd8c9b40e24a769e82269552ef16a39fcb4d2c0840815a695ee57e7',
		uncompressedBytes: 4832581,
		uncompressedSha256: '22549b50a69575ce09326f08fbf35396edfe4eedc583c8dd273d06ebbe920358'
	}
} as const;
export const WASM_J_ASSET_VERSION = WASM_J_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_J_RUNNER_RECEIPT = {
	bytes: 14059,
	sha256: '98ccb3f1328b5b4029866a73b15c71dbdd1d7575dbaff3914aac5100f391118a'
} as const;
