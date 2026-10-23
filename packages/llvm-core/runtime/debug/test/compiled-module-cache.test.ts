import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompiledDebugModuleCache } from '../src/compiled-module-cache.js';
import { compiledModuleFactoryOptions } from '../src/worker/module-loader.js';

const wasm = (tag = 65) => Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 0, 2, 1, tag).buffer;
const digest = (bytes: ArrayBuffer) =>
	createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

afterEach(() => vi.restoreAllMocks());

describe('immutable debug runtime modules', () => {
	it('joins concurrent compiles and reuses the same immutable module', async () => {
		const cache = new CompiledDebugModuleCache();
		const bytes = wasm();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = cache.compile(digest(bytes), bytes);
		const second = cache.compile(digest(bytes), bytes.slice(0));
		expect(first).toBe(second);
		expect(await first).toBe(await second);
		expect(await cache.compile(digest(bytes), bytes)).toBe(await first);
		expect(compile).toHaveBeenCalledTimes(1);
	});

	it('evicts least-recently used code by entry and source-byte budgets', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		for (const cache of [
			new CompiledDebugModuleCache(2, 100),
			new CompiledDebugModuleCache(4, 24)
		]) {
			const [a, b, c] = [wasm(65), wasm(66), wasm(67)];
			const first = await cache.compile(digest(a), a);
			await cache.compile(digest(b), b);
			expect(await cache.compile(digest(a), a)).toBe(first);
			await cache.compile(digest(c), c);
			expect(await cache.compile(digest(a), a)).toBe(first);
			await cache.compile(digest(b), b);
		}
		expect(compile).toHaveBeenCalledTimes(8);
	});

	it('does not retain entries larger than the cache budget', async () => {
		const cache = new CompiledDebugModuleCache(2, 8);
		const bytes = wasm();
		const first = await cache.compile(digest(bytes), bytes);
		expect(await cache.compile(digest(bytes), bytes)).not.toBe(first);
	});

	it('removes rejected compilation so a later attempt can succeed', async () => {
		const cache = new CompiledDebugModuleCache();
		const bytes = wasm();
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockRejectedValueOnce(new Error('compile failed'));
		await expect(cache.compile(digest(bytes), bytes)).rejects.toThrow('compile failed');
		await expect(cache.compile(digest(bytes), bytes)).resolves.toBeInstanceOf(
			WebAssembly.Module
		);
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('uses a new instance and memory for every factory callback', () => {
		const bytes = Uint8Array.of(
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0,
			5,
			3,
			1,
			0,
			1,
			7,
			10,
			1,
			6,
			109,
			101,
			109,
			111,
			114,
			121,
			2,
			0
		);
		const module = new WebAssembly.Module(bytes);
		const hook = compiledModuleFactoryOptions(module).instantiateWasm!;
		const receive = vi.fn();
		const a = hook({}, receive).memory as WebAssembly.Memory;
		new Uint8Array(a.buffer)[0] = 91;
		const b = hook({}, receive).memory as WebAssembly.Memory;
		expect(a).not.toBe(b);
		expect(new Uint8Array(b.buffer)[0]).toBe(0);
		expect(receive).toHaveBeenCalledTimes(2);
		expect(receive.mock.calls[0][0]).not.toBe(receive.mock.calls[1][0]);
		expect(receive.mock.calls.every(([, runtime]) => runtime === module)).toBe(true);
	});

	it('honors fresh imported memory instead of retaining prior imports', () => {
		const bytes = Uint8Array.of(
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0,
			2,
			15,
			1,
			3,
			101,
			110,
			118,
			6,
			109,
			101,
			109,
			111,
			114,
			121,
			2,
			0,
			1,
			7,
			10,
			1,
			6,
			109,
			101,
			109,
			111,
			114,
			121,
			2,
			0
		);
		const module = new WebAssembly.Module(bytes);
		const hook = compiledModuleFactoryOptions(module).instantiateWasm!;
		const first = new WebAssembly.Memory({ initial: 1 });
		const second = new WebAssembly.Memory({ initial: 1 });
		new Uint8Array(first.buffer)[0] = 37;
		expect(hook({ env: { memory: first } }, vi.fn()).memory).toBe(first);
		expect(hook({ env: { memory: second } }, vi.fn()).memory).toBe(second);
		expect(new Uint8Array(second.buffer)[0]).toBe(0);
	});

	it('leaves legacy factories untouched and rejects invalid module messages', () => {
		expect(compiledModuleFactoryOptions(undefined)).toEqual({});
		expect(() => compiledModuleFactoryOptions({} as WebAssembly.Module)).toThrow(
			'WebAssembly.Module'
		);
	});
});
