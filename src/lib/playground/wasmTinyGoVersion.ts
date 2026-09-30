export const WASM_TINYGO_RUNTIME_PROFILE = Object.freeze({
	profileId: 'tinygo-0.40.1-wasip1-protocol-v6',
	protocolVersion: 6,
	manifestPath: 'tools/upstream/upstream-toolchain.v2.json',
	manifestFingerprint: '03140d8fe8b9b477764da72a3a497077984faa4553e7a94901c8130b26680ce5',
	manifestReceipt: Object.freeze({
		bytes: 1124,
		sha256: 'e53790b97125e48d77967bc87cc400fdfacfb678e6d847de372efa647cb4de4f'
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
			bytes: 10207,
			sha256: 'a400355ee1ca13c6a79bca0c7c2e8cf05ecf457fdc61c9fc69692bb17500842a'
		}),
		'tools/upstream/tinygo-compiler.wasm': Object.freeze({
			bytes: 17488480,
			sha256: '9700dd4403162a89cffa065011bb26c919b70a82b3e86d612ceb064a598111de',
			uncompressedBytes: 54057556,
			uncompressedSha256: 'a65f51c7d2845ea1469328705f2c9839f0151ee221e6a3efea851226e4e2d649'
		}),
		'tools/upstream/tinygo-package-graph.wasm': Object.freeze({
			bytes: 6058150,
			sha256: '4ed8da31755a0b54ccfc1dafe39fcc124ed3525f3c843642179c08af18c76c58',
			uncompressedBytes: 25870831,
			uncompressedSha256: 'b7b28719bf97d5c5e140c3ec6f8f40a40fc7d02216e0160e460a34b79f61cb14'
		}),
		'tools/upstream/tinygoroot.tar.gz.bin': Object.freeze({
			bytes: 29058996,
			sha256: '6c085f441ecc5990b71628f0b47b80e9e9810ae6384093e65723f795b4bd8688'
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
	fingerprint: '4f5712fb66d4d6e7e5f84a688911a1cdc0df96f30163c3036a453a505b4d409f',
	modules: Object.freeze({
		'assets/upstream-compile-worker-CFw6Ych6.js': Object.freeze({
			bytes: 558,
			sha256: '03a76345c69f8bd751dac18894f65c0918f1690fbbb661f38052819cd5ae8209',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-D5QWLpRH.js': Object.freeze({
			bytes: 103559,
			sha256: '5d37a07cd8118d663f1be495b4187e733add0a7e44e368d637074cb10d0518f2',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-Dat9LBTc.js',
					target: 'assets/upstream-compile-worker-Dat9LBTc.js',
					kind: 'dynamic'
				})
			])
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
		'upstream.js': Object.freeze({
			bytes: 126073,
			sha256: '233c5e931405ffc817ad39e2a9f2d02090eefe6612409f4cf0124b4418076e1f',
			imports: Object.freeze([
				Object.freeze({
					specifier: 'assets/upstream-compile-worker-D5QWLpRH.js',
					target: 'assets/upstream-compile-worker-D5QWLpRH.js',
					kind: 'worker'
				})
			])
		})
	})
});

export const WASM_TINYGO_ASSET_VERSION =
	'36a91bc5b531e582603ff7442d7d4e05ead2253aed5185976f23ba1f003c40b3';
