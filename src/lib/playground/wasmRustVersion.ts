export const WASM_RUST_RUNTIME_PROFILE = Object.freeze({
	profileId: 'wasm-rust-3f1409e92a8566f2cf927b0d53360868b9732cca2e3ed6ee2c5ab44c04c3a3a3',
	protocolVersion: 1,
	manifestPath: 'runtime/runtime-manifest.v3.json',
	manifestFingerprint: '3f1409e92a8566f2cf927b0d53360868b9732cca2e3ed6ee2c5ab44c04c3a3a3',
	manifestReceipt: {
		bytes: 6185,
		sha256: '30b210003632395a1effd19f7a46565d5f8c52a9d3a28a310fa24219f97a5a9a'
	},
	assetReceipts: {
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.index.json.gz': {
			bytes: 1126,
			sha256: 'd3846ecae39b774300272f883e3d85a7e986214584a6ca23d15b9b55c6024cb4',
			uncompressedBytes: 6986,
			uncompressedSha256: '2f05e809be7df5f92b91eb8493a63091574cecb249f3de376e4c8f3aea81b05c'
		},
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.pack.gz': {
			bytes: 24626071,
			sha256: 'c98393f3ab41a009fe6d36b9afacea7d47aa282b88c93c171b1d5a924ce18f96',
			uncompressedBytes: 75268153,
			uncompressedSha256: 'c77bbafd0d7496731810296f91f34cf02be47f8708a6a669172c97963d12a5cb'
		},
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip2.index.json.gz': {
			bytes: 1811,
			sha256: '5f3cc86d59e8f5388f072dc48a0951ddc616f18a4860c220afaff2a89199d4e0',
			uncompressedBytes: 12822,
			uncompressedSha256: '780e0716fb5bddc9f142f4b2205b76d495593e6c34b7d654c034d0e4b7cea3b3'
		},
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip2.pack.gz': {
			bytes: 7747620,
			sha256: '417a9316a2a6a7db5fab6adfa0a7e7e5958ed4591754562a66f6cdd96a68df6e',
			uncompressedBytes: 17558862,
			uncompressedSha256: '957dca062890c0550fe3bf8a5ce0e2fe69f6bd69d19a429f73ceec888f05be83'
		},
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip3.index.json.gz': {
			bytes: 1829,
			sha256: '14251cd39eb88dcfef74f0ed626994109a24f2b560910da453db8d24caf7bdb9',
			uncompressedBytes: 12825,
			uncompressedSha256: 'bc5e257d8560487902d4a023fed6c64faa90508cddac067db23a4eed9af50cb4'
		},
		'wasm-rust/runtime/packs/sysroot/wasm32-wasip3.pack.gz': {
			bytes: 7862375,
			sha256: 'dbd22b4c728b0d8eb60ca8371bfd2a4de3cc309aec919ac21d4b2e9a5f687bf3',
			uncompressedBytes: 18202672,
			uncompressedSha256: 'b6c9fb2dfb6fe7de6d21c23eb468b57d2629973e40fd63e0acf2324689592b70'
		},
		'wasm-rust/runtime/rustc/rustc.wasm.gz': {
			bytes: 21103827,
			sha256: '3cbbf421f97460cd36c678509289976a8346fa4875009e064944024bc9c7e3da',
			uncompressedBytes: 75367614,
			uncompressedSha256: 'b7b1dc0687115b3243e4e41b7dc24718178d4e75e1ccc975d4400a407627c493'
		},
		'wasm-rust/vendor/jco/lib/wasi_snapshot_preview1.command.wasm': {
			bytes: 57236,
			sha256: 'b391794bf40029766403da7353eb2e1da17067844b78e19eaf9d934c25c4055d'
		},
		'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core.wasm.gz': {
			bytes: 2508654,
			sha256: '004a5f62b0514f78b645c0acc403f599c8706cb27f21a0ac9f96b119ea20fe0c',
			uncompressedBytes: 7739762,
			uncompressedSha256: '50d8ad4bf3f2d985f90b2571a8090d2075301adbaaf9fe21d4771c772477cc48'
		},
		'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core2.wasm': {
			bytes: 16426,
			sha256: 'ae04633eab380bc18fbe3842a092eab4924688fcc93f04a2ac659add202ede5e'
		},
		'wasm-rust/vendor/jco/obj/wasm-tools.core.wasm.gz': {
			bytes: 928763,
			sha256: '347ad6e84cb0904203f862bb1b8fa0cea49e9bc43e129918fd6d728aeab13730',
			uncompressedBytes: 2429240,
			uncompressedSha256: 'c58816cb0a4751250dc2aea56064e50730d8af7bafffa3ab7bc31d7bd56670e4'
		},
		'wasm-rust/vendor/jco/obj/wasm-tools.core2.wasm': {
			bytes: 16426,
			sha256: 'ae04633eab380bc18fbe3842a092eab4924688fcc93f04a2ac659add202ede5e'
		}
	}
} as const);

export const WASM_RUST_ASSET_VERSION = WASM_RUST_RUNTIME_PROFILE.manifestFingerprint;
