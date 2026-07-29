import { runWithSignalAndTimeout } from './lifecycle.js';
import { verifyRuntimeAssetIntegrity, type RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export type LanguageToolAssetRuntime = 'clangd';

export interface LanguageToolAssetLoadRequest {
	runtime: LanguageToolAssetRuntime;
	asset: string;
	signal: AbortSignal;
	reportProgress: (loaded: number, total?: number) => void;
}

export interface LanguageToolAssetLoadOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
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

export type LanguageToolAssetIntegrityEntry = RuntimeAssetIntegrityEntry;

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
export const DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS = 120_000;

export class LanguageToolAssetTimeoutError extends Error {
	constructor(asset: string, timeoutMs: number) {
		super(`Timed out loading runtime asset ${asset} after ${timeoutMs} ms`);
		this.name = 'LanguageToolAssetTimeoutError';
	}
}

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

const verifyAssetIntegrity = async (
	asset: string,
	loaded: LoadedLanguageToolAsset,
	config: ResolvedLanguageToolAssetConfig
) => {
	const configured = config.integrity?.[asset];
	if (!configured) return loaded;
	await verifyRuntimeAssetIntegrity({
		asset,
		bytes: loaded.bytes,
		expected: configured,
		stage: 'compressed',
		mimeType: loaded.mimeType,
		runtimeId: 'clangd'
	});
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
	reportProgress: (loaded: number, total?: number) => void,
	signal: AbortSignal
): Promise<LoadedLanguageToolAsset> {
	const requestUrl = requireAllowedAssetUrl(asset, url, config);
	const response = await fetch(requestUrl.href, {
		credentials: 'omit',
		redirect: 'follow',
		referrerPolicy: 'no-referrer',
		signal
	});
	try {
		requireAllowedAssetUrl(asset, response.url || requestUrl.href, config);
	} catch (error) {
		await response.body?.cancel(error).catch(() => {});
		throw error;
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load ${asset}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	const contentLength =
		contentLengthValue && /^\d+$/u.test(contentLengthValue)
			? Number(contentLengthValue)
			: undefined;
	if (
		contentLength !== undefined &&
		(!Number.isSafeInteger(contentLength) || contentLength > MAX_LANGUAGE_TOOL_ASSET_BYTES)
	) {
		await response.body?.cancel().catch(() => {});
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
	let cancellation: Promise<void> | undefined;
	const cancelReader = (reason?: unknown) => {
		cancellation ??= reader.cancel(reason).catch(() => {});
		return cancellation;
	};
	const cancelOnAbort = () => {
		void cancelReader(signal.reason ?? new Error('Runtime asset load was aborted'));
	};
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset load was aborted');
		}
		let receivedLength = 0;
		let bytes = new Uint8Array(contentLength ?? DEFAULT_STREAM_BUFFER_BYTES);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
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
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset load was aborted');
		}
		if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
		reportProgress(receivedLength, contentLength ?? receivedLength);
		return { bytes, mimeType };
	} catch (error) {
		await cancelReader(error);
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset load was aborted');
		}
		throw error;
	} finally {
		signal.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

async function normalizeLoaderResult(
	result: LanguageToolAssetLoaderResult,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void,
	signal: AbortSignal
): Promise<LoadedLanguageToolAsset | null> {
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return await fetchAsset(String(result), asset, config, reportProgress, signal);
	}
	if (result instanceof ArrayBuffer) {
		const bytes = enforceAssetSize(asset, new Uint8Array(result));
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes };
	}
	if (result instanceof Uint8Array) {
		enforceAssetSize(asset, result);
		reportProgress(result.byteLength, result.byteLength);
		return { bytes: result };
	}
	if (result instanceof Blob) {
		if (result.size > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
			throw new Error(
				`Runtime asset ${asset} exceeds the ${MAX_LANGUAGE_TOOL_ASSET_BYTES} byte limit`
			);
		}
		const bytes = enforceAssetSize(asset, new Uint8Array(await result.arrayBuffer()));
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes, mimeType: result.type || undefined };
	}
	if ('url' in result && result.url) {
		return await fetchAsset(String(result.url), asset, config, reportProgress, signal);
	}
	if ('data' in result) {
		if (typeof result.data === 'string') {
			const bytes = enforceAssetSize(asset, textEncoder.encode(result.data));
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.mimeType };
		}
		if (result.data instanceof ArrayBuffer) {
			const bytes = enforceAssetSize(asset, new Uint8Array(result.data));
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.mimeType };
		}
		if (result.data instanceof Uint8Array) {
			enforceAssetSize(asset, result.data);
			reportProgress(result.data.byteLength, result.data.byteLength);
			return { bytes: result.data, mimeType: result.mimeType };
		}
		if (result.data.size > MAX_LANGUAGE_TOOL_ASSET_BYTES) {
			throw new Error(
				`Runtime asset ${asset} exceeds the ${MAX_LANGUAGE_TOOL_ASSET_BYTES} byte limit`
			);
		}
		const bytes = enforceAssetSize(asset, new Uint8Array(await result.data.arrayBuffer()));
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes, mimeType: result.mimeType || result.data.type || undefined };
	}
	return null;
}

export async function loadLanguageToolAsset(
	runtime: LanguageToolAssetRuntime,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void,
	options: LanguageToolAssetLoadOptions = {}
): Promise<LoadedLanguageToolAsset> {
	if (runtime === 'clangd' && !(CLANGD_ASSETS as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected clangd runtime asset: ${asset}`);
	}
	if (config.integrity && !Object.hasOwn(config.integrity, asset)) {
		throw new Error(`Runtime asset ${asset} is missing integrity metadata`);
	}
	const timeoutMs = options.timeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	return await runWithSignalAndTimeout(
		async (signal) => {
			let loaded: LoadedLanguageToolAsset | null = null;
			if (config.loader) {
				loaded = await normalizeLoaderResult(
					await config.loader({
						runtime,
						asset,
						signal,
						reportProgress
					}),
					asset,
					config,
					reportProgress,
					signal
				);
			}
			loaded ||= await fetchAsset(asset, asset, config, reportProgress, signal);
			loaded = { ...loaded, bytes: enforceAssetSize(asset, loaded.bytes) };
			return await verifyAssetIntegrity(asset, loaded, config);
		},
		{
			signal: options.signal,
			timeoutMs,
			operationName: 'Language tool asset',
			timeoutError: () => new LanguageToolAssetTimeoutError(asset, timeoutMs)
		}
	);
}
