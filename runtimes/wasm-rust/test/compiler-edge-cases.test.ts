import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	compileRust,
	createBrowserRustCompileRequestIdentity,
	resolveBrowserRustDebugMode
} from '../src/compiler.js';
import type { BrowserRustWorkerLimits } from '../src/types.js';
import {
	FakeWorker,
	createRuntimeManifest,
	createRuntimeManifestV2,
	mirrorBitcode
} from './helpers.js';

describe('wasm-rust compiler edge cases', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects an empty source file before doing any runtime work', async () => {
		const loadManifest = vi.fn(async () => createRuntimeManifest());
		const createWorker = vi.fn(() => new FakeWorker());

		const result = await compileRust(
			{
				code: '   ',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest,
				createWorker
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('requires a non-empty Rust source file');
		expect(loadManifest).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('rejects reserved channel and mode fields before doing any runtime work', async () => {
		const loadManifest = vi.fn(async () => createRuntimeManifest());
		const createWorker = vi.fn(() => new FakeWorker());

		const channelResult = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				channel: 'stable'
			},
			{
				loadManifest,
				createWorker
			}
		);
		const modeResult = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				mode: 'debug'
			},
			{
				loadManifest,
				createWorker
			}
		);

		expect(channelResult.success).toBe(false);
		expect(channelResult.stderr).toContain('channel selection is not supported yet');
		expect(modeResult.success).toBe(false);
		expect(modeResult.stderr).toContain('mode selection is not supported yet');
		expect(loadManifest).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it.each([
		{ maxWorkers: 0, maxThreads: 1 },
		{ maxWorkers: 1, maxThreads: 0 },
		{ maxWorkers: 1.5, maxThreads: 1 },
		{ maxWorkers: 1, maxThreads: Number.NaN },
		{ maxWorkers: 1, maxThreads: Number.MAX_SAFE_INTEGER + 1 },
		{ maxWorkers: 1, maxThreads: 1, unexpected: 1 }
	])('rejects malformed worker limits before runtime work %#', async (workerLimits) => {
		const loadManifest = vi.fn(async () => createRuntimeManifest());
		const createWorker = vi.fn(() => new FakeWorker());

		const result = await compileRust(
			{
				code: 'fn main() {}',
				workerLimits: workerLimits as BrowserRustWorkerLimits
			},
			{ loadManifest, createWorker }
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toMatch(/wasm-rust worker limit/u);
		expect(loadManifest).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('forwards an exact immutable worker limit snapshot to the compiler worker', async () => {
		let postedRequest: any;
		const worker = new FakeWorker((message, currentWorker) => {
			postedRequest = message.request;
			currentWorker.emitMessage({
				type: 'error',
				message: 'expected test stop'
			});
		});

		await compileRust(
			{
				code: 'fn main() {}',
				workerLimits: { maxWorkers: 3, maxThreads: 7 }
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker,
				sleep: async () => Promise.resolve()
			}
		);

		expect(postedRequest.workerLimits).toEqual({ maxWorkers: 3, maxThreads: 7 });
		expect(Object.isFrozen(postedRequest.workerLimits)).toBe(true);
	});

	it('includes the resolved debug mode in stable compile request identities', () => {
		const request = {
			code: 'fn main() {}',
			targetTriple: 'wasm32-wasip1' as const
		};

		expect(resolveBrowserRustDebugMode(request)).toBe('none');
		expect(createBrowserRustCompileRequestIdentity(request)).toBe(
			createBrowserRustCompileRequestIdentity({
				...request,
				debugMode: 'none'
			})
		);
		expect(
			createBrowserRustCompileRequestIdentity({
				...request,
				debugMode: 'trace'
			})
		).not.toBe(
			createBrowserRustCompileRequestIdentity({
				...request,
				debugMode: 'lldb'
			})
		);
	});

	it('rejects unsupported debug modes and non-wasip1 LLDB targets before runtime work', async () => {
		const loadManifest = vi.fn(async () => createRuntimeManifest());
		const createWorker = vi.fn(() => new FakeWorker());

		const unsupportedModeResult = await compileRust(
			{
				code: 'fn main() {}',
				debugMode: 'native' as 'lldb'
			},
			{
				loadManifest,
				createWorker
			}
		);
		const unsupportedTargetResult = await compileRust(
			{
				code: 'fn main() {}',
				debugMode: 'lldb',
				targetTriple: 'wasm32-wasip2'
			},
			{
				loadManifest,
				createWorker
			}
		);

		expect(unsupportedModeResult.success).toBe(false);
		expect(unsupportedModeResult.stderr).toContain('unsupported browser compiler debug mode');
		expect(unsupportedTargetResult.success).toBe(false);
		expect(unsupportedTargetResult.stderr).toContain(
			'LLDB debugging currently supports only wasm32-wasip1'
		);
		expect(loadManifest).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('fails fast when SharedArrayBuffer worker prerequisites are unavailable', async () => {
		const originalSharedArrayBuffer = globalThis.SharedArrayBuffer;
		vi.stubGlobal('SharedArrayBuffer', undefined);

		try {
			const result = await compileRust({
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			});

			expect(result.success).toBe(false);
			expect(result.stderr).toContain('cross-origin-isolated worker environment');
		} finally {
			vi.stubGlobal('SharedArrayBuffer', originalSharedArrayBuffer);
		}
	});

	it('returns the llvm-wasm linker error when mirrored bitcode exists but linking fails', async () => {
		const bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
		const worker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker,
				linkBitcode: async () => {
					throw new Error('lld failed to produce main.wasm');
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('llvm-wasm link failed');
		expect(result.stderr).toContain('lld failed to produce main.wasm');
	});

	it('treats extendedTimeout and the legacy prepare alias as a 120s timeout floor', async () => {
		for (const requestFlags of [{ extendedTimeout: true }, { prepare: true }] as const) {
			const result = await compileRust(
				{
					code: 'fn main() { println!("hi"); }',
					edition: '2024',
					crateType: 'bin',
					log: true,
					...requestFlags
				},
				{
					loadManifest: async () =>
						createRuntimeManifest({
							compileTimeoutMs: 5_000
						}),
					createWorker: () =>
						new FakeWorker((_, worker) => {
							worker.emitMessage({
								type: 'error',
								message: 'permanent compiler failure'
							});
						}),
					sleep: async () => {
						await Promise.resolve();
					}
				}
			);

			expect(result.logs).toEqual(
				expect.arrayContaining([expect.stringContaining('timeout=120000ms')])
			);
		}
	});

	it('defaults to wasm32-wasip1 when compiling against a v2 runtime manifest', async () => {
		const bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
		const worker = new FakeWorker((message, currentWorker) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			currentWorker.emitMessage({
				type: 'success',
				stdout: '',
				stderr: '',
				diagnostics: []
			});
		});
		const selectedTargets: string[] = [];

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifestV2(),
				createWorker: () => worker,
				linkBitcode: async (_bitcode, _manifest, targetConfig) => {
					selectedTargets.push(targetConfig.targetTriple);
					return {
						wasm: new Uint8Array([0, 97, 115, 109]),
						targetTriple: targetConfig.targetTriple,
						format: targetConfig.artifactFormat
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(selectedTargets).toEqual(['wasm32-wasip1']);
		expect(result.artifact?.targetTriple).toBe('wasm32-wasip1');
		expect(result.artifact?.format).toBe('core-wasm');
	});

	it('selects wasm32-wasip2 when explicitly requested on a v2 runtime manifest', async () => {
		const bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
		const worker = new FakeWorker((message, currentWorker) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			currentWorker.emitMessage({
				type: 'success',
				stdout: '',
				stderr: '',
				diagnostics: []
			});
		});
		const selectedTargets: string[] = [];

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				targetTriple: 'wasm32-wasip2'
			},
			{
				loadManifest: async () => createRuntimeManifestV2(),
				createWorker: () => worker,
				linkBitcode: async (_bitcode, _manifest, targetConfig) => {
					selectedTargets.push(targetConfig.targetTriple);
					return {
						wasm: new Uint8Array([0, 97, 115, 109]),
						targetTriple: targetConfig.targetTriple,
						format: targetConfig.artifactFormat
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(selectedTargets).toEqual(['wasm32-wasip2']);
		expect(result.artifact?.targetTriple).toBe('wasm32-wasip2');
		expect(result.artifact?.format).toBe('component');
	});

	it('selects wasm32-wasip3 when explicitly requested on a v2 runtime manifest', async () => {
		const bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
		const worker = new FakeWorker((message, currentWorker) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			currentWorker.emitMessage({
				type: 'success',
				stdout: '',
				stderr: '',
				diagnostics: []
			});
		});
		const selectedTargets: string[] = [];

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				targetTriple: 'wasm32-wasip3'
			},
			{
				loadManifest: async () => createRuntimeManifestV2(),
				createWorker: () => worker,
				linkBitcode: async (_bitcode, _manifest, targetConfig) => {
					selectedTargets.push(targetConfig.targetTriple);
					return {
						wasm: new Uint8Array([0, 97, 115, 109]),
						targetTriple: targetConfig.targetTriple,
						format: targetConfig.artifactFormat
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(selectedTargets).toEqual(['wasm32-wasip3']);
		expect(result.artifact?.targetTriple).toBe('wasm32-wasip3');
		expect(result.artifact?.format).toBe('component');
	});

	it('stops after the sole transient worker failure and returns it', async () => {
		let createWorkerCalls = 0;

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () =>
					createRuntimeManifest({
						compileTimeoutMs: 1_000,
						artifactIdleMs: 250
					}),
				createWorker: () => {
					createWorkerCalls += 1;
					return new FakeWorker((_, worker) => {
						worker.emitMessage({
							type: 'error',
							message: 'memory access out of bounds'
						});
					});
				},
				sleep: async () => {
					await Promise.resolve();
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('memory access out of bounds');
		expect(createWorkerCalls).toBe(1);
	});

	it('surfaces worker bootstrap filename and location when the browser error event has no message', async () => {
		let createWorkerCalls = 0;

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => {
					createWorkerCalls += 1;
					return new FakeWorker((_, currentWorker) => {
						currentWorker.emitErrorEvent({
							filename: 'http://example.test/wasm-rust/compiler-worker.js',
							lineno: 91,
							colno: 17
						});
					});
				},
				sleep: async () => {
					await Promise.resolve();
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('worker script error at');
		expect(result.stderr).toContain('compiler-worker.js:91:17');
		expect(result.stderr).toContain('[worker=');
		expect(createWorkerCalls).toBe(1);
	});

	it('includes the attempted worker URL when the browser only reports a generic script error', async () => {
		let createWorkerCalls = 0;

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => {
					createWorkerCalls += 1;
					return new FakeWorker((_, currentWorker) => {
						currentWorker.emitErrorEvent({
							message: 'worker script error'
						});
					});
				},
				sleep: async () => {
					await Promise.resolve();
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('worker script error');
		expect(result.stderr).toContain('[worker=');
		expect(result.stderr).toContain('compiler-worker.js');
		expect(createWorkerCalls).toBe(1);
	});
});
