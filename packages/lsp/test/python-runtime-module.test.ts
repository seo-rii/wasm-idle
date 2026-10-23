import { afterEach, expect, it, vi } from 'vitest';
import { withPythonRuntimeModule } from '../src/python/runtime-module.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('substitutes only the owned bootstrap response and creates fresh instances', async () => {
	const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
	const unrelated = new Response('unrelated');
	const fetch = vi.fn().mockResolvedValue(unrelated);
	vi.stubGlobal('fetch', fetch);
	const originalStreaming = vi
		.spyOn(WebAssembly, 'instantiateStreaming')
		.mockRejectedValue(new Error('unrelated path'));
	const initialize = () =>
		withPythonRuntimeModule('https://runtime.test/pyodide/', module, async () => {
			const response = await globalThis.fetch(
				'https://runtime.test/pyodide/pyodide.asm.wasm'
			);
			const result = await WebAssembly.instantiateStreaming(response, {});
			expect(result.module).toBe(module);
			await expect(WebAssembly.instantiateStreaming(unrelated, {})).rejects.toThrow(
				'unrelated path'
			);
			return result.instance;
		});
	expect(await initialize()).not.toBe(await initialize());
	expect(fetch).not.toHaveBeenCalled();
	expect(originalStreaming).toHaveBeenCalledTimes(2);
	expect(globalThis.fetch).toBe(fetch);
	expect(WebAssembly.instantiateStreaming).toBe(originalStreaming);
});

it('restores hooks after initialization fails', async () => {
	const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
	const fetch = globalThis.fetch,
		instantiate = WebAssembly.instantiateStreaming;
	await expect(
		withPythonRuntimeModule('https://runtime.test/', module, async () => {
			throw new Error('load failed');
		})
	).rejects.toThrow('load failed');
	expect(globalThis.fetch).toBe(fetch);
	expect(WebAssembly.instantiateStreaming).toBe(instantiate);
});
