import {
	assertRuntimeAssetDeliveryBudgetAvailable,
	consumeRuntimeAssetDeliveryBytes,
	resolveRuntimeAssetDeliveryBudget,
	type RuntimeAssetDeliveryBudgetDescriptor
} from './runtime-delivery-budget.js';

export { withRuntimeAssetDeliveryBudget } from './runtime-delivery-budget.js';

export interface RuntimeAssetDownloadProgress {
	loaded: number;
	total?: number;
}

export const DEFAULT_MAX_RUNTIME_ASSET_BYTES = 128 * 1024 * 1024;

export interface RuntimeAssetReceipt {
	bytes: number;
	sha256: string;
	uncompressedBytes?: number;
	uncompressedSha256?: string;
}

export interface RuntimeAssetFetchOptions {
	deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor;
	maxAssetBytes?: number;
	signal?: AbortSignal;
	receipt?: RuntimeAssetReceipt;
}

const runtimeAssetReceipts = new Map<string, RuntimeAssetReceipt>();
const cacheIdentityIds = new WeakMap<object, number>();
let nextCacheIdentityId = 0;

function cacheIdentity(value: object) {
	let identity = cacheIdentityIds.get(value);
	if (!identity) {
		identity = ++nextCacheIdentityId;
		cacheIdentityIds.set(value, identity);
	}
	return identity;
}

function snapshotRuntimeAssetReceipt(
	receipt: RuntimeAssetReceipt,
	label: string
): RuntimeAssetReceipt {
	const hasLogicalBytes = receipt.uncompressedBytes !== undefined;
	const hasLogicalSha256 = receipt.uncompressedSha256 !== undefined;
	if (
		!Number.isSafeInteger(receipt.bytes) ||
		receipt.bytes < 0 ||
		typeof receipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
		hasLogicalBytes !== hasLogicalSha256 ||
		(hasLogicalBytes &&
			(!Number.isSafeInteger(receipt.uncompressedBytes) ||
				receipt.uncompressedBytes! < 0 ||
				!/^[a-f0-9]{64}$/u.test(receipt.uncompressedSha256!)))
	) {
		throw new Error(`wasm-rust runtime asset ${label} has an invalid receipt`);
	}
	return Object.freeze({
		bytes: receipt.bytes,
		sha256: receipt.sha256,
		...(hasLogicalBytes
			? {
					uncompressedBytes: receipt.uncompressedBytes!,
					uncompressedSha256: receipt.uncompressedSha256!
				}
			: {})
	});
}

function resolveVersionedRuntimeAssetUrl(baseUrl: string | URL, assetPath: string) {
	const base = new URL(baseUrl.toString());
	const resolved = new URL(assetPath, base);
	if (!resolved.search && base.search) resolved.search = base.search;
	return resolved.href;
}

export function registerRuntimeAssetReceipts(
	runtimeBaseUrl: string | URL,
	receipts: Readonly<Record<string, RuntimeAssetReceipt>>
) {
	const pendingReceipts = new Map<string, RuntimeAssetReceipt>();
	for (const [assetPath, sourceReceipt] of Object.entries(receipts)) {
		const receipt = snapshotRuntimeAssetReceipt(sourceReceipt, assetPath);
		const versionedAssetUrl = new URL(
			resolveVersionedRuntimeAssetUrl(runtimeBaseUrl, assetPath)
		);
		const unversionedAssetUrl = new URL(versionedAssetUrl);
		unversionedAssetUrl.search = '';
		for (const assetUrl of new Set([versionedAssetUrl.href, unversionedAssetUrl.href])) {
			const pending = pendingReceipts.get(assetUrl);
			const existing = runtimeAssetReceipts.get(assetUrl);
			if (
				(pending &&
					runtimeAssetReceiptIdentity(pending) !==
						runtimeAssetReceiptIdentity(receipt)) ||
				(existing &&
					runtimeAssetReceiptIdentity(existing) !== runtimeAssetReceiptIdentity(receipt))
			) {
				throw new Error(`wasm-rust runtime asset ${assetPath} has conflicting receipts`);
			}
			pendingReceipts.set(assetUrl, receipt);
		}
	}
	for (const [assetUrl, receipt] of pendingReceipts) {
		runtimeAssetReceipts.set(assetUrl, receipt);
	}
}

