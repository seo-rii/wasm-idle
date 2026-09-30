import { resolveRuntimeAssetCacheOptions, type RuntimeAssetCacheOptions } from '@wasm-idle/core';
import { fetchBoundedExternalAsset } from '../external-asset.js';
import { resolveLanguageToolPersistentReceipt } from '../persistent-assets.js';

/** Only intercept pinned, ordinary GET bootstrap requests inside this worker. */
export async function withPersistentPythonLspAssets<T>(
	options: { persistentCache?: RuntimeAssetCacheOptions; assetRoot?: string },
	initialize: () => Promise<T>
): Promise<T> {
	const nativeFetch = globalThis.fetch;
	if (
		!nativeFetch ||
		!options.assetRoot ||
		!resolveRuntimeAssetCacheOptions(options.persistentCache).enabled
	)
		return initialize();
	const fetchWithCache: typeof fetch = async (input, init) => {
		const request = input instanceof Request ? input : undefined;
		const method = init?.method ?? request?.method ?? 'GET';
		const headers = new Headers(init?.headers ?? request?.headers);
		let hasHeaders = false;
		headers.forEach(() => {
			hasHeaders = true;
		});
		if (
			method.toUpperCase() !== 'GET' ||
			hasHeaders ||
			init?.body ||
			(init?.credentials ?? request?.credentials) === 'include' ||
			(init?.cache ?? request?.cache) === 'only-if-cached'
		) {
			return nativeFetch.call(globalThis, input, init);
		}
		const url = new URL(request?.url ?? String(input), globalThis.location?.href).href;
		// A distribution may customize its package lock at this same root (for
		// example Trinity's robot package). An inferred stock receipt must not
		// replace that lock or become a new integrity requirement for its packages.
		const filename = new URL(url).pathname.split('/').at(-1);
		if (filename !== 'pyodide.asm.wasm' && filename !== 'python_stdlib.zip') {
			return nativeFetch.call(globalThis, input, init);
		}
		const receipt = resolveLanguageToolPersistentReceipt(url, options);
		if (!receipt?.sha256) return nativeFetch.call(globalThis, input, init);
		const bytes = await fetchBoundedExternalAsset({
			...options,
			url,
			integrity: receipt,
			label: 'Python LSP bootstrap asset',
			maxBytes: receipt.bytes,
			signal: init?.signal ?? request?.signal ?? undefined,
			cache: init?.cache ?? request?.cache,
			fetch: nativeFetch.bind(globalThis)
		});
		return new Response(bytes, {
			headers: {
				'content-type':
					receipt.mediaType ??
					(url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
			}
		});
	};
	globalThis.fetch = fetchWithCache;
	try {
		return await initialize();
	} finally {
		if (globalThis.fetch === fetchWithCache) globalThis.fetch = nativeFetch;
	}
}
