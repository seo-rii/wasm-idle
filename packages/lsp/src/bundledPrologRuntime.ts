export const BUNDLED_PROLOG_RUNTIME_PROFILE = {
	profileId: 'swipl-wasm-8.0.1-swipl-10.1.9',
	packageRevision: '18fa003833dd4fb2531195063291687255038372',
	swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
	manifestFingerprint: '9d2744c41c9a2fb947cb56f9212c0165dd3635ac80f19473281169d1d2eb3a77',
	manifestReceipt: {
		bytes: 2571,
		sha256: '2ea6029f2e04ad28d4b17f09854ee4f73ddbf61fac02bfc0a9c6ac33bf47d580'
	},
	javascriptReceipt: {
		bytes: 192038,
		sha256: '2ac05e255ec3e2c76958398d9a2bfcb293fe4af81cca3f6e6316af89cb936cbd'
	},
	wasmReceipt: {
		bytes: 796593,
		sha256: 'e624f58bccb1e273ef307dd006fc85c3933ac2a5cdf16490c07c6078fc95351e',
		uncompressedBytes: 2195026,
		uncompressedSha256: 'e95f4514adf76f3bfd92e3733bd6797bb63fcd65de5e64d248e0b379c419f556'
	},
	dataReceipt: {
		bytes: 1178763,
		sha256: 'c7b391a19e67a70d232b4b7a3b2a1aca110a3527f8fea01d255b2619bfa905cf',
		uncompressedBytes: 1642608,
		uncompressedSha256: '55286bfd3ada8779cb843c60b05c97c8d8cb96087bf1ba2cebc4f90b95f7a1e3'
	}
} as const;
export const BUNDLED_PROLOG_MANIFEST_FINGERPRINT =
	BUNDLED_PROLOG_RUNTIME_PROFILE.manifestFingerprint;
export const BUNDLED_PROLOG_RUNNER_RECEIPT = {
	bytes: 22614,
	sha256: '3910176192b3ae2c8883d103c1013df720f9e52d7254f7aac987a57e97a58131'
} as const;