export function clearRegisteredRuntimeAssetReceipts() {
	runtimeAssetReceipts.clear();
}

export function hasRegisteredRuntimeAssetReceipt(assetUrl: string | URL) {
	return runtimeAssetReceipts.has(new URL(assetUrl.toString()).href);
}

export function runtimeAssetReceiptIdentity(receipt?: RuntimeAssetReceipt) {
	return receipt
		? [
				receipt.bytes,
				receipt.sha256,
				receipt.uncompressedBytes ?? receipt.bytes,
				receipt.uncompressedSha256 ?? receipt.sha256
			].join(':')
		: 'unverified';
}

export function createRuntimeAssetCacheKey(
	assetUrl: string | URL,
	fetchImpl: typeof fetch,
	options: RuntimeAssetFetchOptions = {}
) {
	const resolvedUrl = new URL(assetUrl.toString()).href;
	const receipt = options.receipt ?? runtimeAssetReceipts.get(resolvedUrl);
	const deliveryBudget = resolveRuntimeAssetDeliveryBudget(options.deliveryBudget);
	return [
		resolvedUrl,
		runtimeAssetReceiptIdentity(receipt),
		options.maxAssetBytes ?? DEFAULT_MAX_RUNTIME_ASSET_BYTES,
		cacheIdentity(fetchImpl),
		options.signal ? cacheIdentity(options.signal) : 'none',
		deliveryBudget ? cacheIdentity(deliveryBudget.state) : 'none'
	].join('\0');
}

function runtimeAssetAbortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new Error('wasm-rust runtime asset load was aborted');
}

function throwIfRuntimeAssetAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw runtimeAssetAbortReason(signal);
}

function cancelResponseBody(response: Response, reason?: unknown) {
	try {
		void response.body?.cancel(reason).catch(() => undefined);
	} catch {}
}

