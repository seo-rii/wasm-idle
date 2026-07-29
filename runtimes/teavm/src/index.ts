export const TEAVM_LOAD_ASSETS = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

export type TeaVmLoadAsset = (typeof TEAVM_LOAD_ASSETS)[number];

export interface TeaVmAssetResolverOptions {
	baseUrl: string | URL;
	currentUrl?: string | URL;
}

export interface TeaVmFetchAssetOptions extends TeaVmAssetResolverOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/u;
export const DEFAULT_MAX_TEAVM_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_TEAVM_ASSET_BUFFER_BYTES = 64 * 1024;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeTeaVmBaseUrl(baseUrl: string | URL, currentUrl?: string | URL) {
	if (baseUrl == null) throw new TypeError('TeaVM asset base URL is required.');
	const value = stringifyUrl(baseUrl).trim();
	if (!value) throw new TypeError('TeaVM asset base URL is required.');
	if (
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#')
	) {
		throw new TypeError(
			'TeaVM asset base URL must not include backslashes, NUL, query, or fragment data.'
		);
	}
	if (value.startsWith('//')) {
		throw new TypeError('TeaVM asset base URL must not be protocol-relative.');
	}
	const normalized = ensureTrailingSlash(value);
	if (currentUrl || canResolveWithUrl(normalized)) {
		const resolved = new URL(normalized, currentUrl ? stringifyUrl(currentUrl) : undefined);
		if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
			throw new TypeError(`TeaVM assets must use HTTP(S), received ${resolved.protocol}`);
		}
		if (resolved.username || resolved.password) {
			throw new TypeError('TeaVM asset base URL must not include credentials.');
		}
		return resolved.href;
	}
	return normalized;
}

export function resolveTeaVmAssetUrl(
	asset: TeaVmLoadAsset | string,
	options: TeaVmAssetResolverOptions
) {
	const assetPath = String(asset).trim();
	const parts = assetPath.split('/');
	if (
		!assetPath ||
		ABSOLUTE_URL_PATTERN.test(assetPath) ||
		assetPath.startsWith('/') ||
		assetPath.includes('\\') ||
		assetPath.includes('\0') ||
		assetPath.includes('?') ||
		assetPath.includes('#') ||
		parts.some(
			(part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/u.test(part)
		)
	) {
		throw new TypeError(`Invalid TeaVM runtime asset path: ${assetPath}`);
	}
	const baseUrl = normalizeTeaVmBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(assetPath, baseUrl).href;
	return `${baseUrl}${assetPath}`;
}

export function createTeaVmAssetManifest(options: TeaVmAssetResolverOptions) {
	return Object.fromEntries(
		TEAVM_LOAD_ASSETS.map((asset) => [asset, resolveTeaVmAssetUrl(asset, options)])
	) as Record<TeaVmLoadAsset, string>;
}

export async function fetchTeaVmAsset(
	asset: TeaVmLoadAsset,
	options: TeaVmFetchAssetOptions
): Promise<Uint8Array<ArrayBuffer>> {
	if (!(TEAVM_LOAD_ASSETS as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected TeaVM runtime asset: ${asset}`);
	}
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_TEAVM_ASSET_BYTES;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 0) {
		throw new Error('TeaVM maxAssetBytes must be a non-negative safe integer.');
	}
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error('fetch is required to load TeaVM runtime assets.');
	const assetUrl = resolveTeaVmAssetUrl(asset, options);
	const currentUrl = globalThis.location?.href;
	const expectedUrl =
		ABSOLUTE_URL_PATTERN.test(assetUrl) || currentUrl
			? new URL(assetUrl, currentUrl).href
			: undefined;
	let response: Response;
	try {
		response = await fetchImpl(assetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: options.signal
		});
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		throw new Error(
			`Failed to load TeaVM runtime asset ${asset}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (expectedUrl && response.url && new URL(response.url).href !== expectedUrl) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`TeaVM runtime asset ${asset} returned an unexpected final URL: ${response.url}`
		);
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load TeaVM runtime asset ${asset}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	const contentLength =
		contentLengthValue && /^\d+$/u.test(contentLengthValue)
			? Number(contentLengthValue)
			: undefined;
	if (
		contentLength !== undefined &&
		(!Number.isSafeInteger(contentLength) || contentLength > maxAssetBytes)
	) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`TeaVM runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxAssetBytes) {
			throw new Error(`TeaVM runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
		}
		return bytes;
	}

	const reader = response.body.getReader();
	let cancellation: Promise<void> | undefined;
	const cancelReader = (reason?: unknown) => {
		cancellation ??= reader.cancel(reason).catch(() => {});
		return cancellation;
	};
	const cancelOnAbort = () => {
		void cancelReader(
			options.signal?.reason ?? new Error('TeaVM runtime asset load was aborted.')
		);
	};
	options.signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(maxAssetBytes, contentLength ?? DEFAULT_TEAVM_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	try {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxAssetBytes) {
				throw new Error(
					`TeaVM runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`
				);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxAssetBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
		}
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		return bytes.subarray(0, receivedLength);
	} catch (error) {
		await cancelReader(error);
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}
