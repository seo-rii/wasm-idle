export const WASM_BQN_RUNTIME_PROFILE = {
	profileId: 'dzaima-cbqn-emscripten-3.1.8-wasm-idle-d647850c',
	sourceRevision: 'legacy-import-unrecorded;wasm-idle:d647850cd6448b457f778d01c304358aefa5244b',
	manifestFingerprint: '82cd4627902071d9f9adc2da18e9df647c9223ea6b19cf030a1cf68848c12fce',
	manifestReceipt: {
		bytes: 1577,
		sha256: '699364acfc57f52f9674dbc430a1f641d9d05e377d2e720644313872985116cc'
	},
	moduleReceipt: {
		bytes: 212190,
		sha256: '0a5474e6944cc3ce8a8b21874f82341dd1680d7bac056d619adfd49e98123570'
	},
	wasmReceipt: {
		bytes: 324306,
		sha256: 'e1789da62cd8a269d167bedf8eb0b6b3eef190f6b4f5e6cd5c7afaf28ecd81e9',
		uncompressedBytes: 1175370,
		uncompressedSha256: 'a57bd7e67537b0eb977f921dd75898878d4c51865df9c4e35d7a156f7db33632'
	}
} as const;
export const WASM_BQN_ASSET_VERSION = WASM_BQN_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_BQN_RUNNER_RECEIPT = {
	bytes: 14928,
	sha256: '4ac73f01a459a641e392abdd5cfe5e5407f75656e1e7f77fda3ec1fddc9fe660'
} as const;
