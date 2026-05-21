import type { CompileWorkerMessage } from '../src/worker-protocol.js';

export function createRuntimeManifest(overrides: Record<string, unknown> = {}) {
	return {
		version: 'test-runtime-v1',
		hostTriple: 'x86_64-unknown-linux-gnu',
		targetTriple: 'wasm32-wasip1',
		rustcWasm: 'rustc/rustc.wasm.gz',
		workerBitcodeFile: 'main.main.1ca70c240d7de168-cgu.0.rcgu.no-opt.bc',
		workerSharedOutputBytes: 1024,
		compileTimeoutMs: 2_000,
		artifactIdleMs: 500,
		rustcMemory: {
			initialPages: 8,
			maximumPages: 16
		},
		sysrootFiles: [
			{
				asset: 'sysroot/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
				runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib'
			}
		],
		llvm: {
			llc: 'llvm/llc.js',
			lld: 'llvm/lld.js'
		},
		link: {
			allocatorObjectRuntimePath: '/work/alloc.o',
			allocatorObjectAsset: 'link/alloc.o',
			args: ['-o', '/work/main.wasm'],
			files: [
				{
					asset: 'sysroot/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
					runtimePath: '/rustlib/libstd.rlib'
				}
			]
		},
		...overrides
	};
}

export function createRuntimeManifestV2(overrides: Record<string, unknown> = {}) {
	return {
		manifestVersion: 2,
		version: 'test-runtime-v2',
		hostTriple: 'x86_64-unknown-linux-gnu',
		defaultTargetTriple: 'wasm32-wasip1',
		compiler: {
			rustcWasm: 'rustc/rustc.wasm.gz',
			workerBitcodeFile: 'main.main.1ca70c240d7de168-cgu.0.rcgu.no-opt.bc',
			workerSharedOutputBytes: 1024,
			compileTimeoutMs: 2_000,
			artifactIdleMs: 500,
			rustcMemory: {
				initialPages: 8,
				maximumPages: 16
			}
		},
		targets: {
			'wasm32-wasip1': {
				artifactFormat: 'core-wasm',
				sysrootFiles: [
					{
						asset: 'sysroot/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
						runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib'
					}
				],
				compile: {
					kind: 'llvm-wasm',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						allocatorObjectRuntimePath: '/work/alloc.o',
						allocatorObjectAsset: 'link/alloc.o',
						args: ['-o', '/work/main.wasm'],
						files: [
							{
								asset: 'sysroot/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
								runtimePath: '/rustlib/libstd.rlib'
							}
						]
					}
				},
				execution: {
					kind: 'preview1'
				}
			},
			'wasm32-wasip2': {
				artifactFormat: 'component',
				sysrootFiles: [
					{
						asset: 'sysroot/lib/rustlib/wasm32-wasip2/lib/libstd.rlib',
						runtimePath: '/lib/rustlib/wasm32-wasip2/lib/libstd.rlib'
					}
				],
				compile: {
					kind: 'llvm-wasm+component-encoder',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						allocatorObjectRuntimePath: '/work/alloc.o',
						allocatorObjectAsset: 'link/alloc.o',
						args: ['-o', '/work/main.wasm'],
						files: [
							{
								asset: 'sysroot/lib/rustlib/wasm32-wasip2/lib/libstd.rlib',
								runtimePath: '/rustlib/libstd.rlib'
							}
						]
					}
				},
				execution: {
					kind: 'preview2-component'
				}
			},
			'wasm32-wasip3': {
				artifactFormat: 'component',
				sysrootFiles: [
					{
						asset: 'sysroot/lib/rustlib/wasm32-wasip3/lib/libstd.rlib',
						runtimePath: '/lib/rustlib/wasm32-wasip3/lib/libstd.rlib'
					}
				],
				compile: {
					kind: 'llvm-wasm+component-encoder',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						allocatorObjectRuntimePath: '/work/alloc.o',
						allocatorObjectAsset: 'link/alloc.o',
						args: ['-o', '/work/main.wasm'],
						files: [
							{
								asset: 'sysroot/lib/rustlib/wasm32-wasip3/lib/libstd.rlib',
								runtimePath: '/rustlib/libstd.rlib'
							}
						]
					}
				},
				execution: {
					kind: 'preview2-component'
				}
			}
		},
		...overrides
	};
}

