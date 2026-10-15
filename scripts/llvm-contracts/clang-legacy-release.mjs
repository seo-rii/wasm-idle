// Exact pre-receipt Clang release already installed by wasm-idle.
// Derived from the committed static/clang/runtime-build.json and independently
// hash-checked delivered bytes, including its receipted complete-sysroot derivation.
// This exception never qualifies a new source build.
export const LEGACY_CLANG_RELEASE = {
	schemaVersion: 1,
	metadataFields: [
		'producer',
		'version',
		'llvmVersion',
		'llvmCommit',
		'wasiSdkVersion',
		'emsdkVersion',
		'resourceDir',
		'compilerRuntimeLibDir',
		'clangd',
		'memfs',
		'componentDerivation'
	],
	metadataSha256: '05b33897b844d94cc833b06936724b3d1ec758e6cadb40ef3dee4a6eea0da9ae',
	inputs: {
		clang: {
			bytes: 35658969,
			sha256: 'd92ef06cdd3fea88acf384db15a6f2a344790c05bcba8e9f13f5b75b36ad4a99'
		},
		lld: {
			bytes: 16171013,
			sha256: '34d39bc410c098e7e09933b61cc8e28699447af9a28abf4544d71b6e9cad1f9d'
		},
		memfs: {
			bytes: 38071,
			sha256: '5b741e03dd3502bcfd80e4e5055232b5d633604e1461752efed0189f93407dc3'
		},
		sysroot: {
			bytes: 35328000,
			sha256: '91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402'
		},
		clangdJs: {
			bytes: 97002,
			sha256: '92dce989f2623a6e8930369dd205301c2815d70cf81312c64de1c47a16302b27'
		},
		clangdWasm: {
			bytes: 78993623,
			sha256: 'f2bef5c4b4aa8691f0b996286231c5778a17119c41537ae4108c7ff2795f7fc3'
		}
	}
};
