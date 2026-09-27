import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileOwnedRustcModule } from '../src/rustc-module.js';

// An actual Wasm module exporting answer(): i32 = 42.
const bytes = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119,
	101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11
]);
async function answer(module: WebAssembly.Module) {
	const instance = await WebAssembly.instantiate(module);
	return (instance.exports.answer as () => number)();
}
afterEach(() => vi.restoreAllMocks());

describe('owned rustc module bytes', () => {
	it('passes the existing private view to native compilation without another JS copy', async () => {
		const spy = vi.spyOn(WebAssembly, 'compile');
		expect(await answer(await compileOwnedRustcModule(bytes))).toBe(42);
		expect(spy.mock.calls[0]![0]).toBe(bytes);
	});
	it('does not include prefix or suffix bytes outside a nonzero-offset view', async () => {
		const storage = new Uint8Array(bytes.length + 20).fill(255);
		storage.set(bytes, 7);
		const view = storage.subarray(7, 7 + bytes.length);
		const spy = vi.spyOn(WebAssembly, 'compile');
		expect(await answer(await compileOwnedRustcModule(view))).toBe(42);
		expect(spy.mock.calls[0]![0]).toBe(view);
	});
	it('retains the native snapshot when the caller mutates the input after invocation', async () => {
		const owned = bytes.slice();
		const operation = compileOwnedRustcModule(owned);
		owned.fill(255);
		expect(await answer(await operation)).toBe(42);
	});
	it('copies a shared input into an ordinary buffer before compiling', async () => {
		const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
		shared.set(bytes);
		const spy = vi.spyOn(WebAssembly, 'compile');
		const operation = compileOwnedRustcModule(shared);
		shared.fill(255);
		expect(await answer(await operation)).toBe(42);
		const supplied = spy.mock.calls[0]![0] as Uint8Array;
		expect(supplied.buffer).toBeInstanceOf(ArrayBuffer);
		expect(supplied.buffer).not.toBe(shared.buffer);
	});
	it('rejects malformed and empty modules rather than accepting a partial byte view', async () => {
		await expect(compileOwnedRustcModule(new Uint8Array())).rejects.toBeInstanceOf(
			WebAssembly.CompileError
		);
		await expect(compileOwnedRustcModule(bytes.subarray(0, 10))).rejects.toBeInstanceOf(
			WebAssembly.CompileError
		);
	});
	it('supports more than one independent compilation and instance', async () => {
		const modules = await Promise.all([
			compileOwnedRustcModule(bytes),
			compileOwnedRustcModule(bytes)
		]);
		expect(await Promise.all(modules.map(answer))).toEqual([42, 42]);
	});
});
