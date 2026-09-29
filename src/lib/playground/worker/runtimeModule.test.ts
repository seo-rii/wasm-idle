// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

const assets = vi.hoisted(() => ({
	hasWorkerRuntimeModuleBridge: vi.fn(() => true),
	loadWorkerRuntimeModule: vi.fn(),
	loadWorkerRuntimeAsset: vi.fn()
}));
vi.mock('./assets', () => assets);
import { compileWorkerRuntimeAsset, withCachedPyodideModule } from './runtimeModule';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const baseUrl = 'https://assets.test/python/';
let module: WebAssembly.Module;

beforeEach(async () => {
	vi.clearAllMocks();
	assets.hasWorkerRuntimeModuleBridge.mockReturnValue(true);
	module = await WebAssembly.compile(wasm);
	assets.loadWorkerRuntimeModule.mockResolvedValue(module);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('worker runtime modules', () => {
	it('accepts only the host module path when a bridge is configured', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		await expect(compileWorkerRuntimeAsset('pyodide.asm.wasm')).resolves.toBe(module);
		expect(assets.loadWorkerRuntimeModule).toHaveBeenCalledWith('pyodide.asm.wasm');
		expect(compile).not.toHaveBeenCalled();
		expect(assets.loadWorkerRuntimeAsset).not.toHaveBeenCalled();
	});

	it('does not fall back to unverified bytes after a host module failure', async () => {
		assets.loadWorkerRuntimeModule.mockRejectedValueOnce(new Error('receipt mismatch'));
		await expect(compileWorkerRuntimeAsset('pyodide.asm.wasm')).rejects.toThrow(
			'receipt mismatch'
		);
		expect(assets.loadWorkerRuntimeAsset).not.toHaveBeenCalled();
	});

	it.each([false, true])('compiles direct bounded bytes with gzip=%s', async (gzip) => {
		assets.hasWorkerRuntimeModuleBridge.mockReturnValue(false);
		assets.loadWorkerRuntimeAsset.mockResolvedValue({ bytes: gzip ? gzipSync(wasm) : wasm });
		await expect(compileWorkerRuntimeAsset('compiler.wasm')).resolves.toBeInstanceOf(
			WebAssembly.Module
		);
		expect(assets.loadWorkerRuntimeModule).not.toHaveBeenCalled();
	});

	it('instantiates only the exact Pyodide bootstrap from the host module and preserves imports', async () => {
		const nativeFetch = vi.fn(async () => new Response(wasm));
		vi.stubGlobal('fetch', nativeFetch);
		const nativeStreaming = vi.spyOn(WebAssembly, 'instantiateStreaming');
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const imports = { sentinel: {} };
		const result = await withCachedPyodideModule(baseUrl, async () => {
			const unrelated = await fetch(`${baseUrl}other.wasm`);
			expect(await unrelated.arrayBuffer()).toEqual(wasm.buffer);
			return await WebAssembly.instantiateStreaming(
				fetch(`${baseUrl}pyodide.asm.wasm`),
				imports
			);
		});
		expect(result.module).toBe(module);
		expect(result.instance).toBeInstanceOf(WebAssembly.Instance);
		expect(instantiate).toHaveBeenCalledWith(module, imports);
		expect(nativeFetch).toHaveBeenCalledTimes(1);
		expect(nativeFetch).toHaveBeenCalledWith(`${baseUrl}other.wasm`, undefined);
		expect(nativeStreaming).not.toHaveBeenCalled();
		expect(globalThis.fetch).toBe(nativeFetch);
		expect(WebAssembly.instantiateStreaming).toBe(nativeStreaming);
	});

	it('leaves unrelated streaming instantiations alone during initialization', async () => {
		const streaming = vi.spyOn(WebAssembly, 'instantiateStreaming');
		await withCachedPyodideModule(baseUrl, async () => {
			const response = new Response(wasm, {
				headers: { 'content-type': 'application/wasm' }
			});
			const result = await WebAssembly.instantiateStreaming(response);
			expect(result.instance).toBeInstanceOf(WebAssembly.Instance);
		});
		expect(streaming).toHaveBeenCalledOnce();
	});

	it('restores bootstrap hooks on initialization failure', async () => {
		const fetch = globalThis.fetch;
		const streaming = WebAssembly.instantiateStreaming;
		await expect(
			withCachedPyodideModule(baseUrl, async () => {
				throw new Error('bootstrap failed');
			})
		).rejects.toThrow('bootstrap failed');
		expect(globalThis.fetch).toBe(fetch);
		expect(WebAssembly.instantiateStreaming).toBe(streaming);
	});

	it('propagates a compilation failure before entering the runtime bootstrap', async () => {
		const initialize = vi.fn();
		assets.loadWorkerRuntimeModule.mockRejectedValueOnce(new Error('bad wasm'));
		await expect(withCachedPyodideModule(baseUrl, initialize)).rejects.toThrow('bad wasm');
		expect(initialize).not.toHaveBeenCalled();
	});
});
