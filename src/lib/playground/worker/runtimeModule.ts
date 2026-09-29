import { decompressGzip } from '@wasm-idle/llvm-core';
import {
	hasWorkerRuntimeModuleBridge,
	loadWorkerRuntimeAsset,
	loadWorkerRuntimeModule
} from './assets';

/** The host compiles trusted runtime assets; workers never populate the shared module cache. */
export async function compileWorkerRuntimeAsset(asset: string): Promise<WebAssembly.Module> {
	if (hasWorkerRuntimeModuleBridge()) return await loadWorkerRuntimeModule(asset);
	const { bytes } = await loadWorkerRuntimeAsset(asset);
	const wasm = bytes[0] === 0x1f && bytes[1] === 0x8b ? await decompressGzip(bytes) : bytes;
	return await WebAssembly.compile(wasm.slice().buffer);
}

/**
 * Pyodide 0.29.3 creates its own instantiateWasm hook, including its sentinel imports.
 * Intercept only the exact bootstrap fetch/Response during initialization so those imports
 * remain intact. Other Wasm (including the sentinel) and all package fetches are untouched.
 */
export async function withCachedPyodideModule<T>(
	baseUrl: string,
	initialize: () => Promise<T>
): Promise<T> {
	const runtimeUrl = new URL('pyodide.asm.wasm', baseUrl).href;
	// Compile before entering Pyodide, whose bootstrap catches instantiation failures internally.
	const module = await compileWorkerRuntimeAsset('pyodide.asm.wasm');
	const previousFetch = globalThis.fetch;
	const previousInstantiateStreaming = WebAssembly.instantiateStreaming;
	const responses = new WeakSet<Response>();
	const fetchRuntime: typeof fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : new URL(String(input), baseUrl).href;
		if (url !== runtimeUrl) return await previousFetch(input, init);
		const response = new Response(null, { headers: { 'content-type': 'application/wasm' } });
		responses.add(response);
		return response;
	};
	const instantiateRuntime: typeof WebAssembly.instantiateStreaming = async (source, imports) => {
		const response = await source;
		if (!responses.has(response)) return await previousInstantiateStreaming(response, imports);
		return { module, instance: await WebAssembly.instantiate(module, imports) };
	};
	globalThis.fetch = fetchRuntime;
	WebAssembly.instantiateStreaming = instantiateRuntime;
	try {
		return await initialize();
	} finally {
		if (globalThis.fetch === fetchRuntime) globalThis.fetch = previousFetch;
		if (WebAssembly.instantiateStreaming === instantiateRuntime) {
			WebAssembly.instantiateStreaming = previousInstantiateStreaming;
		}
	}
}
