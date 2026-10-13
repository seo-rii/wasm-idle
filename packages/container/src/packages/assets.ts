import {
  fetchPinnedRuntimeAsset, verifyRuntimeAssetIntegrity, resolveRuntimeAssetCacheOptions,
  type RuntimeAssetCacheOptions
} from '@wasm-idle/core';
import { ContainerError } from '../errors.js';
import {
  assertValidatedDistribution, type DistributionAsset, type ValidatedDistribution
} from './distribution.js';

export interface VerifiedAssetLoaderOptions {
  readonly distribution: ValidatedDistribution;
  readonly persistentCache?: RuntimeAssetCacheOptions;
  /** Primarily for protocol tests or a host-owned fetch implementation; checks still apply. */
  readonly fetch?: typeof globalThis.fetch;
  readonly maxCachedBytes?: number;
  readonly maxPendingAssets?: number;
  readonly maxConsumers?: number;
}

export interface AssetLoaderInspection {
  readonly pendingRequests: number;
  readonly consumers: number;
  readonly cachedEntries: number;
  readonly cachedBytes: number;
  readonly memoryCacheHits: number;
}

export interface VerifiedAssetLoader {
  /** Returns owned logical bytes. Mutating the result cannot poison other consumers or cache. */
  load(packageId: string, assetId: string, options?: { readonly signal?: AbortSignal }): Promise<Uint8Array>;
  inspect(): AssetLoaderInspection;
  clearMemoryCache(): void;
  dispose(): Promise<void>;
}

interface PendingAsset {
  readonly controller: AbortController;
  readonly consumers: Set<symbol>;
  promise: Promise<Uint8Array>;
  settled: boolean;
}

const aborted = (reason: unknown) => new ContainerError('ABORTED', 'Asset consumer canceled', { cause: reason });
function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted(signal.reason);
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(aborted(signal.reason)); };
    signal.addEventListener('abort', abort, { once: true });
    void pending.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); }
    );
    if (signal.aborted) abort();
  });
}

async function decodeGzip(bytes: Uint8Array, asset: DistributionAsset, signal: AbortSignal): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new ContainerError('UNSUPPORTED_PROFILE', 'This browser cannot decompress gzip package files');
  }
  const source = new Blob([Uint8Array.from(bytes)]).stream();
  const reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    // Size was admitted before network I/O; never retain more decompressed data than this pin.
    const result = new Uint8Array(asset.logical.bytes);
    let offset = 0;
    while (true) {
      checkSignal(signal);
      const { done, value } = await abortable(reader.read(), signal);
      checkSignal(signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > result.byteLength - offset) {
        throw new ContainerError('INTEGRITY', `Decoded asset exceeds its pinned size: ${asset.url}`);
      }
      result.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== result.byteLength) throw new ContainerError('INTEGRITY', `Decoded asset has the wrong size: ${asset.url}`);
    return result;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    if (signal.aborted) throw aborted(signal.reason);
    if (error instanceof ContainerError) throw error;
    throw new ContainerError('INTEGRITY', `Invalid gzip asset: ${asset.url}`, { cause: error });
  } finally {
    signal.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch { /* Cancellation can still own a pending read. */ }
  }
}

