/** Storage is supplied by the embedding application; policy and version remain owned there. */
export interface RuntimeAssetPersistentCacheIdentity {
	readonly url: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly validationKey?: string;
}

export interface RuntimeAssetPersistentCache {
	read(
		identity: RuntimeAssetPersistentCacheIdentity,
		signal?: AbortSignal
	): Promise<Uint8Array | undefined>;
	write(
		identity: RuntimeAssetPersistentCacheIdentity,
		bytes: Uint8Array,
		signal?: AbortSignal
	): Promise<void | boolean>;
}

const caches = new WeakMap<typeof fetch, RuntimeAssetPersistentCache>();

/** A request-local fetch identity carries storage without mutating global fetch or worker policy. */
export function withRuntimeAssetPersistentCache(
	fetchImpl: typeof fetch,
	cache?: RuntimeAssetPersistentCache
): typeof fetch {
	if (!cache) return fetchImpl;
	const wrapped: typeof fetch = (input, init) => fetchImpl(input, init);
	caches.set(wrapped, cache);
	return wrapped;
}

export function resolveRuntimeAssetPersistentCache(fetchImpl: typeof fetch) {
	return caches.get(fetchImpl);
}

export async function waitForRuntimeAssetCache<T>(
	operation: Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	if (!signal) return operation;
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new Error('Rust asset cache request aborted'));
		signal.addEventListener('abort', abort, { once: true });
		void operation
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort));
		if (signal.aborted) abort();
	});
}
