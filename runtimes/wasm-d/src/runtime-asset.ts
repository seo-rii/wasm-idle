import { resolveVersionedAssetUrl } from './asset-url.js';

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

function readContentLength(response: Response) {
	const value = response.headers.get('content-length');
	if (!value || !/^\d+$/u.test(value)) return undefined;
	const contentLength = Number(value);
	return Number.isSafeInteger(contentLength) ? contentLength : undefined;
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
	const cancelOnAbort = () => {
		void reader.cancel(abortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(maxOutputBytes, total || DEFAULT_RUNTIME_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	try {
		throwIfAborted(signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				throw new Error(
					`${assetLabel} ${sizeKind} exceeds the ${maxOutputBytes} byte limit`
				);
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
		return bytes.subarray(0, receivedLength);
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		if (signal?.aborted) throw abortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
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
	signal?: AbortSignal
) {
	throwIfAborted(signal);
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error('D runtime asset byte limit must be a non-negative safe integer');
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
		response = await fetchImpl(resolvedAssetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			...(signal ? { signal } : {})
		});
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
	if (response.url && new URL(response.url).href !== resolvedAssetUrl) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`D runtime asset ${assetLabel} returned an unexpected final URL: ${response.url}`
		);
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status})`
		);
	}
	const contentLength = readContentLength(response);
	if (contentLength !== undefined && contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`${assetLabel} download size exceeds the ${maxOutputBytes} byte limit`);
	}
	const shouldDecompress = shouldDecompressResponse(response, compression);
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		throwIfAborted(signal);
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
