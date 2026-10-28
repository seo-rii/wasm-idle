export const WASM_TINYGO_RUNTIME_PROFILE = Object.freeze({
	profileId: 'tinygo-0.43.0-wasip1-protocol-v6',
	protocolVersion: 6,
	manifestPath: 'tools/upstream/upstream-toolchain.v2.json',
	manifestFingerprint: 'e637c8eddc51710c1af07eb77b7d24c56f9502c6f5a0f26d06cc73edba05a572',
	manifestReceipt: Object.freeze({
		bytes: 1123,
		sha256: '604c746e664e8738c22c20489dd9d8fd52dd3df653f148d52b3b16fbc23fb380'
	}),
	assetReceipts: Object.freeze({
		'tools/upstream/lld.wasm': Object.freeze({
			bytes: 6417339,
			sha256: '495813efde8f354c38483749cdface7a7d9e23c8411da45a6f5f80030159eb11',
			uncompressedBytes: 16171013,
			uncompressedSha256: '34d39bc410c098e7e09933b61cc8e28699447af9a28abf4544d71b6e9cad1f9d'
		}),
		'tools/upstream/package-graph-provider-receipt.json': Object.freeze({
			bytes: 11122,
			sha256: '730ccd0af0b6c359ac0bd69082696f4702a988004cc6d46ffdcde752392364f5'
		}),
		'tools/upstream/producer-receipt.json': Object.freeze({
			bytes: 7452,
			sha256: '94f70d6848a6496c588b7eda94e7ad139bb79778a44b95382a8cb6863b9043d4'
		}),
		'tools/upstream/tinygo-compiler.wasm': Object.freeze({
			bytes: 29517026,
			sha256: '72c31eb39213a17625f71a4c06ef22d54bf2997f9c4d6cc4a73429e61f750bde',
			uncompressedBytes: 96523963,
			uncompressedSha256: 'fbea627d2430377515daf54fc6c42cceb10d5c09973534a328228c6bf6ce324d'
		}),
		'tools/upstream/tinygo-package-graph.wasm': Object.freeze({
			bytes: 6623009,
			sha256: 'a5cd2d133aee9c3a5e8eae30d43bcc6096858e1a332efa67692f71a2f8df83b3',
			uncompressedBytes: 27997948,
			uncompressedSha256: 'b7a526594fd5ea5531caecf11bd3a8e97af05c40dff63d8a57370419c47b56ed'
		}),
		'tools/upstream/tinygoroot.tar.gz.bin': Object.freeze({
			bytes: 31145468,
			sha256: '402bfd7059e12414cf0038c3e006c4030e1aa2f0b1ee6f1ffbc62cee9f5e2e3f'
		})
	})
});

export const WASM_TINYGO_EXECUTABLE_GRAPH_FORMAT = 'wasm-idle-tinygo-executable-graph-v1';
export const WASM_TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN =
	'wasm-idle:tinygo-executable-graph:v1\n';
export const WASM_TINYGO_EXECUTABLE_GRAPH_PROFILE = Object.freeze({
	schemaVersion: 1,
	format: WASM_TINYGO_EXECUTABLE_GRAPH_FORMAT,
	entryPath: 'upstream.js',
	fingerprint: '626d47447d73e8f2b1b2e5d166e6a0dc7bda15314cab50de2000798e58c89e84',
	modules: Object.freeze({
		'assets/upstream-binaryen-48916159e6bb29f4.wasm.gz.bin': Object.freeze({
			bytes: 2337116,
			sha256: '63375e0508c38f6ec0a43b43015fa938db0020616b3e02aa8ad49e3e84acf6e8',
			uncompressedBytes: 9909420,
			uncompressedSha256: '48916159e6bb29f4bb03fcab110114ba83e03f96a2f78484167093ee27459ab3',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-CbXtAM7H.js': Object.freeze({
			bytes: 589,
			sha256: 'bbf7c5086ae414dc3f33777e3eebf16ea8631325b8bb4690d25091c03567f31a',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-CjBUBLVc.js': Object.freeze({
			bytes: 106370,
			sha256: '5bf52b17b6cfcca0f1e200fc908eb58864144860e442d230f6edebd222975103',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CtGm-AK6.js',
					target: 'assets/upstream-compile-worker-CtGm-AK6.js',
					kind: 'dynamic'
				})
			])
		}),
		'assets/upstream-compile-worker-CtGm-AK6.js': Object.freeze({
			bytes: 183991,
			sha256: 'ea3e633cdf6bc8e9d8cb628b8fe7ac971b082e83b1963dffa1fe1a90f0a9ddb8',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CbXtAM7H.js',
					target: 'assets/upstream-compile-worker-CbXtAM7H.js',
					kind: 'static'
				}),
				Object.freeze({
					specifier: './upstream-compile-worker-Dsn9Eg6C.js',
					target: 'assets/upstream-compile-worker-Dsn9Eg6C.js',
					kind: 'dynamic'
				}),
				Object.freeze({
					specifier: './upstream-binaryen-48916159e6bb29f4.wasm.gz.bin',
					target: 'assets/upstream-binaryen-48916159e6bb29f4.wasm.gz.bin',
					kind: 'asset'
				})
			])
		}),
		'assets/upstream-compile-worker-Dsn9Eg6C.js': Object.freeze({
			bytes: 126,
			sha256: 'a03423dd62954c6479910dddedc4703ecdc36e4dcd783e5d2b121fb16b72a1b4',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CbXtAM7H.js',
					target: 'assets/upstream-compile-worker-CbXtAM7H.js',
					kind: 'static'
				})
			])
		}),
		'upstream.js': Object.freeze({
			bytes: 126854,
			sha256: '67031b67fe3b70fea1e0cbc2b01ba113eae585cddb641a4769cdf1056104a5a9',
			imports: Object.freeze([
				Object.freeze({
					specifier: 'assets/upstream-compile-worker-CjBUBLVc.js',
					target: 'assets/upstream-compile-worker-CjBUBLVc.js',
					kind: 'worker'
				})
			])
		})
	})
});

export const WASM_TINYGO_ASSET_VERSION =
	'1f50eede6cf4de937e8150400e72e094fbfe1ee732b6f1f28d2a439593c4abc3';
