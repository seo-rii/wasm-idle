// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real small modules with different custom-section bytes, not fake Module objects.
const bytes = (id: number) => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 0, 2, 0, id]);
beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('Python immutable runtime module cache', () => {
	it('deduplicates concurrent compilation by actual bytes and evicts the oldest third module', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		const { compilePythonRuntimeModule } =
			await import('../../../packages/core/src/python-runtime-module.js');
		const [first, second] = await Promise.all([
			compilePythonRuntimeModule(bytes(1)),
			compilePythonRuntimeModule(bytes(1))
		]);
		expect(first).toBeInstanceOf(WebAssembly.Module);
		expect(second).toBe(first);
		expect(compile).toHaveBeenCalledTimes(1);
		await compilePythonRuntimeModule(bytes(2));
		await compilePythonRuntimeModule(bytes(3));
		expect(await compilePythonRuntimeModule(bytes(1))).not.toBe(first);
		expect(compile).toHaveBeenCalledTimes(4);
	});

	it('does not poison retries after an engine compile failure', async () => {
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockRejectedValueOnce(new Error('compile failed'));
		const { compilePythonRuntimeModule } =
			await import('../../../packages/core/src/python-runtime-module.js');
		await expect(compilePythonRuntimeModule(bytes(1))).rejects.toThrow('compile failed');
		expect(await compilePythonRuntimeModule(bytes(1))).toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('snapshots caller-owned memory before hashing', async () => {
		const { compilePythonRuntimeModule } =
			await import('../../../packages/core/src/python-runtime-module.js');
		const input = bytes(1);
		const result = compilePythonRuntimeModule(input);
		input[0] = 255;
		expect(await result).toBe(await compilePythonRuntimeModule(bytes(1)));
	});
});
