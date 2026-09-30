import { verifyRuntimeAssetIntegrity } from './asset-integrity.js';
import { AssetTooLargeError, RuntimeConfigurationError } from './errors.js';
import {
	getRuntimeAssetCacheStats,
	readPersistentRuntimeAsset,
	writePersistentRuntimeAsset,
	resolveRuntimeAssetCacheOptions,
	type RuntimeAssetCacheOptions
} from './persistent-asset-cache.js';
import type { RuntimeAssetIntegrityEntry } from './runtime-assets.js';

export interface PinnedRuntimeAssetRequest {
	url: string;
	/** Expected digest of exactly the response body, not an unverified remote manifest. */
	receipt: Readonly<RuntimeAssetIntegrityEntry>;
	persistentCache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
	maxAssetBytes?: number;
	fetch?: typeof globalThis.fetch;
	onProgress?: (loaded: number, total?: number) => void;
}

function cancelResponse(response: Response, reason: unknown) {
	try {
		void response.body?.cancel(reason).catch(() => {});
	} catch {}
}

/** Custom fetch/read implementations may ignore signal; cancellation must still settle promptly. */
function abortable<T>(
	pending: Promise<T>,
	signal?: AbortSignal,
	onLateValue?: (value: T) => void
): Promise<T> {
	if (!signal) return pending;
	return new Promise((resolve, reject) => {
		let aborted = false;
		const abort = () => {
			aborted = true;
			signal.removeEventListener('abort', abort);
			reject(signal.reason ?? new DOMException('Pinned asset request aborted', 'AbortError'));
		};
		signal.addEventListener('abort', abort, { once: true });
		void pending.then(
			(value) => {
				signal.removeEventListener('abort', abort);
				if (aborted) onLateValue?.(value);
				else resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
		if (signal.aborted) abort();
	});
}

async function fetchPinnedRuntimeAssetResult(
	request: PinnedRuntimeAssetRequest
): Promise<{ bytes: Uint8Array; stored: boolean }> {
	request.signal?.throwIfAborted();
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		throw new RuntimeConfigurationError('Pinned asset URL must be absolute HTTP(S)');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
		throw new RuntimeConfigurationError('Pinned assets require an uncredentialed HTTP(S) URL');
	}
	const receipt = { ...request.receipt };
	const max = request.maxAssetBytes ?? 128 * 1024 * 1024;
	const encoded =
		receipt.uncompressedSha256 !== undefined || receipt.uncompressedBytes !== undefined;
	if (
		!Number.isSafeInteger(max) ||
		max <= 0 ||
		!/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
		(receipt.bytes !== undefined &&
			(!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0)) ||
		(encoded &&
			(typeof receipt.uncompressedSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(receipt.uncompressedSha256) ||
				!Number.isSafeInteger(receipt.uncompressedBytes) ||
				receipt.uncompressedBytes! < 0)) ||
		(receipt.mediaType !== undefined &&
			(typeof receipt.mediaType !== 'string' || !receipt.mediaType.includes('/')))
	) {
		throw new RuntimeConfigurationError('Invalid pinned asset receipt or byte limit');
	}
	const tooLarge = (actual: number) =>
		new AssetTooLargeError('Pinned runtime asset exceeds its byte limit', {
			limit: max,
			actual
		});
	if (receipt.bytes !== undefined && receipt.bytes > max) throw tooLarge(receipt.bytes);
	const policy = resolveRuntimeAssetCacheOptions(request.persistentCache);
	const cache = { ...policy, maxEntryBytes: Math.min(policy.maxEntryBytes, max) };
	const identity = {
		url: url.href,
		sha256: receipt.sha256,
		bytes: receipt.bytes,
		validationKey: JSON.stringify([
			'pinned-public-http-v2',
			encoded,
			receipt.mediaType ?? '',
			max
		])
	};
	const cached = await readPersistentRuntimeAsset({ identity, cache, signal: request.signal });
	if (cached) {
		request.onProgress?.(cached.byteLength, cached.byteLength);
		request.signal?.throwIfAborted();
		return { bytes: cached, stored: true };
	}
	const load = async () => {
		request.signal?.throwIfAborted();
		const fetcher = request.fetch ?? globalThis.fetch;
		if (typeof fetcher !== 'function')
			throw new RuntimeConfigurationError('Pinned asset fetch is unavailable');
		const response = await abortable(
			Promise.resolve().then(() => {
				request.signal?.throwIfAborted();
				return fetcher.call(globalThis, url.href, {
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: request.signal
				});
			}),
			request.signal,
			(late) => cancelResponse(late, request.signal?.reason)
		);
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		const abort = () => {
			try {
				void reader?.cancel(request.signal?.reason).catch(() => {});
			} catch {}
		};
		try {
			request.signal?.throwIfAborted();
			if (
				!response.ok ||
				response.status === 206 ||
				response.redirected ||
				response.type === 'opaque' ||
				response.type === 'opaqueredirect' ||
				response.url !== url.href
			) {
				throw new Error(
					`Pinned asset did not return a complete response from its exact URL (${response.status})`
				);
			}
			if (!response.body) throw new Error('Pinned asset response body is unavailable');
			const header = response.headers.get('content-length');
			if (
				header !== null &&
				(!/^\d+$/u.test(header) || !Number.isSafeInteger(Number(header)))
			) {
				throw new Error('Pinned asset has an invalid content length');
			}
			if (header !== null && Number(header) > max) throw tooLarge(Number(header));
			reader = response.body.getReader();
			request.signal?.addEventListener('abort', abort, { once: true });
			let bytes = new Uint8Array(Math.min(max, receipt.bytes ?? 65536));
			let length = 0;
			while (true) {
				request.signal?.throwIfAborted();
				const { done, value } = await abortable(reader.read(), request.signal);
				request.signal?.throwIfAborted();
				if (done) break;
				if (Object.prototype.toString.call(value) !== '[object Uint8Array]')
					throw new Error('Pinned asset stream returned non-byte data');
				const next = length + value.byteLength;
				if (next > max || (receipt.bytes !== undefined && next > receipt.bytes))
					throw tooLarge(next);
				if (next > bytes.byteLength) {
					const grown = new Uint8Array(
						Math.min(max, Math.max(next, bytes.byteLength * 2, 65536))
					);
					grown.set(bytes.subarray(0, length));
					bytes = grown;
				}
				bytes.set(value, length);
				length = next;
				request.onProgress?.(length, receipt.bytes);
			}
			const result = bytes.slice(0, length);
			// For encoded receipts mediaType describes decoded bytes, not the gzip transport.
			await abortable(
				verifyRuntimeAssetIntegrity({
					asset: url.href,
					bytes: result,
					expected: receipt,
					mimeType: response.headers.get('content-type') ?? undefined
				}),
				request.signal
			);
			request.signal?.throwIfAborted();
			return result;
		} catch (error) {
			if (reader) {
				try {
					void reader.cancel(error).catch(() => {});
				} catch {}
			} else cancelResponse(response, error);
			throw error;
		} finally {
			request.signal?.removeEventListener('abort', abort);
			try {
				reader?.releaseLock();
			} catch {}
		}
	};
	const bytes = await load();
	const stored = await writePersistentRuntimeAsset({
		identity,
		cache,
		signal: request.signal,
		bytes
	});
	request.onProgress?.(bytes.byteLength, bytes.byteLength);
	request.signal?.throwIfAborted();
	return { bytes, stored };
}

/** Explicit public-asset adapter for third-party loaders and custom immutable distributions. */
export async function fetchPinnedRuntimeAsset(
	request: PinnedRuntimeAssetRequest
): Promise<Uint8Array> {
	return (await fetchPinnedRuntimeAssetResult(request)).bytes;
}

export interface PrefetchRuntimeAssetsOptions {
	assets: readonly Pick<PinnedRuntimeAssetRequest, 'url' | 'receipt'>[];
	persistentCache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
	maxAssetBytes?: number;
	concurrency?: number;
	onProgress?: (completed: number, total: number) => void;
}

export interface PrefetchRuntimeAssetsResult {
	/** Successfully verified assets, whether or not browser storage accepted them. */
	completed: number;
	/** Successful hits/writes at processing time. Later LRU/browser eviction remains possible. */
	stored: number;
	/** Downloads skipped because caching is disabled or storage is unavailable. */
	skipped: boolean;
}

/** Explicit prefetch only: never downloads all languages just by importing the library. */
export async function prefetchRuntimeAssets(
	options: PrefetchRuntimeAssetsOptions
): Promise<PrefetchRuntimeAssetsResult> {
	const cache = resolveRuntimeAssetCacheOptions(options.persistentCache);
	options.signal?.throwIfAborted();
	if (!cache.enabled) return { completed: 0, stored: 0, skipped: true };
	const concurrency = options.concurrency ?? 2;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
		throw new TypeError('Asset prefetch concurrency must be between 1 and 8');
	const assets = options.assets.map(({ url, receipt }) => ({ url, receipt: { ...receipt } }));
	const status = await abortable(getRuntimeAssetCacheStats(cache), options.signal);
	options.signal?.throwIfAborted();
	if (!status.available) return { completed: 0, stored: 0, skipped: true };
	const controller = new AbortController();
	const abort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', abort, { once: true });
	if (options.signal?.aborted) abort();
	let next = 0;
	let completed = 0;
	let stored = 0;
	let failed = false;
	let failure: unknown;
	try {
		await Promise.all(
			Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
				try {
					while (next < assets.length) {
						controller.signal.throwIfAborted();
						const asset = assets[next++]!;
						const result = await fetchPinnedRuntimeAssetResult({
							...asset,
							persistentCache: cache,
							signal: controller.signal,
							maxAssetBytes: options.maxAssetBytes
						});
						if (result.stored) stored++;
						completed++;
						options.onProgress?.(completed, assets.length);
					}
				} catch (error) {
					if (!failed) {
						failed = true;
						failure = error;
					}
					controller.abort(error);
				}
			})
		);
		if (failed) throw failure;
		controller.signal.throwIfAborted();
		return { completed, stored, skipped: false };
	} finally {
		options.signal?.removeEventListener('abort', abort);
	}
}
