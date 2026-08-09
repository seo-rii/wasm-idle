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

export function resolveRuntimeAssetUrl(value: string, label: string) {
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
	const reason = signal.reason;
	return reason !== undefined
		? reason
		: new DOMException('The runtime asset download was aborted', 'AbortError');
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

	let abortFailure: unknown;
	let abortRejection: { reason: unknown } | undefined;
	let selectedStreamFailure: { reason: unknown } | undefined;
	let abortSettled = false;
	let abortReasonReading = false;
	let rejectAbort: ((reason?: unknown) => void) | undefined;
	let cleanupCurrentResource: ((reason: unknown) => void) | undefined;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				rejectAbort = reject;
			})
		: undefined;
	if (aborted) void aborted.catch(() => undefined);
	const settleAbort = (reason: unknown) => {
		if (abortSettled) return;
		abortSettled = true;
		abortFailure = reason;
		abortRejection = { reason };
		const cleanup = cleanupCurrentResource;
		cleanupCurrentResource = undefined;
		try {
			cleanup?.(reason);
		} catch {
			// Preserve the first observed abort outcome.
		}
		rejectAbort?.(abortRejection);
	};
	const onAbort = () => {
		if (abortSettled || abortReasonReading || !signal) return;
		abortReasonReading = true;
		let reason: unknown;
		try {
			reason = abortReason(signal);
		} catch (error) {
			reason = error;
		} finally {
			abortReasonReading = false;
		}
		settleAbort(reason);
	};
	const throwIfObservedAbort = () => {
		if (abortSettled) throw abortRejection;
		if (!signal) return;
		let signalAborted: boolean;
		try {
			signalAborted = signal.aborted;
		} catch (error) {
			if (!abortSettled) settleAbort(error);
			throw abortRejection;
		}
		if (signalAborted) onAbort();
		if (abortSettled) throw abortRejection;
	};
	let abortListenerRegistrationAttempted = false;

	try {
		if (signal) {
			abortListenerRegistrationAttempted = true;
			try {
				signal.addEventListener('abort', onAbort, { once: true });
			} catch (error) {
				throwIfObservedAbort();
				throw error;
			}
			throwIfObservedAbort();
		}
		const requestUrl = resolveRuntimeAssetUrl(url, label);
		const requestInit: RequestInit = {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		};
		if (cache) requestInit.cache = cache;
		if (signal) requestInit.signal = signal;

		let pendingResponse: Promise<Response>;
		try {
			pendingResponse = Promise.resolve(fetch(requestUrl.href, requestInit));
		} catch (error) {
			throwIfObservedAbort();
			throw error;
		}
		let response: Response;
		try {
			throwIfObservedAbort();
			response = aborted
				? await Promise.race([pendingResponse, aborted])
				: await pendingResponse;
		} catch (error) {
			if (abortSettled && error === abortRejection) {
				const reason = abortFailure;
				void pendingResponse.then(
					(candidate) => cancelResponseBody(candidate, reason),
					() => undefined
				);
			}
			throw error;
		}
		cleanupCurrentResource = (reason) => cancelResponseBody(response, reason);
		throwIfObservedAbort();

		let total: number | undefined;
		let responseBody: Response['body'];
		try {
			if (response.url) {
				let responseUrl: URL;
				try {
					responseUrl = new URL(response.url);
				} catch {
					throw new Error(`${label} response URL is invalid: ${response.url}`);
				}
				if (responseUrl.href !== requestUrl.href) {
					throw new Error(
						`${label} response URL mismatch: expected ${requestUrl.href}, received ${responseUrl.href}`
					);
				}
			}
			if (!response.ok) {
				throw new Error(
					`failed to load ${label} from ${requestUrl.href}: ${response.status}`
				);
			}

			const rawContentLength = response.headers.get('content-length');
			if (rawContentLength !== null) {
				const normalizedContentLength = rawContentLength.trim();
				const parsedContentLength = Number(normalizedContentLength);
				if (
					!/^\d+$/u.test(normalizedContentLength) ||
					!Number.isSafeInteger(parsedContentLength)
				) {
					throw new Error(`${label} has an invalid Content-Length`);
				}
				total = parsedContentLength;
			}
			if (total !== undefined && total > maxAssetBytes) {
				throw new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
			}
			responseBody = response.body;
		} catch (error) {
			throwIfObservedAbort();
			throw error;
		}
		throwIfObservedAbort();

		if (!responseBody) {
			throwIfObservedAbort();
			let materialized: Promise<ArrayBuffer>;
			try {
				materialized = response.arrayBuffer();
			} catch (error) {
				throwIfObservedAbort();
				throw error;
			}
			void materialized.catch(() => undefined);
			throwIfObservedAbort();
			const source = aborted
				? await Promise.race([materialized, aborted])
				: await materialized;
			throwIfObservedAbort();
			const bytes = new Uint8Array(source);
			if (bytes.byteLength > maxAssetBytes) {
				throw new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
			}
			try {
				onProgress?.({ loaded: bytes.byteLength, total: total ?? bytes.byteLength });
			} catch (error) {
				throwIfObservedAbort();
				throw error;
			}
			throwIfObservedAbort();
			cleanupCurrentResource = undefined;
			if (signal && abortListenerRegistrationAttempted) {
				abortListenerRegistrationAttempted = false;
				try {
					signal.removeEventListener('abort', onAbort);
				} catch {
					// Listener cleanup must not replace a successful download.
				}
				throwIfObservedAbort();
			}
			return bytes;
		}

		let reader: ReturnType<NonNullable<Response['body']>['getReader']>;
		try {
			reader = responseBody.getReader();
		} catch (error) {
			throwIfObservedAbort();
			throw error;
		}
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
		cleanupCurrentResource = cancelReader;

		let receivedLength = 0;
		let bytes!: Uint8Array<ArrayBuffer>;
		let releaseFailure: { error: unknown } | undefined;
		try {
			throwIfObservedAbort();
			bytes = new Uint8Array(Math.min(maxAssetBytes, total ?? DEFAULT_STREAM_BUFFER_BYTES));
			while (true) {
				throwIfObservedAbort();
				let pendingRead: ReturnType<typeof reader.read>;
				try {
					pendingRead = reader.read();
				} catch (error) {
					throwIfObservedAbort();
					throw error;
				}
				void pendingRead.catch(() => undefined);
				throwIfObservedAbort();
				const { done, value } = aborted
					? await Promise.race([pendingRead, aborted])
					: await pendingRead;
				throwIfObservedAbort();
				if (done) break;
				if (!value) continue;
				const nextLength = receivedLength + value.byteLength;
				if (nextLength > maxAssetBytes) {
					throw new Error(`${label} exceeds the ${maxAssetBytes} byte limit`);
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
				try {
					onProgress?.({ loaded: receivedLength, total });
				} catch (error) {
					throwIfObservedAbort();
					throw error;
				}
				throwIfObservedAbort();
			}
		} catch (error) {
			const failure = abortSettled && error === abortRejection ? abortFailure : error;
			const cleanup = cleanupCurrentResource;
			cleanupCurrentResource = undefined;
			try {
				cleanup?.(failure);
			} catch {
				// Preserve the selected stream failure.
			}
			selectedStreamFailure = { reason: failure };
		} finally {
			try {
				reader.releaseLock();
			} catch (error) {
				if (!abortSettled) releaseFailure = { error };
			}
		}
		if (selectedStreamFailure) throw selectedStreamFailure;
		throwIfObservedAbort();
		if (releaseFailure) throw releaseFailure.error;

		if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
		try {
			onProgress?.({ loaded: receivedLength, total: total ?? receivedLength });
		} catch (error) {
			throwIfObservedAbort();
			throw error;
		}
		throwIfObservedAbort();
		cleanupCurrentResource = undefined;
		if (signal && abortListenerRegistrationAttempted) {
			abortListenerRegistrationAttempted = false;
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace a successful download.
			}
			throwIfObservedAbort();
		}
		return bytes;
	} catch (error) {
		const failure =
			selectedStreamFailure && error === selectedStreamFailure
				? selectedStreamFailure.reason
				: abortSettled && error === abortRejection
					? abortFailure
					: error;
		const cleanup = cleanupCurrentResource;
		cleanupCurrentResource = undefined;
		try {
			cleanup?.(failure);
		} catch {
			// Preserve the operation failure when cleanup is hostile.
		}
		throw failure;
	} finally {
		if (signal && abortListenerRegistrationAttempted) {
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation outcome.
			}
		}
	}
}
