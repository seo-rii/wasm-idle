import { resolveVersionedAssetUrl } from './asset-url.js';
import type { RuntimeAssetIntegrity, RuntimeAssetIntegrityVerifier } from './types.js';

type RuntimeAssetProgressReporter = (loaded: number, total?: number) => void;
type RuntimeAssetCompression = 'gzip' | undefined;

function abortReason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('D runtime asset load aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal | null) {
	if (signal?.aborted) throw abortReason(signal);
}

function createRuntimeFetch(): typeof fetch {
	return (async (input: string | URL, init?: RequestInit) => {
		const signal = init?.signal;
		throwIfAborted(signal);
		const url = new URL(input.toString());
		if (url.protocol !== 'file:') return fetch(url, init);
		const [{ readFile }, { fileURLToPath }] = await Promise.all([
			import('node:fs/promises'),
			import('node:url')
		]);
		try {
			return new Response(
				await readFile(fileURLToPath(url), signal ? { signal } : undefined)
			);
		} catch (error) {
			if (signal?.aborted) throw abortReason(signal);
			const code =
				error && typeof error === 'object' && 'code' in error
					? (error as { code?: string }).code
					: '';
			return new Response(null, {
				status: code === 'ENOENT' ? 404 : 500
			});
		}
	}) as typeof fetch;
}

export const defaultFetch = createRuntimeFetch();

export const DEFAULT_MAX_RUNTIME_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_RUNTIME_ASSET_BUFFER_BYTES = 64 * 1024;

function toArrayBuffer(bytes: Uint8Array) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readContentLength(response: Response, assetLabel: string) {
	const value = response.headers.get('content-length');
	if (value === null) return undefined;
	const contentLength = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(contentLength)) {
		throw new Error(`D runtime asset ${assetLabel} has an invalid Content-Length`);
	}
	return contentLength;
}

