export const DEFAULT_MAX_EXTERNAL_ASSET_BYTES = 128 * 1024 * 1024;

const DEFAULT_EXTERNAL_ASSET_BUFFER_BYTES = 64 * 1024;
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/u;
const FALLBACK_URL_BASE = 'https://wasm-idle.invalid/';

export interface FetchBoundedExternalAssetOptions {
	url: string | URL;
	label: string;
	fetch?: typeof fetch;
	signal?: AbortSignal;
	maxBytes?: number;
	cache?: RequestCache;
	reportProgress?: (loaded: number, total?: number) => void;
}

function resolveExternalAssetUrl(input: string | URL) {
	const value = input instanceof URL ? input.href : input;
	const currentUrl = globalThis.location?.href;
	let url: URL;
	try {
		url = new URL(value, currentUrl || FALLBACK_URL_BASE);
	} catch {
		throw new Error(`Invalid external runtime asset URL: ${value}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Unsupported external runtime asset URL scheme: ${url.protocol}`);
	}
	if (url.hash) throw new Error('External runtime asset URLs must not include fragments');
	if (url.username || url.password) {
		throw new Error('External runtime asset URLs must not include credentials');
	}
	const hasResolvableBase =
		input instanceof URL || ABSOLUTE_URL_PATTERN.test(value) || !!currentUrl;
	return {
		requestUrl: hasResolvableBase ? url.href : value,
		expectedFinalUrl: hasResolvableBase ? url.href : undefined
	};
}

function abortReason(signal: AbortSignal) {
	return signal.reason ?? new Error('External runtime asset load was aborted');
}

export async function fetchBoundedExternalAsset(
	options: FetchBoundedExternalAssetOptions
): Promise<Uint8Array<ArrayBuffer>> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_EXTERNAL_ASSET_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new Error('External runtime asset maxBytes must be a non-negative safe integer');
	}
	if (options.signal?.aborted) throw abortReason(options.signal);
	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error(`fetch is required to load ${options.label}`);
	const { requestUrl, expectedFinalUrl } = resolveExternalAssetUrl(options.url);
	let response: Response;
	try {
		const pendingResponse = Promise.resolve(
			fetchImpl(requestUrl, {
				cache: options.cache,
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: options.signal
			})
		);
		if (!options.signal) {
			response = await pendingResponse;
		} else {
			const signal = options.signal;
			response = await new Promise<Response>((resolve, reject) => {
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
							const reason = abortReason(signal);
							void Promise.resolve()
								.then(() => candidate.body?.cancel(reason))
								.catch(() => {});
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
			});
		}
	} catch (error) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		throw new Error(
			`Failed to load ${options.label} from ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (options.signal?.aborted) {
		const reason = abortReason(options.signal);
		await response.body?.cancel(reason).catch(() => {});
		throw reason;
	}
	if (expectedFinalUrl && response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${options.label} returned an invalid final URL`);
		}
		if (finalUrl.href !== expectedFinalUrl) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${options.label} returned an unexpected final URL`);
		}
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load ${options.label} from ${requestUrl}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (contentLengthValue !== null) {
		contentLength = Number(contentLengthValue);
		if (!/^\d+$/u.test(contentLengthValue) || !Number.isSafeInteger(contentLength)) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${options.label} has an invalid Content-Length`);
		}
	}
	if (contentLength !== undefined && contentLength > maxBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`${options.label} exceeds the ${maxBytes} byte download limit`);
	}
	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = options.signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () => reject(abortReason(options.signal!));
					options.signal!.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		try {
			if (options.signal?.aborted) throw abortReason(options.signal);
			const buffer = response.arrayBuffer();
			const bytes = new Uint8Array(
				aborted ? await Promise.race([buffer, aborted]) : await buffer
			);
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (bytes.byteLength > maxBytes) {
				throw new Error(`${options.label} exceeds the ${maxBytes} byte download limit`);
			}
			options.reportProgress?.(bytes.byteLength, contentLength ?? bytes.byteLength);
			return bytes;
		} finally {
			if (cancelOnAbort) options.signal?.removeEventListener('abort', cancelOnAbort);
		}
	}

	const reader = response.body.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void reader.cancel(reason).catch(() => {});
		} catch {}
	};
	if (options.signal?.aborted) {
		const reason = abortReason(options.signal);
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = options.signal
		? new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => {
					const reason = abortReason(options.signal!);
					cancelReader(reason);
					reject(reason);
				};
				options.signal!.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	let bytes = new Uint8Array(
		Math.min(maxBytes, contentLength ?? DEFAULT_EXTERNAL_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	let loadedBytes!: Uint8Array<ArrayBuffer>;
	let releaseError: unknown;
	try {
		while (true) {
			if (options.signal?.aborted) throw abortReason(options.signal);
			const pendingRead = reader.read();
			const { done, value } = aborted
				? await Promise.race([pendingRead, aborted])
				: await pendingRead;
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxBytes) {
				const error = new Error(
					`${options.label} exceeds the ${maxBytes} byte download limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			options.reportProgress?.(receivedLength, contentLength);
		}
		if (options.signal?.aborted) throw abortReason(options.signal);
		options.reportProgress?.(receivedLength, contentLength ?? receivedLength);
		loadedBytes = bytes.subarray(0, receivedLength);
	} catch (error) {
		if (options.signal?.aborted) {
			const reason = abortReason(options.signal);
			cancelReader(reason);
			throw reason;
		}
		cancelReader(error);
		throw error;
	} finally {
		if (cancelOnAbort) options.signal?.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch (error) {
			if (!options.signal?.aborted) releaseError = error;
		}
	}
	if (releaseError) throw releaseError;
	return loadedBytes;
}
