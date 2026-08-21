export const WASM_PERL_RUNTIME_PROFILE = {
	profileId: 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28',
	artifactRevision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	webperlRevision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	perlRevision: 'e70d909feb796ec99d5e91de5d1635d4526ec131',
	emscriptenRevision: '69ab40586822209758165df170e9fc8b81e05608',
	manifestFingerprint: 'fd0dede426ef3ff3264e71e9d3583530eccd9529fe08632dc1574d9e13a7be3b',
	manifestReceipt: {
		bytes: 3758,
		sha256: '0254578c97d1bfb58432f96161ef5758a3bfbfde89d6cb00f867c80c8099ba96'
	},
	javascriptReceipt: {
		bytes: 61304,
		sha256: '2a8b07227cb363ee57d8a5679c751044e191b4979862ff54709ea8773c236ce0',
		uncompressedBytes: 303013,
		uncompressedSha256: 'b60e3c04874c6ef5278001257b4c8a9f4c7e69ca3d6b268d9639723234844784'
	},
	wasmReceipt: {
		bytes: 1186908,
		sha256: '1375fdda3204cbcb9f21d182a0706bf8bac7acc1267366e87bccf9ac29310ca0',
		uncompressedBytes: 3734063,
		uncompressedSha256: 'f1d49c4514c7332a57992c4a2444fd6a56ae3b5e6651b4fd484852a641e5e4ec'
	},
	dataReceipt: {
		bytes: 2603581,
		sha256: '22a01b26b41b515fd9be927e639dafa4846529c6e25fda2d74663a9b4f34ba2c',
		uncompressedBytes: 12021691,
		uncompressedSha256: '9529019418cf766a42cf2d25bd3fc97b47c9e689f5666cfc32dc11338d1b1e66'
	}
} as const;
export const WASM_PERL_RUNTIME_BUNDLE = Object.freeze({
	profile: WASM_PERL_RUNTIME_PROFILE,
	workerReceipt: {
		bytes: 24597,
		sha256: 'f5c4a623cae150451794db91643822bed017eb5fa5a8aab9ea3171250273aab3'
	}
});
export const WASM_PERL_ASSET_VERSION = WASM_PERL_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_PERL_RUNNER_RECEIPT = WASM_PERL_RUNTIME_BUNDLE.workerReceipt;
