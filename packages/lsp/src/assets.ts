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

export interface LanguageToolAssetConfig {
	baseUrl?: string;
	loader?: LanguageToolAssetLoader;
}

export interface ResolvedLanguageToolAssetConfig {
	baseUrl: string;
	loader?: LanguageToolAssetLoader;
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
	reportProgress: (loaded: number, total?: number) => void
): Promise<LoadedLanguageToolAsset> {
	const response = await fetch(url);
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
	reportProgress: (loaded: number, total?: number) => void
): Promise<LoadedLanguageToolAsset | null> {
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return await fetchAsset(String(result), asset, reportProgress);
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
		return await fetchAsset(String(result.url), asset, reportProgress);
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
	if (config.loader) {
		const loaded = await normalizeLoaderResult(
			await config.loader({ runtime, asset, reportProgress }),
			asset,
			reportProgress
		);
		if (loaded) return { ...loaded, bytes: enforceAssetSize(asset, loaded.bytes) };
	}
	return await fetchAsset(new URL(asset, config.baseUrl).href, asset, reportProgress);
}
