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
		response = await fetchImpl(requestUrl, {
			cache: options.cache,
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: options.signal
		});
	} catch (error) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		throw new Error(
			`Failed to load ${options.label} from ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (expectedFinalUrl && response.url && new URL(response.url).href !== expectedFinalUrl) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`${options.label} returned an unexpected final URL: ${response.url}`);
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load ${options.label} from ${requestUrl}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	const contentLength =
		contentLengthValue && /^\d+$/u.test(contentLengthValue)
			? Number(contentLengthValue)
			: undefined;
	if (
		contentLength !== undefined &&
		(!Number.isSafeInteger(contentLength) || contentLength > maxBytes)
	) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`${options.label} exceeds the ${maxBytes} byte download limit`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) {
			throw new Error(`${options.label} exceeds the ${maxBytes} byte download limit`);
		}
		options.reportProgress?.(bytes.byteLength, contentLength ?? bytes.byteLength);
		return bytes;
	}

	const reader = response.body.getReader();
	const cancelOnAbort = () => {
		void reader.cancel(abortReason(options.signal!)).catch(() => {});
	};
	options.signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(maxBytes, contentLength ?? DEFAULT_EXTERNAL_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	try {
		if (options.signal?.aborted) throw abortReason(options.signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxBytes) {
				throw new Error(`${options.label} exceeds the ${maxBytes} byte download limit`);
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
		return bytes.subarray(0, receivedLength);
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		if (options.signal?.aborted) throw abortReason(options.signal);
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}
