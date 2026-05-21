import { describe, expect, it, vi } from 'vitest';

import { compileRust } from '../src/compiler.js';
import { markWorkerFailure } from '../src/worker-status.js';
import {
	FakeWorker,
	createRuntimeManifest,
	createRuntimeManifestV2,
	mirrorBitcode
} from './helpers.js';

function createRetryDependencies(workers: FakeWorker[]) {
	let clock = 0;
	let nextWorker = 0;

	return {
		dependencies: {
			loadManifest: async () =>
				createRuntimeManifest({
					compileTimeoutMs: 1_000,
					artifactIdleMs: 500
				}),
			createWorker: () => {
				const worker = workers[nextWorker];
				nextWorker += 1;
				if (!worker) {
					throw new Error('unexpected extra worker request');
				}
				return worker;
			},
			now: () => clock,
			sleep: async (milliseconds: number) => {
				await Promise.resolve();
				clock += milliseconds;
			}
		}
	};
}

describe('compileRust retry behavior', () => {
	it('retries after a transient timeout and succeeds on the next worker attempt', async () => {
		const bitcode = new Uint8Array([1, 2, 3, 4]);
		const firstWorker = new FakeWorker();
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});
		const linkBitcodeCalls: Uint8Array[] = [];

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2021',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async (receivedBitcode) => {
					linkBitcodeCalls.push(receivedBitcode);
					return {
						wasm: new Uint8Array([9, 8, 7]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([9, 8, 7]));
		expect(linkBitcodeCalls).toEqual([bitcode]);
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('retries after a transient memory-access worker failure and succeeds on the next attempt', async () => {
		const bitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'error',
				message: 'memory access out of bounds'
			});
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([7, 7, 7]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([7, 7, 7]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('preserves failed attempt logs when a later retry succeeds', async () => {
		const bitcode = new Uint8Array([0x13, 0x37, 0x13, 0x37]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'log',
				message: '[wasm-rust:compiler-worker] first attempt warmup'
			});
			worker.emitMessage({
				type: 'error',
				message: 'memory access out of bounds'
			});
		});
		const secondWorker = new FakeWorker((message, worker) => {
			worker.emitMessage({
				type: 'log',
				message: '[wasm-rust:compiler-worker] second attempt ready'
			});
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				log: true
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([3, 1, 4, 1]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.logs).toEqual(
			expect.arrayContaining([
				'[wasm-rust:compiler-worker] first attempt warmup',
				'[wasm-rust] browser rustc attempt 1/5 failed; retrying',
				'[wasm-rust:compiler-worker] second attempt ready'
			])
		);
		expect(result.logRecords).toEqual(
			expect.arrayContaining([
				{
					level: 'log',
					message: '[wasm-rust:compiler-worker] first attempt warmup'
				},
				{
					level: 'warn',
					message: '[wasm-rust] browser rustc attempt 1/5 failed; retrying'
				}
			])
		);
		expect(result.logs?.indexOf('[wasm-rust:compiler-worker] first attempt warmup')).toBeLessThan(
			result.logs?.indexOf('[wasm-rust] browser rustc attempt 1/5 failed; retrying') ?? -1
		);
	});

	it('waits for mirrored bitcode after a helper-thread failure report before giving up on the attempt', async () => {
		const bitcode = new Uint8Array([0xba, 0xdc, 0x0f, 0xfe]);
		const worker = new FakeWorker((message, currentWorker) => {
			markWorkerFailure(
				message.sharedStatusBuffer,
				'browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds'
			);
			setTimeout(() => {
				mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
				currentWorker.emitMessage({
					type: 'result',
					exitCode: 0,
					stdout: 'worker stdout',
					stderr: ''
				});
			}, 50);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				targetTriple: 'wasm32-wasip2',
				log: true
			},
			{
				loadManifest: async () =>
					createRuntimeManifestV2({
						compileTimeoutMs: 2_000,
						artifactIdleMs: 200
					}),
				createWorker: () => worker,
				now: () => Date.now(),
				sleep: async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
				},
				linkBitcode: async (receivedBitcode) => {
					expect(receivedBitcode).toEqual(bitcode);
					return {
						wasm: new Uint8Array([4, 2, 4, 2]),
						targetTriple: 'wasm32-wasip2',
						format: 'component'
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual({
			wasm: new Uint8Array([4, 2, 4, 2]),
			targetTriple: 'wasm32-wasip2',
			format: 'component'
		});
		expect(result.stdout).toContain('worker stdout');
		expect(result.stdout).not.toContain('memory access out of bounds');
		expect(worker.terminated).toBe(true);
	});

	it('waits for mirrored bitcode after the compile worker settles with a helper-thread failure once the bitcode file was already truncated', async () => {
		const bitcode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
		const worker = new FakeWorker((message, currentWorker) => {
			const state = new Int32Array(message.sharedBitcodeBuffer, 0, 4);
			Atomics.store(state, 0, 0);
			Atomics.store(state, 1, 0);
			Atomics.store(state, 2, 1);
			currentWorker.emitMessage({
				type: 'error',
				message: 'browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds'
			});
			setTimeout(() => {
				mirrorBitcode(message.sharedBitcodeBuffer, bitcode, 2);
			}, 50);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!(\"hi\"); }',
				edition: '2024',
				crateType: 'bin',
				targetTriple: 'wasm32-wasip2',
				log: true
			},
			{
				loadManifest: async () =>
					createRuntimeManifestV2({
						compileTimeoutMs: 2_000,
						artifactIdleMs: 200
					}),
				createWorker: () => worker,
				now: () => Date.now(),
				sleep: async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
				},
				linkBitcode: async (receivedBitcode) => {
					expect(receivedBitcode).toEqual(bitcode);
					return {
						wasm: new Uint8Array([0x20, 0x24]),
						targetTriple: 'wasm32-wasip2',
						format: 'component'
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual({
			wasm: new Uint8Array([0x20, 0x24]),
			targetTriple: 'wasm32-wasip2',
			format: 'component'
		});
		expect(result.stdout).toBeUndefined();
		expect(worker.terminated).toBe(true);
	});

	it('retries after a transient worker bootstrap script error and succeeds on the next attempt', async () => {
		const bitcode = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitErrorEvent({
				message: 'worker script error',
				filename: 'https://example.test/wasm-rust/compiler-worker.js',
				lineno: 88,
				colno: 24
			});
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!(\"hi\"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([6, 6, 6, 6]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([6, 6, 6, 6]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('retries when the worker provides a structured transient failure kind', async () => {
		const bitcode = new Uint8Array([0xde, 0xad, 0xfa, 0xce]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'error',
				message: 'generic transient worker failure',
				failureKind: 'helper-thread'
			} as any);
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!(\"hi\"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([8, 6, 7, 5]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([8, 6, 7, 5]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('retries when the worker provides a structured stale-runtime-metadata failure kind', async () => {
		const bitcode = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'error',
				message: 'transient metadata decode mismatch',
				failureKind: 'stale-runtime-metadata'
			} as any);
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!(\"hi\"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([2, 4, 6, 8]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([2, 4, 6, 8]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('does not emit console errors for transient bootstrap failures that succeed on retry', async () => {
		const bitcode = new Uint8Array([0xfa, 0xce, 0xb0, 0x0c]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitErrorEvent({
				message: 'worker script error',
				filename: 'https://example.test/wasm-rust/compiler-worker.js',
				lineno: 88,
				colno: 24
			});
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		try {
			const result = await compileRust(
				{
					code: 'fn main() { println!(\"hi\"); }',
					edition: '2024',
					crateType: 'bin',
					log: true
				},
				{
					...createRetryDependencies([firstWorker, secondWorker]).dependencies,
					linkBitcode: async () => ({
						wasm: new Uint8Array([6, 6, 6, 6]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					})
				}
			);

			expect(result.success).toBe(true);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('[wasm-rust] browser rustc attempt 1/5 failed; retrying')
			);
			expect(debugSpy).not.toHaveBeenCalledWith(
				expect.stringContaining('[wasm-rust] compile worker bootstrap failed')
			);
		} finally {
			errorSpy.mockRestore();
			debugSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});

	it('does not retry non-transient worker failures', async () => {
		const firstWorker = new FakeWorker((_, currentWorker) => {
			currentWorker.emitMessage({
				type: 'error',
				message: 'syntax error: expected `;`'
			});
		});
		const secondWorker = new FakeWorker();
		const retryDependencies = createRetryDependencies([firstWorker, secondWorker]);
		let createWorkerCalls = 0;
		const originalCreateWorker = retryDependencies.dependencies.createWorker!;

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi") }',
				edition: '2021',
				crateType: 'bin'
			},
			{
				...retryDependencies.dependencies,
				createWorker: () => {
					createWorkerCalls += 1;
					return originalCreateWorker(new URL('http://example.test/compiler-worker.js'));
				},
				linkBitcode: async () => {
					throw new Error('linker should not run for non-transient failures');
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toBe('syntax error: expected `;`');
		expect(result.diagnostics).toBeUndefined();
		expect(result.stdout).toBeUndefined();
		expect(result.logs).toBeUndefined();
		expect(createWorkerCalls).toBe(1);
	});

	it('retries helper-thread exhaustion errors instead of waiting for the full timeout path', async () => {
		const bitcode = new Uint8Array([9, 9, 9, 9]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'error',
				message: 'rustc browser thread pool exhausted in worker'
			});
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([1, 2, 3, 4]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([1, 2, 3, 4]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('retries after a transient rust metadata decode panic and succeeds on the next attempt', async () => {
		const bitcode = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
		const firstWorker = new FakeWorker((_, worker) => {
			worker.emitMessage({
				type: 'result',
				exitCode: 101,
				stdout: '',
				stderr: [
					'error[E0786]: found invalid metadata files for crate `core` which `std` depends on',
					"thread 'main' panicked at invalid enum variant tag while decoding `TargetTriple`",
					'error: the compiler unexpectedly panicked. this is a bug.'
				].join('\n')
			});
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'use std::io::{self, Read}; fn main() { let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap(); print!(\"{input}\"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([5, 4, 3, 2]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([5, 4, 3, 2]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('retries immediately when a helper thread marks the shared status buffer as failed', async () => {
		const bitcode = new Uint8Array([7, 1, 7, 1]);
		const firstWorker = new FakeWorker((message) => {
			const state = new Int32Array(message.sharedStatusBuffer);
			Atomics.store(state, 0, 1);
			Atomics.store(state, 1, 1);
		});
		const secondWorker = new FakeWorker((message) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([firstWorker, secondWorker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([4, 4, 4, 4]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([4, 4, 4, 4]));
		expect(firstWorker.terminated).toBe(true);
		expect(secondWorker.terminated).toBe(true);
	});

	it('links mirrored bitcode even when the compile worker settles with an error', async () => {
		const bitcode = new Uint8Array([0xaa, 0xbb, 0xcc]);
		const worker = new FakeWorker((message, currentWorker) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			currentWorker.emitMessage({
				type: 'error',
				message: 'memory access out of bounds',
				stdout: 'worker stdout'
			});
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2021',
				crateType: 'bin'
			},
			{
				...createRetryDependencies([worker]).dependencies,
				linkBitcode: async (receivedBitcode) => {
					expect(receivedBitcode).toEqual(bitcode);
					return {
						wasm: new Uint8Array([5, 4, 3, 2]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.stdout).toContain('worker stdout');
		expect(result.stdout).not.toContain('[wasm-rust] worker errored with mirrored bitcode present');
		expect(result.logs).toBeUndefined();
		expect(result.diagnostics).toBeUndefined();
		expect(result.artifact).toEqual({
			wasm: new Uint8Array([5, 4, 3, 2]),
			targetTriple: 'wasm32-wasip1',
			format: 'core-wasm'
		});
		expect(worker.terminated).toBe(true);
	});

	it('returns compile worker log lines separately from stdout when log is enabled', async () => {
		const bitcode = new Uint8Array([0x10, 0x20, 0x30]);
		const worker = new FakeWorker((message, currentWorker) => {
			currentWorker.emitMessage({
				type: 'log',
				message: '[wasm-rust:compiler-worker] start target=wasm32-wasip1 timeout=1000ms'
			});
			currentWorker.emitMessage({
				type: 'log',
				message: '[wasm-rust:compiler-worker] rustc instance ready'
			});
			currentWorker.emitMessage({
				type: 'result',
				exitCode: 0,
				stdout: 'worker stdout\n',
				stderr: ''
			});
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				log: true
			},
			{
				...createRetryDependencies([worker]).dependencies,
				linkBitcode: async () => ({
					wasm: new Uint8Array([8, 8, 8, 8]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.logs).toContain(
			'[wasm-rust:compiler-worker] start target=wasm32-wasip1 timeout=1000ms'
		);
		expect(result.logs).toContain('[wasm-rust:compiler-worker] rustc instance ready');
		expect(result.logRecords).toEqual(
			expect.arrayContaining([
				{
					level: 'log',
					message: '[wasm-rust:compiler-worker] start target=wasm32-wasip1 timeout=1000ms'
				},
				{
					level: 'log',
					message: '[wasm-rust:compiler-worker] rustc instance ready'
				}
			])
		);
		expect(result.stdout).toBe('worker stdout\n');
	});
});
