import { describe, expect, it, vi } from 'vitest';
import { compiledModuleInstantiation } from '../src/worker/module-loader.js';

// Core module exporting one mutable i32 global, initialized to zero.
const bytes = Uint8Array.of(
	0,
	97,
	115,
	109,
	1,
	0,
	0,
	0,
	6,
	6,
	1,
	127,
	1,
	65,
	0,
	11,
	7,
	9,
	1,
	5,
	118,
	97,
	108,
	117,
	101,
	3,
	0
);

describe('immutable debugger module cache', () => {
	it('shares compilation, creates fresh mutable instances, and evicts old revisions', async () => {
		vi.resetModules();
		const { compileVerifiedDebugModule } = await import('../src/runtime-module-cache.js');
		const compile = vi.spyOn(WebAssembly, 'compile');
		try {
			const first = compileVerifiedDebugModule('one', bytes.buffer);
			expect(compileVerifiedDebugModule('one', bytes.buffer)).toBe(first);
			const module = await first;
			const receive = vi.fn();
			const instantiate = compiledModuleInstantiation(module).instantiateWasm!;
			const a = instantiate({}, receive);
			(a.value as WebAssembly.Global).value = 42;
			const b = instantiate({}, receive);
			expect((b.value as WebAssembly.Global).value).toBe(0);
			expect(receive.mock.calls[0][0]).not.toBe(receive.mock.calls[1][0]);
			await compileVerifiedDebugModule('two', bytes.buffer);
			await compileVerifiedDebugModule('three', bytes.buffer);
			expect(await compileVerifiedDebugModule('one', bytes.buffer)).not.toBe(module);
			expect(compile).toHaveBeenCalledTimes(4);
		} finally {
			compile.mockRestore();
		}
	});
	it('does not poison a revision after a failed compilation', async () => {
		vi.resetModules();
		const { compileVerifiedDebugModule } = await import('../src/runtime-module-cache.js');
		await expect(compileVerifiedDebugModule('retry', new ArrayBuffer(0))).rejects.toThrow();
		await expect(compileVerifiedDebugModule('retry', bytes.buffer)).resolves.toBeInstanceOf(
			WebAssembly.Module
		);
	});
});