async function readBoundedStream(
	stream: ReadableStream<Uint8Array>,
	assetLabel: string,
	maxAssetBytes: number,
	sizeKind: 'download' | 'decompressed',
	total?: number,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	signal?: AbortSignal,
	deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor
): Promise<Uint8Array<ArrayBuffer>> {
	throwIfRuntimeAssetAborted(signal);
	const reader = stream.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void reader.cancel(reason).catch(() => {});
		} catch {}
	};
	if (signal?.aborted) {
		const reason = runtimeAssetAbortReason(signal);
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => {
					const reason = runtimeAssetAbortReason(signal);
					cancelReader(reason);
					reject(reason);
				};
				signal.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	let bytes = new Uint8Array(total ?? 0);
	let loaded = 0;
	let loadedBytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		while (true) {
			throwIfRuntimeAssetAborted(signal);
			const pendingRead = reader.read();
			const { done, value } = aborted
				? await Promise.race([pendingRead, aborted])
				: await pendingRead;
			throwIfRuntimeAssetAborted(signal);
			if (done) break;
			if (!value) continue;
			if (deliveryBudget) {
				consumeRuntimeAssetDeliveryBytes(deliveryBudget, value.byteLength);
			}
			const nextLength = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLength) || nextLength > maxAssetBytes) {
				const error = new Error(
					`wasm-rust runtime asset ${assetLabel} ${sizeKind} size exceeds the ${maxAssetBytes} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxAssetBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, loaded));
				bytes = grown;
			}
			bytes.set(value, loaded);
			loaded = nextLength;
			onProgress?.({
				loaded,
				...(total !== undefined ? { total } : {})
			});
		}
		throwIfRuntimeAssetAborted(signal);
		if (loaded === 0) {
			onProgress?.({ loaded: 0, total: total ?? 0 });
		}
		loadedBytes = bytes.subarray(0, loaded);
	} catch (error) {
		if (signal?.aborted) {
			const reason = runtimeAssetAbortReason(signal);
			cancelReader(reason);
			throw reason;
		}
		cancelReader(error);
		throw error;
	} finally {
		if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch (error) {
			if (!signal?.aborted) releaseFailure = { error };
		}
	}
	if (signal?.aborted) {
		const reason = runtimeAssetAbortReason(signal);
		cancelReader(reason);
		throw reason;
	}
	if (releaseFailure) throw releaseFailure.error;
	return loadedBytes;
}

async function readResponseBytes(
	response: Response,
	assetLabel: string,
	maxAssetBytes: number,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	signal?: AbortSignal,
	deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor
): Promise<Uint8Array<ArrayBuffer>> {
	throwIfRuntimeAssetAborted(signal);
	const contentLength = response.headers.get('content-length');
	let total: number | undefined;
	if (contentLength !== null) {
		const normalized = contentLength.trim();
		const parsed = Number(normalized);
		if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
			cancelResponseBody(response);
			throwIfRuntimeAssetAborted(signal);
			throw new Error(
				`wasm-rust runtime asset has an invalid Content-Length: ${contentLength}`
			);
		}
		total = parsed;
	}
	if (total !== undefined && total > maxAssetBytes) {
		cancelResponseBody(response);
		throwIfRuntimeAssetAborted(signal);
		throw new Error(
			`wasm-rust runtime asset ${assetLabel} download size exceeds the ${maxAssetBytes} byte limit`
		);
	}
	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		let source: ArrayBuffer;
		try {
			throwIfRuntimeAssetAborted(signal);
			const materialized = response.arrayBuffer();
			source = aborted ? await Promise.race([materialized, aborted]) : await materialized;
			throwIfRuntimeAssetAborted(signal);
		} finally {
			if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		}
		if (deliveryBudget) {
			consumeRuntimeAssetDeliveryBytes(deliveryBudget, source.byteLength);
		}
		if (source.byteLength > maxAssetBytes) {
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} download size exceeds the ${maxAssetBytes} byte limit`
			);
		}
		const bytes = new Uint8Array(source);
		onProgress?.({ loaded: bytes.byteLength, total: total ?? bytes.byteLength });
		throwIfRuntimeAssetAborted(signal);
		return bytes;
	}
	return readBoundedStream(
		response.body,
		assetLabel,
		maxAssetBytes,
		'download',
		total,
		onProgress,
		signal,
		deliveryBudget
	);
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal) {
	throwIfRuntimeAssetAborted(signal);
	if (!globalThis.crypto?.subtle) {
		throw new Error('wasm-rust runtime asset verification requires Web Crypto');
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
				signal.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	try {
		const digestInput =
			bytes.buffer instanceof ArrayBuffer
				? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
				: Uint8Array.from(bytes);
		const pendingDigest = globalThis.crypto.subtle.digest('SHA-256', digestInput);
		const digest = aborted ? await Promise.race([pendingDigest, aborted]) : await pendingDigest;
		throwIfRuntimeAssetAborted(signal);
		return Array.from(new Uint8Array(digest), (value) =>
			value.toString(16).padStart(2, '0')
		).join('');
	} finally {
		if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
	}
}

async function verifyRuntimeAssetReceipt(
	assetLabel: string,
	bytes: Uint8Array,
	receipt: RuntimeAssetReceipt,
	stage: 'storage' | 'logical',
	signal?: AbortSignal
) {
	const expectedBytes =
		stage === 'logical' ? (receipt.uncompressedBytes ?? receipt.bytes) : receipt.bytes;
	const expectedSha256 =
		stage === 'logical' ? (receipt.uncompressedSha256 ?? receipt.sha256) : receipt.sha256;
	if (bytes.byteLength !== expectedBytes) {
		throw new Error(
			`wasm-rust runtime asset ${assetLabel} ${stage} byte length differs from its receipt`
		);
	}
	if ((await sha256Hex(bytes, signal)) !== expectedSha256) {
		throw new Error(
			`wasm-rust runtime asset ${assetLabel} ${stage} SHA-256 differs from its receipt`
		);
	}
	return bytes;
}

export async function fetchRuntimeAssetBytes(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch,
	allowCompressedFallback = true,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	options: RuntimeAssetFetchOptions = {}
) {
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_RUNTIME_ASSET_BYTES;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new Error(`wasm-rust runtime asset has an invalid maxAssetBytes: ${maxAssetBytes}`);
	}
	throwIfRuntimeAssetAborted(options.signal);
	const deliveryBudget = resolveRuntimeAssetDeliveryBudget(options.deliveryBudget);
	if (deliveryBudget) {
		assertRuntimeAssetDeliveryBudgetAvailable(deliveryBudget);
	}
	let resolvedAssetUrlObject: URL;
	try {
		resolvedAssetUrlObject = new URL(assetUrl.toString());
	} catch {
		throw new Error('wasm-rust runtime asset URLs must be absolute');
	}
	if (
		resolvedAssetUrlObject.protocol !== 'http:' &&
		resolvedAssetUrlObject.protocol !== 'https:'
	) {
		throw new Error(
			`unsupported wasm-rust runtime asset URL scheme: ${resolvedAssetUrlObject.protocol}`
		);
	}
	if (resolvedAssetUrlObject.username || resolvedAssetUrlObject.password) {
		throw new Error('wasm-rust runtime asset URLs must not include credentials');
	}
	if (resolvedAssetUrlObject.hash) {
		throw new Error('wasm-rust runtime asset URLs must not include fragments');
	}
	const resolvedAssetUrl = resolvedAssetUrlObject.href;
	const sourceReceipt = options.receipt ?? runtimeAssetReceipts.get(resolvedAssetUrl);
	const receipt = sourceReceipt
		? snapshotRuntimeAssetReceipt(sourceReceipt, assetLabel)
		: undefined;
	const hasReceipt = receipt !== undefined;
	const expectedLogicalBytes = receipt?.uncompressedBytes ?? receipt?.bytes;
	if (hasReceipt && (receipt!.bytes > maxAssetBytes || expectedLogicalBytes! > maxAssetBytes)) {
		throw new Error(
			`wasm-rust runtime asset ${assetLabel} receipt exceeds the ${maxAssetBytes} byte limit`
		);
	}
	const downloadLimit = hasReceipt
		? Math.max(receipt!.bytes, expectedLogicalBytes!)
		: maxAssetBytes;
	const requestInit: RequestInit = {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	};
	if (options.signal) requestInit.signal = options.signal;
	let response: Response;
	let cancelFetchOnAbort: (() => void) | undefined;
	try {
		const pendingResponse = fetchImpl(resolvedAssetUrl, requestInit);
		const aborted = options.signal
			? new Promise<never>((_resolve, reject) => {
					cancelFetchOnAbort = () => reject(runtimeAssetAbortReason(options.signal!));
					if (options.signal!.aborted) {
						cancelFetchOnAbort();
					} else {
						options.signal!.addEventListener('abort', cancelFetchOnAbort, {
							once: true
						});
					}
				})
			: undefined;
		if (options.signal) {
			void pendingResponse
				.then((lateResponse) => {
					if (options.signal!.aborted) {
						cancelResponseBody(lateResponse, runtimeAssetAbortReason(options.signal!));
					}
				})
				.catch(() => undefined);
		}
		response = aborted ? await Promise.race([pendingResponse, aborted]) : await pendingResponse;
	} catch (error) {
		throwIfRuntimeAssetAborted(options.signal);
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-rust bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`
		);
	} finally {
		if (cancelFetchOnAbort) {
			options.signal?.removeEventListener('abort', cancelFetchOnAbort);
		}
	}
	if (options.signal?.aborted) {
		const reason = runtimeAssetAbortReason(options.signal);
		cancelResponseBody(response, reason);
		throw reason;
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			cancelResponseBody(response);
			throwIfRuntimeAssetAborted(options.signal);
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} returned an invalid final URL: ${response.url}`
			);
		}
		if (finalUrl.href !== resolvedAssetUrl) {
			cancelResponseBody(response);
			throwIfRuntimeAssetAborted(options.signal);
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} returned an unexpected final URL: ${response.url}`
			);
		}
	}
	if (!response.ok) {
		cancelResponseBody(response);
		throwIfRuntimeAssetAborted(options.signal);
		if (
			!hasReceipt &&
			allowCompressedFallback &&
			!resolvedAssetUrlObject.pathname.endsWith('.gz')
		) {
			const compressedAssetUrl = new URL(resolvedAssetUrl);
			compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
			try {
				return await fetchRuntimeAssetBytes(
					compressedAssetUrl,
					assetLabel,
					fetchImpl,
					false,
					onProgress,
					options
				);
			} catch {
				throwIfRuntimeAssetAborted(options.signal);
			}
		}
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-rust bundle or a nested runtime asset is missing.`
		);
	}
	const assetBytes = await readResponseBytes(
		response,
		assetLabel,
		downloadLimit,
		onProgress,
		options.signal,
		deliveryBudget
	);
	const assetPreview = new TextDecoder()
		.decode(assetBytes.slice(0, 128))
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	const responseLooksLikeHtml =
		assetPreview.startsWith('<!doctype html') ||
		assetPreview.startsWith('<html') ||
		assetPreview.startsWith('<head') ||
		assetPreview.startsWith('<body');
	if (
		!hasReceipt &&
		allowCompressedFallback &&
		!resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		responseLooksLikeHtml
	) {
		const compressedAssetUrl = new URL(resolvedAssetUrl);
		compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
		try {
			return await fetchRuntimeAssetBytes(
				compressedAssetUrl,
				assetLabel,
				fetchImpl,
				false,
				onProgress,
				options
			);
		} catch {
			throwIfRuntimeAssetAborted(options.signal);
		}
	}
	if (!hasReceipt && responseLooksLikeHtml) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-rust runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-rust bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`
		);
	}
	let shouldDecompress =
		resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		assetBytes.byteLength >= 2 &&
		assetBytes[0] === 0x1f &&
		assetBytes[1] === 0x8b;
	if (hasReceipt) {
		const deliveredSha256 = await sha256Hex(assetBytes, options.signal);
		const matchesStorage =
			assetBytes.byteLength === receipt!.bytes && deliveredSha256 === receipt!.sha256;
		const hasDistinctLogicalReceipt = receipt!.uncompressedBytes !== undefined;
		const matchesLogical =
			hasDistinctLogicalReceipt &&
			assetBytes.byteLength === receipt!.uncompressedBytes &&
			deliveredSha256 === receipt!.uncompressedSha256;
		if (matchesLogical) {
			return assetBytes;
		}
		if (!matchesStorage) {
			const matchesStorageLength = assetBytes.byteLength === receipt!.bytes;
			const matchesLogicalLength =
				hasDistinctLogicalReceipt && assetBytes.byteLength === receipt!.uncompressedBytes;
			throw new Error(
				matchesStorageLength
					? `wasm-rust runtime asset ${assetLabel} storage SHA-256 differs from its receipt`
					: matchesLogicalLength
						? `wasm-rust runtime asset ${assetLabel} logical SHA-256 differs from its receipt`
						: `wasm-rust runtime asset ${assetLabel} delivered byte length differs from its storage and logical receipts`
			);
		}
		if (!hasDistinctLogicalReceipt) {
			return assetBytes;
		}
		if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} storage bytes match a compressed receipt but are not gzip data`
			);
		}
		shouldDecompress = true;
	}
	if (!shouldDecompress) return assetBytes;
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`
		);
	}
	try {
		const assetBuffer = new Uint8Array(assetBytes).buffer;
		const decompressedStream = new Blob([assetBuffer])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		const decompressedBytes = await readBoundedStream(
			decompressedStream,
			assetLabel,
			hasReceipt ? expectedLogicalBytes! : maxAssetBytes,
			'decompressed',
			undefined,
			undefined,
			options.signal
		);
		return hasReceipt
			? await verifyRuntimeAssetReceipt(
					assetLabel,
					decompressedBytes,
					receipt!,
					'logical',
					options.signal
				)
			: decompressedBytes;
	} catch (error) {
		throwIfRuntimeAssetAborted(options.signal);
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export async function fetchRuntimeAssetJson<T>(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	options: RuntimeAssetFetchOptions = {}
): Promise<T> {
	return JSON.parse(
		new TextDecoder().decode(
			await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, true, onProgress, options)
		)
	) as T;
}
