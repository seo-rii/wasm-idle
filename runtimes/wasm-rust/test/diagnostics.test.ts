import { describe, expect, it } from 'vitest';

import { compileRust } from '../src/compiler.js';
import { FakeWorker, createRuntimeManifest } from './helpers.js';

describe('wasm-rust failures and request validation', () => {
	it('rejects unsupported request configuration before spawning rustc', async () => {
		await expect(
			compileRust({
				code: 'fn main() { println!("hi"); }',
				edition: '2018',
				crateType: 'bin'
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: false,
				stderr: expect.stringContaining('unsupported browser compiler edition')
			})
		);

		await expect(
			compileRust({
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'lib'
			})
		).resolves.toEqual(
			expect.objectContaining({
				success: false,
				stderr: expect.stringContaining('unsupported browser compiler crate type')
			})
		);
	});

	it('returns worker stderr when rustc fails before emitting bitcode', async () => {
		const worker = new FakeWorker((_, instance) => {
			instance.emitMessage({
				type: 'result',
				exitCode: 1,
				stdout: '',
				stderr: 'error: expected `;`'
			});
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi") }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('expected `;`');
	});

	it('returns worker bootstrap errors directly', async () => {
		const worker = new FakeWorker((_, instance) => {
			instance.emitError(new Error('failed to fetch rustc.wasm'));
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin'
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('failed to fetch rustc.wasm');
	});
});
