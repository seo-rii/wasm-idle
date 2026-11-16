import {
	loadRuntimeAssetLockEntry,
	readPersistentRuntimeAsset,
	resolveRuntimeAssetCacheOptions,
	writePersistentRuntimeAsset,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';

export interface LockVerifiedFetchOptions {
	/** Directory that the bundled runtime asset lock describes under `assetPrefix`. */
	assetRoot: string;
	/** Lock path prefix for `assetRoot`, for example `wasm-go`. */
	assetPrefix: string;
	/** Separates this consumer's URL references in the shared persistent cache. */
	validationKey: string;
	persistentCache?: RuntimeAssetCacheOptions;
	fetch?: typeof fetch;
	lookup?: typeof loadRuntimeAssetLockEntry;
}

const abortError = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('The runtime asset request was aborted', 'AbortError');

/** A sole `v` fingerprint names the same release file; any other query is not a pinned asset. */
function lockUrl(url: URL) {
	const keys = [...url.searchParams.keys()];
	if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'v') || url.hash) return undefined;
	const canonical = new URL(url.href);
	canonical.search = '';
	return canonical;
}

async function collect(body: ReadableStream<Uint8Array>, limit: number) {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) {
				await reader.cancel().catch(() => {});
				return undefined;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Serve pinned release files from the persistent runtime cache inside a runtime Worker.
 *
 * Only GET requests for files that the bundled asset lock describes are eligible. A
 * network body is stored only after it matches its receipt, and a hit is served only for
 * the exact URL that stored it. Anything else, including a custom or stale deployment
 * whose bytes differ from the lock, is passed through unchanged.
 */
export function createLockVerifiedFetch(options: LockVerifiedFetchOptions): typeof fetch {
	const network = options.fetch ?? globalThis.fetch.bind(globalThis);
	const cache = resolveRuntimeAssetCacheOptions(options.persistentCache);
	if (!cache.enabled) return network;
	const lookup = options.lookup ?? loadRuntimeAssetLockEntry;
	const root = new URL(options.assetRoot);
	const location = { assetRoot: root.href, assetPrefix: options.assetPrefix };
	// Start the one-time inventory import before the runtime's first asset request.
	// An empty relative path would return before importing, so probe a named file.
	void Promise.resolve()
		.then(() => lookup(new URL('wasm-idle-lock-probe', root), location))
		.catch(() => {});
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const method = (init?.method ?? 'GET').toUpperCase();
		if (input instanceof Request || method !== 'GET' || new Headers(init?.headers).has('range'))
			return network(input, init);
		const signal = init?.signal ?? undefined;
		let url: URL;
		try {
			url = new URL(String(input), globalThis.location?.href);
		} catch {
			return network(input, init);
		}
		const pinned = lockUrl(url);
		const receipt = pinned
			? await lookup(pinned, { ...location, signal }).catch(() => undefined)
			: undefined;
		if (signal?.aborted) throw abortError(signal);
		if (!receipt) return network(input, init);
		const identity = {
			url: url.href,
			sha256: receipt.sha256,
			bytes: receipt.bytes,
			validationKey: options.validationKey
		};
		const hit = await readPersistentRuntimeAsset({ identity, cache, signal }).catch(
			() => undefined
		);
		if (signal?.aborted) throw abortError(signal);
		if (hit)
			return new Response(hit as Uint8Array<ArrayBuffer>, {
				status: 200,
				headers: {
					'content-type': receipt.mediaType ?? 'application/octet-stream',
					'content-length': String(hit.byteLength)
				}
			});
		const response = await network(input, init);
		// A browser-decoded body no longer has the receipt's bytes.
		if (response.status !== 200 || !response.body || response.headers.has('content-encoding'))
			return response;
		const [caller, store] = response.body.tee();
		void collect(store, receipt.bytes ?? Math.min(cache.maxBytes, cache.maxEntryBytes))
			.then((bytes) =>
				bytes ? writePersistentRuntimeAsset({ identity, cache, bytes }) : false
			)
			// The write verifies the receipt; a mismatch or full storage only skips caching.
			.catch(() => false);
		return new Response(caller, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	}) as typeof fetch;
}
