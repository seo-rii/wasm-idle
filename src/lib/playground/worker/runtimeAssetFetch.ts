export interface RuntimeAssetDownloadProgress {
	loaded: number;
	total?: number;
}

export interface RuntimeAssetFetchOptions {
	url: string;
	label: string;
	cache?: RequestCache;
	maxAssetBytes?: number;
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void;
	signal?: AbortSignal;
}

export const DEFAULT_RUNTIME_ASSET_MAX_BYTES = 128 * 1024 * 1024;

const DEFAULT_STREAM_BUFFER_BYTES = 64 * 1024;

function resolveRuntimeAssetUrl(value: string, label: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} URL is invalid: ${value}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${label} URL must use HTTP(S): ${value}`);
	}
	if (url.username || url.password || url.hash) {
		throw new Error(`${label} URL must not include credentials or a fragment: ${value}`);
	}
	if (/%2f|%5c/iu.test(url.pathname)) {
		throw new Error(`${label} URL must not include encoded path separators: ${value}`);
	}
	return url;
}

function cancelResponseBody(response: Response, reason?: unknown) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the validation or HTTP failure that caused cancellation.
	}
}

function abortReason(signal: AbortSignal) {
	return (
		signal.reason ?? new DOMException('The runtime asset download was aborted', 'AbortError')
	);
}

function throwIfAborted(signal?: AbortSignal) {
	if (!signal?.aborted) return;
	throw abortReason(signal);
}

export async function fetchRuntimeAssetBytes({
	url,
	label,
	cache,
	maxAssetBytes = DEFAULT_RUNTIME_ASSET_MAX_BYTES,
	onProgress,
	signal
}: RuntimeAssetFetchOptions) {
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new TypeError('Runtime asset maxAssetBytes must be a positive safe integer');
	}
	throwIfAborted(signal);
	const requestUrl = resolveRuntimeAssetUrl(url, label);
	const requestInit: RequestInit = {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	};
	if (cache) requestInit.cache = cache;
	if (signal) requestInit.signal = signal;
	const pendingResponse = Promise.resolve(fetch(requestUrl.href, requestInit));
	const response = signal
		? await new Promise<Response>((resolve, reject) => {
				let settled = false;
				const onAbort = () => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', onAbort);
					reject(abortReason(signal));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				void pendingResponse.then(
					(candidate) => {
						if (settled) {
							void cancelResponseBody(candidate, abortReason(signal));
							return;
						}
						settled = true;
						signal.removeEventListener('abort', onAbort);
						resolve(candidate);
					},
					(error) => {
						if (settled) return;
						settled = true;
						signal.removeEventListener('abort', onAbort);
						reject(error);
					}
				);
				if (signal.aborted) onAbort();
			})
		: await pendingResponse;
	if (signal?.aborted) {
		cancelResponseBody(response, abortReason(signal));
		throwIfAborted(signal);
	}

	if (response.url) {
		let responseUrl: URL;
		try {
			responseUrl = new URL(response.url);
		} catch {
			const error = new Error(`${label} response URL is invalid: ${response.url}`);
			cancelResponseBody(response, error);
			throw error;
		}
		if (responseUrl.href !== requestUrl.href) {
			const error = new Error(
				`${label} response URL mismatch: expected ${requestUrl.href}, received ${responseUrl.href}`
			);
			cancelResponseBody(response, error);
			throw error;
		}
	}
	if (!response.ok) {
		const error = new Error(
			`failed to load ${label} from ${requestUrl.href}: ${response.status}`
		);
		cancelResponseBody(response, error);
		throw error;
	}

	const rawContentLength = response.headers.get('content-length');
	let total: number | undefined;
	if (rawContentLength !== null) {
		const normalizedContentLength = rawContentLength.trim();
		const parsedContentLength = Number(normalizedContentLength);
		if (!/^\d+$/u.test(normalizedContentLength) || !Number.isSafeInteger(parsedContentLength)) {
			const error = new Error(`${label} has an invalid Content-Length`);
			cancelResponseBody(response, error);
			throw error;
		}
		total = parsedContentLength;
	}
	if (total !== undefined && total > maxAssetBytes) {
		const error = new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
		cancelResponseBody(response, error);
		throw error;
	}

	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () => reject(abortReason(signal));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		if (aborted) void aborted.catch(() => undefined);
		try {
			throwIfAborted(signal);
			const materialized = response.arrayBuffer();
			const source = aborted
				? await Promise.race([materialized, aborted])
				: await materialized;
			throwIfAborted(signal);
			const bytes = new Uint8Array(source);
			if (bytes.byteLength > maxAssetBytes) {
				throw new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
			}
			onProgress?.({ loaded: bytes.byteLength, total: total ?? bytes.byteLength });
			return bytes;
		} finally {
			if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		}
	}

	const reader = response.body.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
		} catch {
			// Preserve the abort, stream, or size-limit failure.
		}
	};
	if (signal?.aborted) {
		const reason = abortReason(signal);
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {
			// Preserve the abort reason when the reader cannot release immediately.
		}
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
	if (aborted) void aborted.catch(() => undefined);
	if (signal?.aborted) cancelOnAbort?.();
	let receivedLength = 0;
	let bytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		bytes = new Uint8Array(Math.min(maxAssetBytes, total ?? DEFAULT_STREAM_BUFFER_BYTES));
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
			if (nextLength > maxAssetBytes) {
				const error = new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxAssetBytes,
					Math.max(nextLength, bytes.byteLength * 2)
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			onProgress?.({ loaded: receivedLength, total });
		}
	} catch (error) {
		cancelReader(signal?.aborted ? abortReason(signal) : error);
		throwIfAborted(signal);
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

	if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
	onProgress?.({ loaded: receivedLength, total: total ?? receivedLength });
	return bytes;
}
