export type LanguageToolAssetRuntime = 'clangd';

export interface LanguageToolAssetLoadRequest {
	runtime: LanguageToolAssetRuntime;
	asset: string;
	reportProgress: (loaded: number, total?: number) => void;
}

export interface LanguageToolAssetDataResult {
	data: string | ArrayBuffer | Uint8Array | Blob;
	mimeType?: string;
}

export interface LanguageToolAssetUrlResult {
	url: string | URL;
}

export type LanguageToolAssetLoaderResult =
	| LanguageToolAssetDataResult
	| LanguageToolAssetUrlResult
	| string
	| URL
	| ArrayBuffer
	| Uint8Array
	| Blob
	| null
	| undefined;

export type LanguageToolAssetLoader = (
	request: LanguageToolAssetLoadRequest
) => LanguageToolAssetLoaderResult | Promise<LanguageToolAssetLoaderResult>;

export interface LanguageToolAssetIntegrityEntry {
	sha256: string;
	bytes?: number;
	mediaType?: string;
}

export type LanguageToolAssetIntegrityMap = Record<
	string,
	string | LanguageToolAssetIntegrityEntry
>;

export interface LanguageToolAssetConfig {
	baseUrl?: string;
	loader?: LanguageToolAssetLoader;
	allowedBaseUrls?: string[];
	integrity?: LanguageToolAssetIntegrityMap;
}

export interface ResolvedLanguageToolAssetConfig {
	baseUrl: string;
	loader?: LanguageToolAssetLoader;
	allowedBaseUrls?: string[];
	integrity?: LanguageToolAssetIntegrityMap;
}

export interface LoadedLanguageToolAsset {
	bytes: Uint8Array;
	mimeType?: string;
}

export const CLANGD_ASSETS = ['clangd.js', 'clangd.wasm.gz'] as const;
export const CLANGD_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/clangd/';

const textEncoder = new TextEncoder();
const DEFAULT_STREAM_BUFFER_BYTES = 64 * 1024;
const MAX_LANGUAGE_TOOL_ASSET_BYTES = 128 * 1024 * 1024;

const enforceAssetSize = (asset: string, bytes: Uint8Array) => {
	if (bytes.byteLength > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
		throw new Error(
			`Runtime asset ${asset} exceeds the ${MAX_LANGUAGE_TOOL_ASSET_BYTES} byte limit`
		);
	}
	return bytes;
};

const sha256Hex = async (bytes: Uint8Array) => {
	if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
	const input =
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer
			: Uint8Array.from(bytes).buffer;
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

const verifyAssetIntegrity = async (
	asset: string,
	loaded: LoadedLanguageToolAsset,
	config: ResolvedLanguageToolAssetConfig
) => {
	const configured = config.integrity?.[asset];
	if (!configured) return loaded;
	const expected = typeof configured === 'string' ? { sha256: configured } : configured;
	if (expected.bytes !== undefined) {
		if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0) {
			throw new Error(`Runtime asset ${asset} has an invalid expected byte size`);
		}
		if (loaded.bytes.byteLength !== expected.bytes) {
			throw new Error(
				`Runtime asset ${asset} size mismatch: expected ${expected.bytes} bytes, received ${loaded.bytes.byteLength}`
			);
		}
	}
	if (!/^[a-f0-9]{64}$/u.test(expected.sha256)) {
		throw new Error(`Runtime asset ${asset} has an invalid expected SHA-256 digest`);
	}
	if (expected.mediaType) {
		const actualMediaType =
			loaded.mimeType?.split(';', 1)[0]?.trim().toLowerCase() || 'missing';
		const expectedMediaType = expected.mediaType.trim().toLowerCase();
		if (actualMediaType !== expectedMediaType) {
			throw new Error(
				`Runtime asset ${asset} MIME type mismatch: expected ${expectedMediaType}, received ${actualMediaType}`
			);
		}
	}
	const actual = await sha256Hex(loaded.bytes);
	if (actual !== expected.sha256) {
		throw new Error(
			`Runtime asset ${asset} SHA-256 mismatch: expected ${expected.sha256}, received ${actual}`
		);
	}
	return loaded;
};

const requireAllowedAssetUrl = (
	asset: string,
	value: string,
	config: ResolvedLanguageToolAssetConfig
) => {
	let url: URL;
	try {
		url = new URL(value, config.baseUrl);
	} catch {
		throw new Error(`Runtime asset ${asset} has an invalid URL: ${value}`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`Runtime asset ${asset} uses an unsupported URL scheme: ${url.protocol}`);
	}
	const allowed = [config.baseUrl, ...(config.allowedBaseUrls || [])].some((baseUrl) => {
		let base: URL;
		try {
			base = new URL(baseUrl, url);
		} catch {
			return false;
		}
		if (base.protocol !== 'https:' && base.protocol !== 'http:') return false;
		const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
		return url.origin === base.origin && url.pathname.startsWith(basePath);
	});
	if (!allowed) {
		throw new Error(
			`Runtime asset ${asset} URL is outside the allowed asset bases: ${url.href}`
		);
	}
	return url;
};

