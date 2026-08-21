export const WASM_JANET_RUNTIME_PROFILE = {
	profileId: 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c',
	artifactRevision: 'd647850cd6448b457f778d01c304358aefa5244b',
	janetVersion: '1.41.3-dev',
	emscriptenVersion: '3.1.8',
	manifestFingerprint: 'a7d89c155be6d2acc930f2d4fc535ce4a67857e3bd32bb42cb005aafcc6c014f',
	manifestReceipt: {
		bytes: 2705,
		sha256: 'e116626fbbee3c5c60a4f9126de2e6e076c1cc0231f589387dd8bf0ad887cf92'
	},
	javascriptReceipt: {
		bytes: 69382,
		sha256: '4c8a59b012fee0e785cbcdfa57cddb2a04e2f963d91897a1bbd8d7f45b240555'
	},
	wasmReceipt: {
		bytes: 316923,
		sha256: '8f9b1f38c6a2aabb937c0dae11c0ab2bb68704f95d519f16ef8413682c113a1d',
		uncompressedBytes: 829432,
		uncompressedSha256: '8f3dc1632ba071f0f5e0d9d79e664fd018638cc32edf8d91bd02dcdd058dcc71'
	}
} as const;
export const WASM_JANET_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_JANET_RUNTIME_PROFILE,
	workerReceipt: {
		bytes: 21453,
		sha256: 'cf081654226f8e2dcc2ac778bf95cc72bf9c27bd641bec0a10ab15e07103726d'
	}
});
export const WASM_JANET_ASSET_VERSION = WASM_JANET_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_JANET_RUNNER_RECEIPT = WASM_JANET_RUNTIME_BUNDLE.workerReceipt;
