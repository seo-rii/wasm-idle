export const BUNDLED_PROLOG_RUNTIME_PROFILE = {
	profileId: 'swipl-wasm-8.2.5-swipl-10.1.19',
	packageRevision: 'a633668fc459e0fd4ec5f993443d07b0c933aa2a',
	swiplRevision: '724df2b54cf1dda6fb3327d9167db2ae750c460e',
	manifestFingerprint: 'f1cfa59be0be8ff815e056b53f6c59bd270dbdabc62f09bcd42e40122185d95a',
	manifestReceipt: {
		bytes: 2576,
		sha256: 'aae0a74de3c773a5b7da1cbd14e1e55e95f3f8a52cb2435c9fcad4e6684279f7'
	},
	javascriptReceipt: {
		bytes: 191369,
		sha256: 'b71b671c5396c0d3ab4e04ee0376bfb47319cdfcf4b00b202ba3fdb671de6e7d'
	},
	wasmReceipt: {
		bytes: 835909,
		sha256: 'fb3d7bb440083b48d383a178dcab0325f4a61c9e470d42bf12e0431f39f0f54e',
		uncompressedBytes: 2311472,
		uncompressedSha256: '80674a1223edc60629460fca12e322f9c27fdeb20ef72fc0f755edea1906a3b2'
	},
	dataReceipt: {
		bytes: 1195673,
		sha256: '432ea3836adabf3fd034494b74c8e5c7748108a9977cf3b5efa2310c4eea373d',
		uncompressedBytes: 1662393,
		uncompressedSha256: 'a980ac3f2ecb5a5d670b8470ab77c780768c0c6421ed51ef063f606d736c55a4'
	}
} as const;
export const BUNDLED_PROLOG_MANIFEST_FINGERPRINT =
	BUNDLED_PROLOG_RUNTIME_PROFILE.manifestFingerprint;
export const BUNDLED_PROLOG_RUNNER_RECEIPT = {
	bytes: 25728,
	sha256: '3f30582ec19cf430e6d2f7e9d544cc0f766accc7361f0a3fbb427bcdb7d0298b'
} as const;