export const normalizeBaseUrl = (baseUrl: string, currentUrl = '') => {
	const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return currentUrl ? new URL(normalized, currentUrl).href : normalized;
};

export const normalizeRootUrl = (rootUrl: string) =>
	rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;

export const resolveRootToolBaseUrl = (rootUrl: string, toolPath: string, currentUrl = '') =>
	normalizeBaseUrl(`${normalizeRootUrl(rootUrl) || ''}${toolPath}`, currentUrl);

async function fetchAsset(
	url: string,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void
): Promise<LoadedLanguageToolAsset> {
	const requestUrl = requireAllowedAssetUrl(asset, url, config);
	const response = await fetch(requestUrl.href, {
		credentials: 'omit',
		redirect: 'follow',
		referrerPolicy: 'no-referrer'
	});
	requireAllowedAssetUrl(asset, response.url || requestUrl.href, config);
	if (!response.ok) throw new Error(`Failed to load ${asset}: ${response.status}`);
	const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
	if (contentLength && contentLength > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
		throw new Error(
			`Runtime asset ${asset} exceeds the ${MAX_LANGUAGE_TOOL_ASSET_BYTES} byte limit`
		);
	}
	const mimeType = response.headers.get('content-type') || undefined;
	if (!response.body) {
		const bytes = enforceAssetSize(asset, new Uint8Array(await response.arrayBuffer()));
		reportProgress(bytes.byteLength, contentLength ?? bytes.byteLength);
		return { bytes, mimeType };
	}

	const reader = response.body.getReader();
	let receivedLength = 0;
	let bytes = new Uint8Array(contentLength || DEFAULT_STREAM_BUFFER_BYTES);
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const nextLength = receivedLength + value.byteLength;
		if (nextLength > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
			await reader.cancel();
			throw new Error(
				`Runtime asset ${asset} exceeds the ${MAX_LANGUAGE_TOOL_ASSET_BYTES} byte limit`
			);
		}
		if (nextLength > bytes.byteLength) {
			const capacity = Math.min(
				MAX_LANGUAGE_TOOL_ASSET_BYTES,
				Math.max(nextLength, bytes.byteLength * 2)
			);
			const grown = new Uint8Array(capacity);
			grown.set(bytes.subarray(0, receivedLength));
			bytes = grown;
		}
		bytes.set(value, receivedLength);
		receivedLength = nextLength;
		reportProgress(receivedLength, contentLength);
	}
	if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
	reportProgress(receivedLength, contentLength ?? receivedLength);
	return { bytes, mimeType };
}

async function normalizeLoaderResult(
	result: LanguageToolAssetLoaderResult,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void
): Promise<LoadedLanguageToolAsset | null> {
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return await fetchAsset(String(result), asset, config, reportProgress);
	}
	if (result instanceof ArrayBuffer) {
		const bytes = new Uint8Array(result);
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes };
	}
	if (result instanceof Uint8Array) {
		reportProgress(result.byteLength, result.byteLength);
		return { bytes: result };
	}
	if (result instanceof Blob) {
		const bytes = new Uint8Array(await result.arrayBuffer());
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes, mimeType: result.type || undefined };
	}
	if ('url' in result && result.url) {
		return await fetchAsset(String(result.url), asset, config, reportProgress);
	}
	if ('data' in result) {
		if (typeof result.data === 'string') {
			const bytes = textEncoder.encode(result.data);
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.mimeType };
		}
		if (result.data instanceof ArrayBuffer) {
			const bytes = new Uint8Array(result.data);
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.mimeType };
		}
		if (result.data instanceof Uint8Array) {
			reportProgress(result.data.byteLength, result.data.byteLength);
			return { bytes: result.data, mimeType: result.mimeType };
		}
		const bytes = new Uint8Array(await result.data.arrayBuffer());
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes, mimeType: result.mimeType || result.data.type || undefined };
	}
	return null;
}

export async function loadLanguageToolAsset(
	runtime: LanguageToolAssetRuntime,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void
): Promise<LoadedLanguageToolAsset> {
	if (runtime === 'clangd' && !(CLANGD_ASSETS as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected clangd runtime asset: ${asset}`);
	}
	if (config.integrity && !Object.hasOwn(config.integrity, asset)) {
		throw new Error(`Runtime asset ${asset} is missing integrity metadata`);
	}
	let loaded: LoadedLanguageToolAsset | null = null;
	if (config.loader) {
		loaded = await normalizeLoaderResult(
			await config.loader({ runtime, asset, reportProgress }),
			asset,
			config,
			reportProgress
		);
	}
	loaded ||= await fetchAsset(asset, asset, config, reportProgress);
	loaded = { ...loaded, bytes: enforceAssetSize(asset, loaded.bytes) };
	return await verifyAssetIntegrity(asset, loaded, config);
}
