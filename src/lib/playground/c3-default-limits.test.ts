import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaygroundBinding, DEFAULT_EXECUTION_LIMITS, type Sandbox } from '@wasm-idle/core';
import C3 from './c3';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

afterEach(() => vi.restoreAllMocks());

describe('C3 memory profile at the Core binding boundary', () => {
	it('applies the C3 1 GiB default to both bound load and run', async () => {
		const sandbox = new C3();
		const load = vi.spyOn(sandbox, 'load').mockResolvedValue();
		const run = vi.spyOn(sandbox, 'run').mockResolvedValue(true);
		const binding = createPlaygroundBinding('', async () => sandbox as Sandbox);
		try {
			const bound = await binding.load('C3');
			await bound.load();
			await bound.run('', false);
			expect(load.mock.calls[0][4]?.limits?.maxWasmMemoryBytes).toBe(1024 ** 3);
			expect(run.mock.calls[0][5]?.limits?.maxWasmMemoryBytes).toBe(1024 ** 3);
		} finally {
			await binding.dispose();
		}
	});

	it('preserves an explicit lower caller limit at both boundaries', async () => {
		const sandbox = new C3();
		const load = vi.spyOn(sandbox, 'load').mockResolvedValue();
		const run = vi.spyOn(sandbox, 'run').mockResolvedValue(true);
		const binding = createPlaygroundBinding('', async () => sandbox as Sandbox);
		try {
			const bound = await binding.load('C3');
			const limits = { maxWasmMemoryBytes: 64 * 1024 ** 2 };
			await bound.load('', false, [], { limits });
			await bound.run('', false, false, undefined, [], { limits });
			expect(load.mock.calls[0][4]?.limits?.maxWasmMemoryBytes).toBe(
				limits.maxWasmMemoryBytes
			);
			expect(run.mock.calls[0][5]?.limits?.maxWasmMemoryBytes).toBe(
				limits.maxWasmMemoryBytes
			);
		} finally {
			await binding.dispose();
		}
	});

	it('keeps the 512 MiB default for runtimes without an opt-in profile', async () => {
		const load = vi.fn(async () => {});
		const run = vi.fn(async () => true);
		const sandbox = { load, run, eof() {}, terminate() {}, async clear() {} } as Sandbox;
		const binding = createPlaygroundBinding('', async () => sandbox);
		try {
			const bound = await binding.load('C');
			await bound.load();
			await bound.run('', false);
			expect(DEFAULT_EXECUTION_LIMITS.maxWasmMemoryBytes).toBe(512 * 1024 ** 2);
			expect((load.mock.calls as unknown[][])[0][4]).toMatchObject({
				limits: { maxWasmMemoryBytes: 512 * 1024 ** 2 }
			});
			expect((run.mock.calls as unknown[][])[0][5]).toMatchObject({
				limits: { maxWasmMemoryBytes: 512 * 1024 ** 2 }
			});
		} finally {
			await binding.dispose();
		}
	});
});
