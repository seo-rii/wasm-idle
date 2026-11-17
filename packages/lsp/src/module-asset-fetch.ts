import { resolveRuntimeAssetCacheOptions } from '@wasm-idle/core';
import { fetchBoundedExternalAsset } from './external-asset.js';
import {
	resolveLanguageToolPersistentOptions,
	resolveLanguageToolPersistentReceipt,
	type LanguageToolPersistentOptions
} from './persistent-assets.js';

const abortError = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('The language tool asset request was aborted', 'AbortError');

/** A sole `v` fingerprint names the same release file; any other query is not a pinned asset. */
function lockUrl(url: URL) {
	const keys = [...url.searchParams.keys()];
	if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'v') || url.hash) return undefined;
	const canonical = new URL(url.href);
	canonical.search = '';
	return canonical.href;
}

/**
 * Serve the pinned release files under a runtime module's directory from the persistent
 * cache. Loaders such as wasm-go and the .NET boot loader resolve the global fetch when they
 * request their payloads, so a language server worker that owns such a runtime wraps it.
 *
 * Only plain GET requests for files that the bundled asset lock describes at the explicit
 * distribution root are eligible; anything else goes to the network unchanged. A body that
 * does not match its receipt, as on a deployment that rebuilt the file, is fetched once more
 * without the cache.
 */
export function createPersistentModuleAssetFetch(
	moduleUrl: string,
	network: typeof fetch,
	options: LanguageToolPersistentOptions = resolveLanguageToolPersistentOptions()
): typeof fetch {
	let directory: URL;
	try {
		directory = new URL('./', new URL(moduleUrl, globalThis.location?.href));
	} catch {
		return network;
	}
	if (
		!options.assetRoot ||
		!/^https?:$/u.test(directory.protocol) ||
		!resolveRuntimeAssetCacheOptions(options.persistentCache).enabled
	)
		return network;
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (
			input instanceof Request ||
			(init?.method ?? 'GET').toUpperCase() !== 'GET' ||
			init?.body ||
			[...new Headers(init?.headers).keys()].length
		)
			return network(input, init);
		let url: URL;
		try {
			url = new URL(String(input), globalThis.location?.href);
		} catch {
			return network(input, init);
		}
		const pinned =
			url.origin === directory.origin && url.pathname.startsWith(directory.pathname)
				? lockUrl(url)
				: undefined;
		const signal = init?.signal ?? undefined;
		const receipt = pinned
			? await resolveLanguageToolPersistentReceipt(pinned, options, undefined, signal).catch(
					() => undefined
				)
			: undefined;
		if (signal?.aborted) throw abortError(signal);
		if (!receipt?.sha256) return network(input, init);
		let bytes: Uint8Array<ArrayBuffer>;
		try {
			bytes = await fetchBoundedExternalAsset({
				...options,
				url: url.href,
				integrity: receipt,
				label: `runtime asset ${url.pathname}`,
				// A browser that decodes a .gz file served with Content-Encoding returns more
				// bytes than the stored file has.
				maxBytes: Math.max(receipt.bytes ?? 0, receipt.uncompressedBytes ?? 0) || undefined,
				signal,
				cache: init?.cache,
				fetch: network
			});
		} catch {
			if (signal?.aborted) throw abortError(signal);
			return network(input, init);
		}
		return new Response(bytes, {
			status: 200,
			headers: {
				'content-type': receipt.mediaType ?? 'application/octet-stream',
				'content-length': String(bytes.byteLength)
			}
		});
	}) as typeof fetch;
}

let installed: { network: typeof fetch; moduleUrl: string } | undefined;

/** Install the cached fetch for the runtime module that this worker owns. */
export function installPersistentModuleAssetFetch(moduleUrl: string) {
	if (installed?.moduleUrl === moduleUrl) return;
	const network = installed?.network ?? globalThis.fetch?.bind(globalThis);
	if (!network) return;
	const cached = createPersistentModuleAssetFetch(moduleUrl, network);
	if (cached === network) return;
	installed = { network, moduleUrl };
	globalThis.fetch = cached;
}
