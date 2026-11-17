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

export interface CachedPyodideModuleOptions {
	/** A compilation the caller started early, so it overlaps the bootstrap script downloads. */
	module?: Promise<WebAssembly.Module>;
	/** Bounded standard library bytes the caller already loaded; Pyodide receives a copy. */
	standardLibrary?: Uint8Array;
}

/**
 * Pyodide creates its own instantiateWasm hook, including its sentinel imports.
 * Intercept only the exact bootstrap fetch/Response during initialization so those imports
 * remain intact. Other Wasm (including the sentinel) and all package fetches are untouched.
 *
 * Pyodide starts its standard library and lock downloads only once initialization begins, so
 * initialization must not wait for the Wasm compilation: the module is awaited only where the
 * engine instantiates it. A compilation failure still rejects this call directly instead of
 * surfacing through Pyodide's bootstrap, which catches instantiation failures internally.
 */
export async function withCachedPyodideModule<T>(
	baseUrl: string,
	initialize: () => Promise<T>,
	options: CachedPyodideModuleOptions = {}
): Promise<T> {
	const runtimeUrl = new URL('pyodide.asm.wasm', baseUrl).href;
	const standardLibraryUrl = new URL('python_stdlib.zip', baseUrl).href;
	const compiling = options.module ?? compileWorkerRuntimeAsset('pyodide.asm.wasm');
	// Settles only when compilation fails.
	const failed = compiling.then(() => new Promise<never>(() => {}));
	void failed.catch(() => undefined);
	const standardLibrary = options.standardLibrary;
	const previousFetch = globalThis.fetch;
	const previousInstantiateStreaming = WebAssembly.instantiateStreaming;
	const responses = new WeakSet<Response>();
	const fetchRuntime: typeof fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : new URL(String(input), baseUrl).href;
		if (standardLibrary && url === standardLibraryUrl) {
			// The Response constructor copies the bytes, so a retried bootstrap can reuse them.
			return new Response(standardLibrary as Uint8Array<ArrayBuffer>, {
				headers: { 'content-type': 'application/zip' }
			});
		}
		if (url !== runtimeUrl) return await previousFetch(input, init);
		const response = new Response(null, { headers: { 'content-type': 'application/wasm' } });
		responses.add(response);
		return response;
	};
	const instantiateRuntime: typeof WebAssembly.instantiateStreaming = async (source, imports) => {
		const response = await source;
		if (!responses.has(response)) return await previousInstantiateStreaming(response, imports);
		const module = await compiling;
		return { module, instance: await WebAssembly.instantiate(module, imports) };
	};
	globalThis.fetch = fetchRuntime;
	WebAssembly.instantiateStreaming = instantiateRuntime;
	try {
		const initializing = initialize();
		// A compile failure leaves Pyodide waiting for its module; observe its late settlement.
		void initializing.catch(() => undefined);
		return await Promise.race([initializing, failed]);
	} finally {
		if (globalThis.fetch === fetchRuntime) globalThis.fetch = previousFetch;
		if (WebAssembly.instantiateStreaming === instantiateRuntime) {
			WebAssembly.instantiateStreaming = previousInstantiateStreaming;
		}
	}
}
