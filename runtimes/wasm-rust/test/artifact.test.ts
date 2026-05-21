import { describe, expect, it } from 'vitest';

import { compileRust } from '../src/compiler.js';
import { FakeWorker, createRuntimeManifest, mirrorBitcode } from './helpers.js';

describe('wasm-rust artifact handling', () => {
	it('prefers the mirrored bitcode when the worker settles after emitting it', async () => {
		const bitcode = new Uint8Array([11, 22, 33]);
		const worker = new FakeWorker((message, instance) => {
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			instance.emitMessage({
				type: 'result',
				exitCode: 0,
				stdout: '',
				stderr: 'memory access out of bounds'
			});
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
				linkBitcode: async (receivedBitcode) => {
					expect(receivedBitcode).toEqual(bitcode);
					return {
						wasm: new Uint8Array([5, 4, 3, 2, 1]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					};
				}
			}
		);

		expect(worker.terminated).toBe(true);
		expect(result.success).toBe(true);
		expect(result.stderr).toBeUndefined();
		expect(result.artifact?.wasm).toEqual(new Uint8Array([5, 4, 3, 2, 1]));
		expect(result.artifact?.targetTriple).toBe('wasm32-wasip1');
		expect(result.artifact?.format).toBe('core-wasm');
	});

	it('fails when the mirrored bitcode buffer overflows', async () => {
		let clock = 0;
		const worker = new FakeWorker((message) => {
			const state = new Int32Array(message.sharedBitcodeBuffer, 0, 4);
			Atomics.store(state, 0, 0);
			Atomics.store(state, 1, 1);
			Atomics.store(state, 2, 1);
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest({ artifactIdleMs: 250 }),
				createWorker: () => worker,
				now: () => clock,
				sleep: async (milliseconds) => {
					clock += milliseconds;
				}
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('mirrored bitcode buffer overflowed');
	});
});
