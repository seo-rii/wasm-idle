/** Keep Pyodide's sentinel/import setup; substitute only its exact bootstrap Wasm response. */
export async function withPythonRuntimeModule<T>(
	baseUrl: string,
	module: WebAssembly.Module | undefined,
	initialize: () => Promise<T>
) {
	if (!module) return initialize();
	const url = new URL('pyodide.asm.wasm', baseUrl).href;
	const previousFetch = globalThis.fetch;
	const previousInstantiate = WebAssembly.instantiateStreaming;
	const responses = new WeakSet<Response>();
	const fetch: typeof globalThis.fetch = async (input, init) => {
		if ((input instanceof Request ? input.url : new URL(String(input), baseUrl).href) !== url)
			return previousFetch(input, init);
		const response = new Response(null, { headers: { 'content-type': 'application/wasm' } });
		responses.add(response);
		return response;
	};
	const instantiate: typeof WebAssembly.instantiateStreaming = async (source, imports) => {
		const response = await source;
		return responses.has(response)
			? { module, instance: await WebAssembly.instantiate(module, imports) }
			: previousInstantiate(response, imports);
	};
	globalThis.fetch = fetch;
	WebAssembly.instantiateStreaming = instantiate;
	try {
		return await initialize();
	} finally {
		if (globalThis.fetch === fetch) globalThis.fetch = previousFetch;
		if (WebAssembly.instantiateStreaming === instantiate)
			WebAssembly.instantiateStreaming = previousInstantiate;
	}
}
