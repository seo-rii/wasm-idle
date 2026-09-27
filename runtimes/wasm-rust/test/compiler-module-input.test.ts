import { afterEach, expect, it, vi } from 'vitest';
import { compileRustcModule } from '../src/compiler-worker.js';

const moduleBytes = () => new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0,
	1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
	7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0,
	10, 6, 1, 4, 0, 65, 42, 11
]);

afterEach(() => vi.restoreAllMocks());

it('compiles and executes a native Wasm module from the owned asset buffer', async () => {
	const input = moduleBytes();
	const compile = vi.spyOn(WebAssembly, 'compile');
	const module = await compileRustcModule(input);
	const argument = compile.mock.calls[0]![0] as Uint8Array;
	expect(argument.buffer).toBe(input.buffer);
	expect(argument.byteOffset).toBe(input.byteOffset);
	expect(argument.byteLength).toBe(input.byteLength);
	const instance = await WebAssembly.instantiate(module);
	expect((instance.exports.answer as () => number)()).toBe(42);
});

it('preserves the exact range when the asset is a typed-array subview', async () => {
	const bytes = moduleBytes();
	const storage = new Uint8Array(bytes.length + 32).fill(255);
	storage.set(bytes, 12);
	const input = storage.subarray(12, 12 + bytes.length);
	const compile = vi.spyOn(WebAssembly, 'compile');
	const module = await compileRustcModule(input);
	const argument = compile.mock.calls[0]![0] as Uint8Array;
	expect(argument.buffer).toBe(storage.buffer);
	expect(argument.byteOffset).toBe(12);
	expect(argument.byteLength).toBe(bytes.length);
	expect(((await WebAssembly.instantiate(module)).exports.answer as () => number)()).toBe(42);
});

it('snapshots shared-memory input instead of passing mutable shared bytes to the engine', async () => {
	const bytes = moduleBytes();
	const shared = new Uint8Array(new SharedArrayBuffer(bytes.length + 16));
	shared.set(bytes, 8);
	const input = shared.subarray(8, 8 + bytes.length);
	const compile = vi.spyOn(WebAssembly, 'compile');
	const pending = compileRustcModule(input);
	shared.fill(0);
	const module = await pending;
	const argument = compile.mock.calls[0]![0] as Uint8Array;
	expect(argument.buffer).toBeInstanceOf(ArrayBuffer);
	expect(argument.buffer).not.toBe(shared.buffer);
	expect(Array.from(argument)).toEqual(Array.from(bytes));
	expect(((await WebAssembly.instantiate(module)).exports.answer as () => number)()).toBe(42);
});

it('lets the engine reject malformed input without instantiation', async () => {
	const instantiate = vi.spyOn(WebAssembly, 'instantiate');
	await expect(compileRustcModule(new Uint8Array([1, 2, 3]))).rejects.toThrow();
	expect(instantiate).not.toHaveBeenCalled();
});

it('does not allocate another asset-sized buffer before calling the engine', async () => {
	const input = new Uint8Array(75_000_000);
	const sentinel = new Error('stop before native compile');
	const compile = vi.spyOn(WebAssembly, 'compile').mockRejectedValue(sentinel);
	await expect(compileRustcModule(input)).rejects.toBe(sentinel);
	const argument = compile.mock.calls[0]![0] as Uint8Array;
	expect(argument.buffer).toBe(input.buffer);
	expect(argument.byteLength).toBe(input.byteLength);
});
