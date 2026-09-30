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
	fingerprint: '8ecbffd4b4e44ff67288d8c46328a1b06d0a0ac76d7a50a9e458603b68d0d795',
	modules: Object.freeze({
		'assets/upstream-binaryen-59aad93503b5fd53.wasm.gz.bin': Object.freeze({
			bytes: 2366782,
			sha256: 'e497b67a6bcbee29639792a3d58ecacb22781287f7fe155bfdf079e6ca159dff',
			uncompressedBytes: 9282194,
			uncompressedSha256: '59aad93503b5fd539993f2f5571c11dce9ddb4c5d10b681abc8e5dc124aed526',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-CFw6Ych6.js': Object.freeze({
			bytes: 558,
			sha256: '03a76345c69f8bd751dac18894f65c0918f1690fbbb661f38052819cd5ae8209',
			imports: Object.freeze([])
		}),
		'assets/upstream-compile-worker-CUrboB1_.js': Object.freeze({
			bytes: 103559,
			sha256: '42337c2f06d04b51d79f0ec66ae685f0cfb2a78718b0636df980dc92dd1db9d5',
			imports: Object.freeze([
				Object.freeze({
					specifier: './upstream-compile-worker-CeYS3ydo.js',
					target: 'assets/upstream-compile-worker-CeYS3ydo.js',
					kind: 'dynamic'
				})
			])
		}),
		'assets/upstream-compile-worker-CeYS3ydo.js': Object.freeze({
			bytes: 181175,
			sha256: 'faa2bf6a310cd23991babde1fb62cd34253d692fee03029fe3508eae4c24b1c0',
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
				}),
				Object.freeze({
					specifier: './upstream-binaryen-59aad93503b5fd53.wasm.gz.bin',
					target: 'assets/upstream-binaryen-59aad93503b5fd53.wasm.gz.bin',
					kind: 'asset'
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
			sha256: '136a957aa940c3e2b8c7a925eb538f3fce81f699aa9113e1fd93ce0b35c879aa',
			imports: Object.freeze([
				Object.freeze({
					specifier: 'assets/upstream-compile-worker-CUrboB1_.js',
					target: 'assets/upstream-compile-worker-CUrboB1_.js',
					kind: 'worker'
				})
			])
		})
	})
});

export const WASM_TINYGO_ASSET_VERSION =
	'0b2e827ae219eecc806d4118ee4a2b6032adbe7a960e6c0e471c4491d9a1f2f3';
