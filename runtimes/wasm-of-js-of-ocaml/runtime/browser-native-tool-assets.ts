export const DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_BROWSER_TOOL_INPUT_BYTES = 128 * 1024 * 1024;

const DEFAULT_BROWSER_TOOL_ASSET_BUFFER_BYTES = 64 * 1024;

export type BrowserToolInputLimits = {
	maxAssetBytes?: number;
	maxTotalBytes?: number;
};

export type BrowserToolInputBudget = {
	readonly maxAssetBytes: number;
	readonly maxTotalBytes: number;
	usedBytes: number;
};

export type BrowserToolAssetReceipt = {
	bytes: number;
	sha256: string;
};

export type BrowserToolAssetDescriptor = BrowserToolAssetReceipt & {
	url: string;
};

export type BrowserToolAssetOptions = {
	baseUrl?: string | URL;
	cache?: RequestCache;
	fetch?: typeof fetch;
	receipt?: BrowserToolAssetReceipt;
	signal?: AbortSignal;
};

function requirePositiveSafeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive safe integer`);
	}
	return value;
}

export function validateBrowserToolAssetReceipt(
	value: unknown,
	label: string,
	maxBytes = DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES
): BrowserToolAssetReceipt {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		!Number.isSafeInteger((value as BrowserToolAssetReceipt).bytes) ||
		(value as BrowserToolAssetReceipt).bytes <= 0 ||
		(value as BrowserToolAssetReceipt).bytes > maxBytes ||
		typeof (value as BrowserToolAssetReceipt).sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/u.test((value as BrowserToolAssetReceipt).sha256)
	) {
		throw new Error(`${label} has an invalid or oversized asset receipt`);
	}
	return value as BrowserToolAssetReceipt;
}

export function createBrowserToolInputBudget(
	limits: BrowserToolInputLimits = {}
): BrowserToolInputBudget {
	const maxAssetBytes = requirePositiveSafeInteger(
		limits.maxAssetBytes ?? DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES,
		'maxAssetBytes'
	);
	const maxTotalBytes = requirePositiveSafeInteger(
		limits.maxTotalBytes ?? DEFAULT_MAX_BROWSER_TOOL_INPUT_BYTES,
		'maxTotalBytes'
	);
	if (maxAssetBytes > maxTotalBytes) {
		throw new TypeError('maxAssetBytes must not exceed maxTotalBytes');
	}
	return { maxAssetBytes, maxTotalBytes, usedBytes: 0 };
}

export function accountBrowserToolInputBytes(
	budget: BrowserToolInputBudget,
	label: string,
	byteLength: number
) {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new TypeError(`${label} has an invalid byte length`);
	}
	if (byteLength > budget.maxAssetBytes) {
		throw new Error(`${label} exceeds the ${budget.maxAssetBytes} byte asset limit`);
	}
	const nextUsedBytes = budget.usedBytes + byteLength;
	if (!Number.isSafeInteger(nextUsedBytes) || nextUsedBytes > budget.maxTotalBytes) {
		throw new Error(
			`browser-native tool inputs exceed the ${budget.maxTotalBytes} byte aggregate limit`
		);
	}
	budget.usedBytes = nextUsedBytes;
}

function abortReason(signal: AbortSignal) {
	return (
		signal.reason ?? new DOMException('browser-native tool asset load aborted', 'AbortError')
	);
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw abortReason(signal);
}

function resolveBrowserToolAssetUrl(value: string, baseUrl?: string | URL) {
	const configuredBase = baseUrl instanceof URL ? baseUrl.href : baseUrl;
	let resolved: URL;
	try {
		resolved = configuredBase
			? new URL(value, configuredBase)
			: new URL(value, globalThis.location?.href);
	} catch {
		throw new Error(`invalid browser-native tool asset URL: ${value}`);
	}
	if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
		throw new Error(`unsupported browser-native tool asset URL scheme: ${resolved.protocol}`);
	}
	if (resolved.username || resolved.password || resolved.hash) {
		throw new Error('browser-native tool asset URLs must not include credentials or fragments');
	}
	return resolved;
}

async function cancelResponse(response: Response, reason?: unknown) {
	try {
		await response.body?.cancel(reason);
	} catch {
		// Preserve the boundary failure that caused cancellation.
	}
}

function parseContentLength(response: Response, label: string) {
	const raw = response.headers.get('content-length');
	if (raw === null) return undefined;
	const normalized = raw.trim();
	const parsed = Number(normalized);
	if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
		throw new Error(`${label} has an invalid Content-Length`);
	}
	return parsed;
}

async function readBrowserToolAssetBody(
	response: Response,
	label: string,
	budget: BrowserToolInputBudget,
	contentLength: number | undefined,
	signal?: AbortSignal
) {
	if (!response.body) {
		if (contentLength === 0) return new Uint8Array();
		throw new Error(`${label} has no readable response body`);
	}

	const reader = response.body.getReader();
	const cancelOnAbort = () => {
		void reader.cancel(abortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(
			budget.maxAssetBytes,
			Math.max(contentLength ?? DEFAULT_BROWSER_TOOL_ASSET_BUFFER_BYTES, 1)
		)
	);
	let receivedBytes = 0;
	let accountedBytes = contentLength ?? 0;
	let readerCancelled = false;
	try {
		throwIfAborted(signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextReceivedBytes = receivedBytes + value.byteLength;
			if (
				!Number.isSafeInteger(nextReceivedBytes) ||
				nextReceivedBytes > budget.maxAssetBytes
			) {
				await reader.cancel().catch(() => {});
				readerCancelled = true;
				throw new Error(`${label} exceeds the ${budget.maxAssetBytes} byte asset limit`);
			}
			if (contentLength !== undefined && nextReceivedBytes > contentLength) {
				await reader.cancel().catch(() => {});
				readerCancelled = true;
				throw new Error(
					`${label} size mismatch: expected ${contentLength} bytes, received more data`
				);
			}
			if (nextReceivedBytes > accountedBytes) {
				accountBrowserToolInputBytes(budget, label, nextReceivedBytes - accountedBytes);
				accountedBytes = nextReceivedBytes;
			}
			if (nextReceivedBytes > bytes.byteLength) {
				const nextCapacity = Math.min(
					budget.maxAssetBytes,
					Math.max(nextReceivedBytes, bytes.byteLength * 2)
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedBytes));
				bytes = grown;
			}
			bytes.set(value, receivedBytes);
			receivedBytes = nextReceivedBytes;
		}
		throwIfAborted(signal);
		if (contentLength !== undefined && receivedBytes !== contentLength) {
			throw new Error(
				`${label} size mismatch: expected ${contentLength} bytes, received ${receivedBytes}`
			);
		}
		return receivedBytes === bytes.byteLength ? bytes : bytes.slice(0, receivedBytes);
	} catch (error) {
		if (!readerCancelled) await reader.cancel(error).catch(() => {});
		if (signal?.aborted) throw abortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

async function verifyBrowserToolAssetSha256(
	bytes: Uint8Array<ArrayBuffer>,
	expectedSha256: string,
	label: string,
	signal?: AbortSignal
) {
	throwIfAborted(signal);
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error(`Web Crypto is required to verify ${label}`);
	const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
	throwIfAborted(signal);
	const actualSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
	if (actualSha256 !== expectedSha256) {
		throw new Error(
			`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`
		);
	}
}

export async function fetchBrowserToolAsset(
	value: string,
	label: string,
	budget: BrowserToolInputBudget,
	options: BrowserToolAssetOptions = {}
) {
	throwIfAborted(options.signal);
	const receipt = options.receipt
		? validateBrowserToolAssetReceipt(options.receipt, label, budget.maxAssetBytes)
		: undefined;
	const requestUrl = resolveBrowserToolAssetUrl(value, options.baseUrl);
	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error(`fetch is required to load ${label}`);
	const requestInit: RequestInit = {
		cache: options.cache ?? 'no-store',
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	};
	if (options.signal) requestInit.signal = options.signal;

	let response: Response;
	try {
		response = await fetchImpl(requestUrl.href, requestInit);
	} catch (error) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		throw new Error(
			`failed to fetch ${label}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	if (options.signal?.aborted) {
		await cancelResponse(response, abortReason(options.signal));
		throw abortReason(options.signal);
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch (error) {
			await cancelResponse(response, error);
			throw new Error(`${label} returned an invalid final URL`, {
				cause: error
			});
		}
		if (finalUrl.href !== requestUrl.href) {
			await cancelResponse(response);
			throw new Error(`${label} final URL mismatch`);
		}
	}
	if (!response.ok) {
		await cancelResponse(response);
		throw new Error(`failed to fetch ${label}: HTTP ${response.status}`);
	}

	let contentLength: number | undefined;
	try {
		contentLength = parseContentLength(response, label);
	} catch (error) {
		await cancelResponse(response, error);
		throw error;
	}
	if (receipt && contentLength !== undefined && contentLength !== receipt.bytes) {
		await cancelResponse(response);
		throw new Error(
			`${label} size mismatch: expected ${receipt.bytes} bytes, received ${contentLength}`
		);
	}
	const expectedBytes = receipt?.bytes ?? contentLength;
	if (expectedBytes !== undefined) {
		try {
			accountBrowserToolInputBytes(budget, label, expectedBytes);
		} catch (error) {
			await cancelResponse(response, error);
			throw error;
		}
	}
	const bytes = await readBrowserToolAssetBody(
		response,
		label,
		budget,
		expectedBytes,
		options.signal
	);
	if (receipt) {
		await verifyBrowserToolAssetSha256(bytes, receipt.sha256, label, options.signal);
	}
	return bytes;
}

export function decodeBrowserToolSource(bytes: Uint8Array, label: string) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8`, { cause: error });
	}
}