/** Per-loader policy is fixed. Only identical receipts/encoding share a fetch and decoded bytes. */
export function createVerifiedAssetLoader(options: VerifiedAssetLoaderOptions): VerifiedAssetLoader {
  assertValidatedDistribution(options.distribution);
  const distribution = options.distribution;
  const persistentCache = Object.freeze(resolveRuntimeAssetCacheOptions(options.persistentCache));
  const fetcher = options.fetch;
  const maxCachedBytes = options.maxCachedBytes ?? 64 * 1024 * 1024;
  const maxPendingAssets = options.maxPendingAssets ?? 8;
  const maxConsumers = options.maxConsumers ?? 128;
  for (const [key, value] of Object.entries({ maxCachedBytes, maxPendingAssets, maxConsumers })) {
    if (!Number.isSafeInteger(value) || value < (key === 'maxCachedBytes' ? 0 : 1)) {
      throw new ContainerError('INVALID_ARGUMENT', `Invalid asset loader limit ${key}`);
    }
  }
  const assets = new Map(distribution.packages.map((pkg) => [pkg.id, new Map(pkg.assets.map((asset) => [asset.id, asset]))]));
  const pending = new Map<string, PendingAsset>();
  const active = new Set<PendingAsset>();
  const cached = new Map<string, Uint8Array>();
  let cacheBytes = 0;
  let consumers = 0;
  let memoryCacheHits = 0;
  let disposed = false;
  let disposal: Promise<void> | undefined;

  const remember = (key: string, bytes: Uint8Array) => {
    if (bytes.byteLength > maxCachedBytes || maxCachedBytes === 0) return;
    const previous = cached.get(key);
    if (previous) { cacheBytes -= previous.byteLength; cached.delete(key); }
    // The count bound also prevents an unlimited cache of zero-byte entries.
    while (cached.size >= distribution.limits.maxAssets || cacheBytes + bytes.byteLength > maxCachedBytes) {
      const oldest = cached.entries().next().value as [string, Uint8Array] | undefined;
      if (!oldest) break;
      cached.delete(oldest[0]); cacheBytes -= oldest[1].byteLength;
    }
    cached.set(key, bytes);
    cacheBytes += bytes.byteLength;
  };

  const download = async (asset: DistributionAsset, signal: AbortSignal): Promise<Uint8Array> => {
    try {
      const delivery = await fetchPinnedRuntimeAsset({
        url: asset.url,
        receipt: asset.delivery,
        maxAssetBytes: distribution.limits.maxAssetBytes,
        persistentCache,
        fetch: fetcher,
        signal
      });
      checkSignal(signal);
      const bytes = asset.encoding === 'gzip' ? await decodeGzip(delivery, asset, signal) : delivery;
      // Gzip's logical MIME is authenticated metadata, not an HTTP response header. Do not
      // fabricate a header to pass a MIME check; the actual delivery MIME was checked by Core.
      await abortable(verifyRuntimeAssetIntegrity({
        asset: `${asset.url}#logical`, bytes,
        expected: { sha256: asset.logical.sha256, bytes: asset.logical.bytes }
      }), signal);
      checkSignal(signal);
      return bytes;
    } catch (cause) {
      if (signal.aborted) throw aborted(signal.reason);
      if (cause instanceof ContainerError) throw cause;
      const name = cause instanceof Error ? cause.name : '';
      const code = name === 'AssetIntegrityError'
        ? 'INTEGRITY' : name === 'AssetTooLargeError' ? 'RESOURCE_LIMIT' : 'STARTUP_FAILED';
      throw new ContainerError(code, `Cannot prepare pinned asset ${asset.id} (${asset.logical.sha256}) from ${asset.url}`, { cause });
    }
  };

  const loader: VerifiedAssetLoader = {
    async load(packageId, assetId, request = {}) {
      if (disposed) throw new ContainerError('DISPOSED', 'Asset loader has been disposed');
      const signal = request.signal;
      checkSignal(signal);
      const asset = assets.get(packageId)?.get(assetId);
      if (!asset) throw new ContainerError('INVALID_DISTRIBUTION', `Unknown pinned asset ${packageId}/${assetId}`);
      const key = JSON.stringify([
        asset.url, asset.encoding, asset.delivery.sha256, asset.delivery.bytes, asset.delivery.mediaType,
        asset.logical.sha256, asset.logical.bytes, asset.logical.mediaType, distribution.limits.maxAssetBytes
      ]);
      const hit = cached.get(key);
      if (hit) {
        cached.delete(key); cached.set(key, hit); memoryCacheHits++;
        return Uint8Array.from(hit);
      }
      if (consumers >= maxConsumers) throw new ContainerError('RESOURCE_LIMIT', 'Too many asset consumers');
      let work = pending.get(key);
      if (!work) {
        if (active.size >= maxPendingAssets) throw new ContainerError('RESOURCE_LIMIT', 'Too many pending asset requests');
        const controller = new AbortController();
        const created: PendingAsset = { controller, consumers: new Set(), promise: Promise.resolve(new Uint8Array()), settled: false };
        created.promise = download(asset, controller.signal).then((bytes) => {
          if (!disposed && !controller.signal.aborted && created.consumers.size > 0) remember(key, bytes);
          return bytes;
        }).finally(() => {
          created.settled = true;
          active.delete(created);
          if (pending.get(key) === created) pending.delete(key);
        });
        pending.set(key, created);
        active.add(created);
        work = created;
      }
      const entry = work;
      return new Promise<Uint8Array>((resolve, reject) => {
        const consumer = Symbol();
        entry.consumers.add(consumer); consumers++;
        let settled = false;
        const release = () => {
          signal?.removeEventListener('abort', cancel);
          entry.consumers.delete(consumer); consumers--;
          if (!entry.settled && entry.consumers.size === 0) {
            // Remove before aborting: a new consumer must not attach to a canceled generation.
            if (pending.get(key) === entry) pending.delete(key);
            entry.controller.abort(aborted('All asset consumers canceled'));
          }
        };
        const cancel = () => {
          if (settled) return;
          settled = true; release(); reject(aborted(signal?.reason));
        };
        signal?.addEventListener('abort', cancel, { once: true });
        void entry.promise.then((bytes) => {
          if (settled) return;
          settled = true; release(); resolve(Uint8Array.from(bytes));
        }, (error: unknown) => {
          if (settled) return;
          settled = true; release(); reject(error);
        });
        if (signal?.aborted) cancel();
      });
    },
    inspect() {
      return Object.freeze({ pendingRequests: active.size, consumers, cachedEntries: cached.size, cachedBytes: cacheBytes, memoryCacheHits });
    },
    clearMemoryCache() { cached.clear(); cacheBytes = 0; },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const work = [...active];
      for (const entry of work) entry.controller.abort(new ContainerError('DISPOSED', 'Asset loader disposed'));
      cached.clear(); cacheBytes = 0;
      disposal = Promise.allSettled(work.map((entry) => entry.promise)).then(() => {});
      return disposal;
    }
  };
  return Object.freeze(loader);
}