async function readBoundedStream(
	stream: ReadableStream<Uint8Array>,
	assetLabel: string,
	maxOutputBytes: number,
	sizeKind: 'download size' | 'decompressed size',
	reportProgress?: RuntimeAssetProgressReporter,
	total?: number,
	signal?: AbortSignal
) {
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
		const reason = abortReason(signal);
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
					const reason = abortReason(signal);
					cancelReader(reason);
					reject(reason);
				};
				signal.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	let bytes = new Uint8Array(
		Math.min(maxOutputBytes, total || DEFAULT_RUNTIME_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	let loadedBytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		while (true) {
			throwIfAborted(signal);
			const pendingRead = reader.read();
			const { done, value } = aborted
				? await Promise.race([pendingRead, aborted])
				: await pendingRead;
			throwIfAborted(signal);
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				const error = new Error(
					`${assetLabel} ${sizeKind} exceeds the ${maxOutputBytes} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxOutputBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			reportProgress?.(receivedLength, total);
		}
		throwIfAborted(signal);
		reportProgress?.(receivedLength, total ?? receivedLength);
		loadedBytes = bytes.subarray(0, receivedLength);
	} catch (error) {
		if (signal?.aborted) {
			const reason = abortReason(signal);
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
	if (releaseFailure) throw releaseFailure.error;
	return loadedBytes;
}

async function decompressGzip(
	bytes: Uint8Array,
	assetLabel: string,
	maxOutputBytes: number,
	signal?: AbortSignal
) {
	throwIfAborted(signal);
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`cannot decompress gzip ${assetLabel}: DecompressionStream is not available`
		);
	}
	const stream = new Blob([toArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return await readBoundedStream(
		stream,
		assetLabel,
		maxOutputBytes,
		'decompressed size',
		undefined,
		undefined,
		signal
	);
}

function shouldDecompressResponse(response: Response, compression: RuntimeAssetCompression) {
	if (compression !== 'gzip') return false;
	const contentEncoding = response.headers.get('content-encoding') || '';
	return !contentEncoding
		.toLowerCase()
		.split(',')
		.map((value) => value.trim())
		.includes('gzip');
}

export async function fetchRuntimeAssetBytes(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = defaultFetch,
	reportProgress?: RuntimeAssetProgressReporter,
	compression?: RuntimeAssetCompression,
	maxOutputBytes = DEFAULT_MAX_RUNTIME_ASSET_BYTES,
	signal?: AbortSignal,
	integrity?: RuntimeAssetIntegrity,
	verifyIntegrity?: RuntimeAssetIntegrityVerifier
) {
	throwIfAborted(signal);
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error('D runtime asset byte limit must be a non-negative safe integer');
	}
	if (integrity) {
		if (
			!Number.isSafeInteger(integrity.bytes) ||
			integrity.bytes <= 0 ||
			!Number.isSafeInteger(integrity.uncompressedBytes) ||
			integrity.uncompressedBytes <= 0 ||
			!/^[0-9a-f]{64}$/u.test(integrity.sha256) ||
			!/^[0-9a-f]{64}$/u.test(integrity.uncompressedSha256)
		) {
			throw new Error(`D runtime asset ${assetLabel} has invalid integrity metadata`);
		}
		if (!verifyIntegrity) {
			throw new Error(`D runtime asset ${assetLabel} requires an integrity verifier`);
		}
		if (integrity.bytes > maxOutputBytes) {
			throw new Error(`${assetLabel} download size exceeds the ${maxOutputBytes} byte limit`);
		}
		if (integrity.uncompressedBytes > maxOutputBytes) {
			throw new Error(
				`${assetLabel} decompressed size exceeds the ${maxOutputBytes} byte limit`
			);
		}
	}
	const resolvedUrl = new URL(assetUrl.toString());
	if (!['file:', 'http:', 'https:'].includes(resolvedUrl.protocol)) {
		throw new Error(`unsupported D runtime asset URL scheme: ${resolvedUrl.protocol}`);
	}
	if (resolvedUrl.hash) throw new Error('D runtime asset URLs must not include fragments');
	if (resolvedUrl.username || resolvedUrl.password) {
		throw new Error('D runtime asset URLs must not include credentials');
	}
	const resolvedAssetUrl = resolvedUrl.href;
	let response: Response;
	try {
		const pendingResponse = Promise.resolve(
			fetchImpl(resolvedAssetUrl, {
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				...(signal ? { signal } : {})
			})
		);
		if (!signal) {
			response = await pendingResponse;
		} else {
			response = await new Promise<Response>((resolve, reject) => {
				let settled = false;
				const cancelOnAbort = () => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', cancelOnAbort);
					reject(abortReason(signal));
				};
				signal.addEventListener('abort', cancelOnAbort, { once: true });
				pendingResponse.then(
					(fetchedResponse) => {
						if (settled) {
							void Promise.resolve()
								.then(() => fetchedResponse.body?.cancel(abortReason(signal)))
								.catch(() => {});
							return;
						}
						settled = true;
						signal.removeEventListener('abort', cancelOnAbort);
						resolve(fetchedResponse);
					},
					(error) => {
						if (settled) return;
						settled = true;
						signal.removeEventListener('abort', cancelOnAbort);
						reject(error);
					}
				);
				if (signal.aborted) cancelOnAbort();
			});
		}
	} catch (error) {
		if (signal?.aborted) throw abortReason(signal);
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (signal?.aborted) {
		const reason = abortReason(signal);
		await response.body?.cancel(reason).catch(() => {});
		throw reason;
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			await response.body?.cancel().catch(() => {});
			throw new Error(`D runtime asset ${assetLabel} returned an invalid final URL`);
		}
		if (finalUrl.href !== resolvedAssetUrl) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`D runtime asset ${assetLabel} returned an unexpected final URL`);
		}
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status})`
		);
	}
	let contentLength: number | undefined;
	try {
		contentLength = readContentLength(response, assetLabel);
	} catch (error) {
		await response.body?.cancel(error).catch(() => {});
		throw error;
	}
	if (contentLength !== undefined && contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`${assetLabel} download size exceeds the ${maxOutputBytes} byte limit`);
	}
	const shouldDecompress = shouldDecompressResponse(response, compression);
	const wasTransparentlyDecoded = compression === 'gzip' && !shouldDecompress;
	if (integrity && contentLength !== undefined && contentLength !== integrity.bytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`${assetLabel} download size mismatch: expected ${integrity.bytes} bytes, received ${contentLength}`
		);
	}
	if (integrity && verifyIntegrity) {
		const observedByteLimit = wasTransparentlyDecoded
			? integrity.uncompressedBytes
			: integrity.bytes;
		let observedBytes: Uint8Array;
		if (!response.body) {
			let cancelOnAbort: (() => void) | undefined;
			const aborted = signal
				? new Promise<never>((_resolve, reject) => {
						cancelOnAbort = () => reject(abortReason(signal));
						signal.addEventListener('abort', cancelOnAbort, { once: true });
					})
				: undefined;
			try {
				throwIfAborted(signal);
				const materialized = response.arrayBuffer();
				const source = aborted
					? await Promise.race([materialized, aborted])
					: await materialized;
				throwIfAborted(signal);
				observedBytes = new Uint8Array(source);
			} finally {
				if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
			}
			if (observedBytes.byteLength > observedByteLimit) {
				throw new Error(
					`${assetLabel} download size exceeds the ${observedByteLimit} byte limit`
				);
			}
			reportProgress?.(observedBytes.byteLength, observedByteLimit);
		} else {
			observedBytes = await readBoundedStream(
				response.body,
				assetLabel,
				observedByteLimit,
				'download size',
				reportProgress,
				observedByteLimit,
				signal
			);
		}
		if (observedBytes.byteLength !== observedByteLimit) {
			throw new Error(
				`${assetLabel} download size mismatch: expected ${observedByteLimit} bytes, received ${observedBytes.byteLength}`
			);
		}
		throwIfAborted(signal);
		let cancelVerificationOnAbort: (() => void) | undefined;
		const verificationAborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelVerificationOnAbort = () => reject(abortReason(signal));
					signal.addEventListener('abort', cancelVerificationOnAbort, { once: true });
				})
			: undefined;
		try {
			if (!wasTransparentlyDecoded) {
				const deliveryVerification = verifyIntegrity({
					asset: assetLabel,
					bytes: observedBytes,
					expected: integrity,
					stage: 'compressed',
					runtimeId: 'D'
				});
				await (verificationAborted
					? Promise.race([deliveryVerification, verificationAborted])
					: deliveryVerification);
				throwIfAborted(signal);
			}
			const runtimeBytes = shouldDecompress
				? await decompressGzip(
						observedBytes,
						assetLabel,
						integrity.uncompressedBytes,
						signal
					)
				: observedBytes;
			if (runtimeBytes.byteLength !== integrity.uncompressedBytes) {
				throw new Error(
					`${assetLabel} decompressed size mismatch: expected ${integrity.uncompressedBytes} bytes, received ${runtimeBytes.byteLength}`
				);
			}
			throwIfAborted(signal);
			const runtimeVerification = verifyIntegrity({
				asset: assetLabel,
				bytes: runtimeBytes,
				expected: integrity,
				stage: 'uncompressed',
				runtimeId: 'D'
			});
			await (verificationAborted
				? Promise.race([runtimeVerification, verificationAborted])
				: runtimeVerification);
			throwIfAborted(signal);
			return runtimeBytes;
		} finally {
			if (cancelVerificationOnAbort) {
				signal?.removeEventListener('abort', cancelVerificationOnAbort);
			}
		}
	}
	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () => reject(abortReason(signal));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		let source: ArrayBuffer;
		try {
			throwIfAborted(signal);
			const materialized = response.arrayBuffer();
			source = aborted ? await Promise.race([materialized, aborted]) : await materialized;
			throwIfAborted(signal);
		} finally {
			if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		}
		const bytes = new Uint8Array(source);
		if (bytes.byteLength > maxOutputBytes) {
			throw new Error(`${assetLabel} download size exceeds the ${maxOutputBytes} byte limit`);
		}
		reportProgress?.(bytes.byteLength, bytes.byteLength);
		return shouldDecompress
			? await decompressGzip(bytes, assetLabel, maxOutputBytes, signal)
			: bytes;
	}
	if (shouldDecompress) {
		if (typeof DecompressionStream !== 'function') {
			await response.body.cancel().catch(() => {});
			throw new Error(
				`cannot decompress gzip ${assetLabel}: DecompressionStream is not available`
			);
		}
		let receivedLength = 0;
		const limitedDownload = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					throwIfAborted(signal);
					const nextLength = receivedLength + chunk.byteLength;
					if (nextLength > maxOutputBytes) {
						throw new Error(
							`${assetLabel} download size exceeds the ${maxOutputBytes} byte limit`
						);
					}
					receivedLength = nextLength;
					reportProgress?.(receivedLength, contentLength);
					controller.enqueue(chunk);
				},
				flush() {
					throwIfAborted(signal);
					reportProgress?.(receivedLength, contentLength ?? receivedLength);
				}
			})
		);
		const decompressor = new DecompressionStream('gzip');
		const decompressed = limitedDownload.pipeThrough({
			readable: decompressor.readable as ReadableStream<Uint8Array>,
			writable: decompressor.writable as WritableStream<Uint8Array>
		});
		return await readBoundedStream(
			decompressed,
			assetLabel,
			maxOutputBytes,
			'decompressed size',
			undefined,
			undefined,
			signal
		);
	}
	return await readBoundedStream(
		response.body,
		assetLabel,
		maxOutputBytes,
		'download size',
		reportProgress,
		contentLength,
		signal
	);
}

export async function fetchRuntimeAssetJson<T>(
	baseUrl: string | URL,
	asset: string,
	assetLabel: string,
	fetchImpl: typeof fetch = defaultFetch,
	reportProgress?: RuntimeAssetProgressReporter,
	compression?: RuntimeAssetCompression,
	maxOutputBytes = DEFAULT_MAX_RUNTIME_ASSET_BYTES,
	signal?: AbortSignal
) {
	const bytes = await fetchRuntimeAssetBytes(
		resolveVersionedAssetUrl(baseUrl, asset),
		assetLabel,
		fetchImpl,
		reportProgress,
		compression,
		maxOutputBytes,
		signal
	);
	throwIfAborted(signal);
	return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
