export const WASM_TINYGO_RUNTIME_PROFILE = Object.freeze({
	profileId: 'tinygo-0.40.1-wasip1-protocol-v6',
	protocolVersion: 6,
	manifestPath: 'tools/upstream/upstream-toolchain.v2.json',
	manifestFingerprint: 'd3f20ca1974c52fa8e4b20e37a75f8171044e0351192b8bed85d7f83d4fffbbc',
	manifestReceipt: Object.freeze({
		bytes: 1123,
		sha256: '4f95485c52f5eec87d1b0906ac8ab4bcb403b8e3bdbcbac2319469353c6a4dfc'
	}),
	assetReceipts: Object.freeze({
		'tools/upstream/lld.wasm': Object.freeze({
			bytes: 7837837,
			sha256: 'f842a9b5df3c6d326f0260bfd313c11c2e22bc8b8ae0387deede9a4af55779cd',
			uncompressedBytes: 20795796,
			uncompressedSha256: '14f08c475b24ef45313cab7a086693525955c2c000b833faaaf48ad35b2521f8'
		}),
		'tools/upstream/package-graph-provider-receipt.json': Object.freeze({
			bytes: 10368,
			sha256: 'b25c8ffd86af0e540cf058e38b273271100ff297316f30a38c8239c77d9357d1'
		}),
		'tools/upstream/producer-receipt.json': Object.freeze({
			bytes: 7572,
			sha256: 'bcf1ca1951a64896df98ae8d04137c80c503b1f5e64a099fae99d90deffe8b60'
		}),
		'tools/upstream/tinygo-compiler.wasm': Object.freeze({
			bytes: 19961972,
			sha256: '37e07f96700ee4a98c37879553144e4c3872fa91136be3a193cb33d5d11a372f',
			uncompressedBytes: 70288217,
			uncompressedSha256: 'a5f6cb6cbfff45e6c5ee6ab8f3bca37c5dabd19d443107707ad1de330ecb8db2'
		}),
		'tools/upstream/tinygo-package-graph.wasm': Object.freeze({
			bytes: 6058150,
			sha256: '4ed8da31755a0b54ccfc1dafe39fcc124ed3525f3c843642179c08af18c76c58',
			uncompressedBytes: 25870831,
			uncompressedSha256: 'b7b28719bf97d5c5e140c3ec6f8f40a40fc7d02216e0160e460a34b79f61cb14'
		}),
		'tools/upstream/tinygoroot.tar.gz.bin': Object.freeze({
			bytes: 28919860,
			sha256: 'e9e8314b406e57a512b49d9716455665bfac36e24694763bdecf86f4b0c2fae3'
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
	fingerprint: '33fe04eb515aaaea7e7dd5571a4a614a48d51b991115f05288b236377c53c5b9',
	modules: Object.freeze({
		'assets/upstream-compile-worker-CFw6Ych6.js': Object.freeze({
			bytes: 558,
			sha256: '03a76345c69f8bd751dac18894f65c0918f1690fbbb661f38052819cd5ae8209',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-Dat9LBTc.js': Object.freeze({
			bytes: 12538521,
			sha256: 'b8d987c32914715b0ba91ace85585f5db467957d14982aa163c1febe9d6dfc04',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CFw6Ych6.js',
					target: 'assets/upstream-compile-worker-CFw6Ych6.js',
					kind: 'static'
				}),
				Object.freeze({
					specifier: './upstream-compile-worker-NPJcbr3r.js',
					target: 'assets/upstream-compile-worker-NPJcbr3r.js',
					kind: 'dynamic'
				})
			])
		}),
		'assets/upstream-compile-worker-NPJcbr3r.js': Object.freeze({
			bytes: 110,
			sha256: '2ac9a6dff1bfd7198815ead612722d9b2ffbbc6c8a0e62958444ee84ff155b80',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CFw6Ych6.js',
					target: 'assets/upstream-compile-worker-CFw6Ych6.js',
					kind: 'static'
				})
			])
		}),
		'assets/upstream-compile-worker-R7P8Uy5f.js': Object.freeze({
			bytes: 100032,
			sha256: '1cc51b6435aa72d0ad9c513658a8ed4b2e9d5f94a28b0902b1f200364bccbf82',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-Dat9LBTc.js',
					target: 'assets/upstream-compile-worker-Dat9LBTc.js',
					kind: 'dynamic'
				})
			])
		}),
		'upstream.js': Object.freeze({
			bytes: 123164,
			sha256: 'bee971f17a538c1afc3fa01f2050a233a4b75030f0a8e258fd8ca76584cc93a6',
			imports: Object.freeze([
				Object.freeze({
					specifier: 'assets/upstream-compile-worker-R7P8Uy5f.js',
					target: 'assets/upstream-compile-worker-R7P8Uy5f.js',
					kind: 'worker'
				})
			])
		})
	})
});

export const WASM_TINYGO_ASSET_VERSION =
	'5ff593680ea205ac06ce66afd181d811f46933a5358113a11206b6b89d95707f';