export function createRuntimeManifestV3(overrides: Record<string, unknown> = {}) {
	return {
		manifestVersion: 3,
		version: 'test-runtime-v3',
		hostTriple: 'x86_64-unknown-linux-gnu',
		defaultTargetTriple: 'wasm32-wasip1',
		compiler: {
			rustcWasm: 'rustc/rustc.wasm.gz',
			workerBitcodeFile: 'main.main.1ca70c240d7de168-cgu.0.rcgu.no-opt.bc',
			workerSharedOutputBytes: 1024,
			compileTimeoutMs: 2_000,
			artifactIdleMs: 500,
			rustcMemory: {
				initialPages: 8,
				maximumPages: 16
			}
		},
		targets: {
			'wasm32-wasip1': {
				artifactFormat: 'core-wasm',
				sysrootPack: {
					asset: 'packs/sysroot/wasm32-wasip1.pack.gz',
					index: 'packs/sysroot/wasm32-wasip1.index.json.gz',
					fileCount: 1,
					totalBytes: 3
				},
				compile: {
					kind: 'llvm-wasm',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						args: ['-o', '/work/main.wasm'],
						pack: {
							asset: 'packs/link/wasm32-wasip1.pack.gz',
							index: 'packs/link/wasm32-wasip1.index.json.gz',
							fileCount: 2,
							totalBytes: 6
						}
					}
				},
				execution: {
					kind: 'preview1'
				}
			},
			'wasm32-wasip2': {
				artifactFormat: 'component',
				sysrootPack: {
					asset: 'packs/sysroot/wasm32-wasip2.pack.gz',
					index: 'packs/sysroot/wasm32-wasip2.index.json.gz',
					fileCount: 1,
					totalBytes: 3
				},
				compile: {
					kind: 'llvm-wasm+component-encoder',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						args: ['-o', '/work/main.wasm'],
						pack: {
							asset: 'packs/link/wasm32-wasip2.pack.gz',
							index: 'packs/link/wasm32-wasip2.index.json.gz',
							fileCount: 2,
							totalBytes: 6
						}
					}
				},
				execution: {
					kind: 'preview2-component'
				}
			},
			'wasm32-wasip3': {
				artifactFormat: 'component',
				sysrootPack: {
					asset: 'packs/sysroot/wasm32-wasip3.pack.gz',
					index: 'packs/sysroot/wasm32-wasip3.index.json.gz',
					fileCount: 1,
					totalBytes: 3
				},
				compile: {
					kind: 'llvm-wasm+component-encoder',
					llvm: {
						llc: 'llvm/llc.js',
						llcWasm: 'llvm/llc.wasm.gz',
						lld: 'llvm/lld.js',
						lldWasm: 'llvm/lld.wasm.gz',
						lldData: 'llvm/lld.data.gz'
					},
					link: {
						args: ['-o', '/work/main.wasm'],
						pack: {
							asset: 'packs/link/wasm32-wasip3.pack.gz',
							index: 'packs/link/wasm32-wasip3.index.json.gz',
							fileCount: 2,
							totalBytes: 6
						}
					}
				},
				execution: {
					kind: 'preview2-component'
				}
			}
		},
		...overrides
	};
}

export function createCompileWorkerErrorMessage(error: string): CompileWorkerMessage {
	return {
		type: 'error',
		error
	};
}

export function createCompileWorkerLogMessage(log: string): CompileWorkerMessage {
	return {
		type: 'log',
		log
	};
}

export function createCompileWorkerResultMessage(stdout = ''): CompileWorkerMessage {
	return {
		type: 'result',
		success: true,
		stdout,
		stderr: '',
		exitCode: 0,
		bitcode: null,
		artifacts: {}
	};
}

export class FakeWorker {
	private readonly listeners = new Map<'message' | 'error', Set<(event: any) => void>>();
	terminated = false;
	lastRequest: unknown = null;
	private readonly onPostMessage: (message: any, worker: FakeWorker) => void;

	constructor(onPostMessage: (message: any, worker: FakeWorker) => void = () => {}) {
		this.listeners.set('message', new Set());
		this.listeners.set('error', new Set());
		this.onPostMessage = onPostMessage;
	}

	postMessage(message: unknown) {
		this.lastRequest = message;
		this.onPostMessage(message, this);
	}

	terminate() {
		this.terminated = true;
	}

	addEventListener(type: 'message' | 'error', listener: (event: any) => void) {
		this.listeners.get(type)?.add(listener);
	}

	removeEventListener(type: 'message' | 'error', listener: (event: any) => void) {
		this.listeners.get(type)?.delete(listener);
	}

	emitMessage(data: CompileWorkerMessage) {
		for (const listener of this.listeners.get('message') || []) {
			listener({ data });
		}
	}

	emitError(error: Error) {
		for (const listener of this.listeners.get('error') || []) {
			listener({ error, message: error.message });
		}
	}

	emitErrorEvent(event: {
		error?: unknown;
		message?: string;
		filename?: string;
		lineno?: number;
		colno?: number;
	}) {
		for (const listener of this.listeners.get('error') || []) {
			listener(event);
		}
	}
}

export function mirrorBitcode(sharedBuffer: SharedArrayBuffer, bitcode: Uint8Array, sequence = 1) {
	const state = new Int32Array(sharedBuffer, 0, 4);
	const bytes = new Uint8Array(sharedBuffer, 16);
	bytes.set(bitcode, 0);
	Atomics.store(state, 0, bitcode.length);
	Atomics.store(state, 1, 0);
	Atomics.store(state, 2, sequence);
}
