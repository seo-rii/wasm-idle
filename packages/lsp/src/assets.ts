import { runWithSignalAndTimeout } from './lifecycle.js';
import {
	AWK_RUNTIME_WORKER_PATH,
	ProtocolError,
	RUBY_RUNTIME_ASSET_NAMES,
	verifyRuntimeAssetIntegrity,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';
import { D_OUTER_ASSETS } from './d/assets.js';

export type LanguageToolAssetRuntime =
	| 'awk'
	| 'clangd'
	| 'd'
	| 'janet'
	| 'pascal'
	| 'perl'
	| 'prolog'
	| 'ruby'
	| 'tcl';

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
	cache?: RequestCache;
	redirect?: RequestRedirect;
	requireExactResponseUrl?: boolean;
}

export interface ResolvedLanguageToolAssetConfig {
	baseUrl: string;
	loader?: LanguageToolAssetLoader;
	allowedBaseUrls?: string[];
	integrity?: LanguageToolAssetIntegrityMap;
	cache?: RequestCache;
	redirect?: RequestRedirect;
	requireExactResponseUrl?: boolean;
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

const configuredAssetByteLimit = (asset: string, config: ResolvedLanguageToolAssetConfig) => {
	const expected = config.integrity?.[asset];
	if (typeof expected !== 'object' || expected.bytes === undefined) {
		return MAX_LANGUAGE_TOOL_ASSET_BYTES;
	}
	if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0) {
		throw new Error(`Runtime asset ${asset} has an invalid expected byte size`);
	}
	return Math.min(MAX_LANGUAGE_TOOL_ASSET_BYTES, expected.bytes);
};

const enforceAssetSize = (asset: string, bytes: Uint8Array, byteLimit: number) => {
	if (bytes.byteLength > byteLimit) {
		throw new Error(`Runtime asset ${asset} exceeds the ${byteLimit} byte limit`);
	}
	return bytes;
};

const verifyAssetIntegrity = async (
	runtime: LanguageToolAssetRuntime,
	asset: string,
	loaded: LoadedLanguageToolAsset,
	config: ResolvedLanguageToolAssetConfig
) => {
	const configured = config.integrity?.[asset];
	if (configured === undefined) return loaded;
	await verifyRuntimeAssetIntegrity({
		asset,
		bytes: loaded.bytes,
		expected: configured,
		stage: 'compressed',
		mimeType: loaded.mimeType,
		runtimeId: runtime
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
	if (url.username || url.password) {
		throw new Error(`Runtime asset ${asset} URL must not include credentials`);
	}
	if (url.hash) {
		throw new Error(`Runtime asset ${asset} URL must not include a fragment`);
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
		throw new Error(`Runtime asset ${asset} URL is outside the allowed asset bases`);
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

const cancelResponseBody = (response: Response, reason?: unknown) => {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the asset protocol error that triggered cleanup.
	}
};

async function fetchAsset(
	runtime: LanguageToolAssetRuntime,
	url: string,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void,
	signal: AbortSignal
): Promise<LoadedLanguageToolAsset> {
	const requestUrl = requireAllowedAssetUrl(asset, url, config);
	const byteLimit = configuredAssetByteLimit(asset, config);
	const response = await fetch(requestUrl.href, {
		...(config.cache ? { cache: config.cache } : {}),
		credentials: 'omit',
		redirect: config.redirect ?? 'follow',
		referrerPolicy: 'no-referrer',
		signal
	});
	if (config.requireExactResponseUrl && !response.url) {
		const error = new Error(`Runtime asset ${asset} did not expose an exact final URL`);
		cancelResponseBody(response, error);
		throw error;
	}
	let finalResponseUrl = requestUrl.href;
	if (response.url) {
		try {
			finalResponseUrl = new URL(response.url).href;
		} catch {
			const error = new Error(`Runtime asset ${asset} has an invalid final response URL`);
			cancelResponseBody(response, error);
			throw error;
		}
	}
	try {
		requireAllowedAssetUrl(asset, finalResponseUrl, config);
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}
	if (config.requireExactResponseUrl && finalResponseUrl !== requestUrl.href) {
		const error = new Error(`Runtime asset ${asset} returned an unexpected final URL`);
		cancelResponseBody(response, error);
		throw error;
	}
	if (!response.ok) {
		cancelResponseBody(response);
		throw new Error(`Failed to load ${asset}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (contentLengthValue !== null) {
		const normalizedContentLength = contentLengthValue.trim();
		const parsedContentLength = Number(normalizedContentLength);
		if (!/^\d+$/u.test(normalizedContentLength) || !Number.isSafeInteger(parsedContentLength)) {
			const error = new ProtocolError(
				`Runtime asset ${asset} has an invalid Content-Length`,
				{ phase: 'asset', runtimeId: runtime }
			);
			cancelResponseBody(response, error);
			throw error;
		}
		contentLength = parsedContentLength;
	}
	if (contentLength !== undefined && contentLength > byteLimit) {
		cancelResponseBody(response);
		throw new Error(`Runtime asset ${asset} exceeds the ${byteLimit} byte limit`);
	}
	const mimeType = response.headers.get('content-type') || undefined;
	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_resolve, reject) => {
			cancelOnAbort = () =>
				reject(signal.reason ?? new Error('Runtime asset load was aborted'));
			signal.addEventListener('abort', cancelOnAbort, { once: true });
		});
		try {
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			const materialized = response.arrayBuffer();
			const bytes = enforceAssetSize(
				asset,
				new Uint8Array(await Promise.race([materialized, aborted])),
				byteLimit
			);
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			reportProgress(bytes.byteLength, contentLength ?? bytes.byteLength);
			return { bytes, mimeType };
		} finally {
			if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
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
	if (signal.aborted) {
		const reason = signal.reason ?? new Error('Runtime asset load was aborted');
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () => {
			const reason = signal.reason ?? new Error('Runtime asset load was aborted');
			cancelReader(reason);
			reject(reason);
		};
		signal.addEventListener('abort', cancelOnAbort, { once: true });
	});
	let loadedAsset!: LoadedLanguageToolAsset;
	let releaseError: unknown;
	try {
		let receivedLength = 0;
		let bytes = new Uint8Array(
			contentLength ?? Math.min(DEFAULT_STREAM_BUFFER_BYTES, byteLimit)
		);
		while (true) {
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			const pendingRead = reader.read();
			const { done, value } = await Promise.race([pendingRead, aborted]);
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > byteLimit) {
				const error = new Error(
					`Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const capacity = Math.min(byteLimit, Math.max(nextLength, bytes.byteLength * 2));
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
		loadedAsset = { bytes, mimeType };
	} catch (error) {
		if (signal.aborted) {
			const reason = signal.reason ?? new Error('Runtime asset load was aborted');
			cancelReader(reason);
			throw reason;
		}
		cancelReader(error);
		throw error;
	} finally {
		if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch (error) {
			if (!signal.aborted) releaseError = error;
		}
	}
	if (releaseError) throw releaseError;
	return loadedAsset;
}

async function normalizeLoaderResult(
	runtime: LanguageToolAssetRuntime,
	result: LanguageToolAssetLoaderResult,
	asset: string,
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void,
	signal: AbortSignal
): Promise<LoadedLanguageToolAsset | null> {
	if (signal.aborted) {
		throw signal.reason ?? new Error('Runtime asset load was aborted');
	}
	const byteLimit = configuredAssetByteLimit(asset, config);
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return await fetchAsset(runtime, String(result), asset, config, reportProgress, signal);
	}
	if (result instanceof ArrayBuffer) {
		const bytes = enforceAssetSize(asset, new Uint8Array(result), byteLimit);
		reportProgress(bytes.byteLength, bytes.byteLength);
		return { bytes };
	}
	if (result instanceof Uint8Array) {
		enforceAssetSize(asset, result, byteLimit);
		reportProgress(result.byteLength, result.byteLength);
		return { bytes: result };
	}
	const normalizedResult: LanguageToolAssetDataResult | LanguageToolAssetUrlResult =
		result instanceof Blob ? { data: result, mimeType: result.type || undefined } : result;
	if ('url' in normalizedResult && normalizedResult.url) {
		return await fetchAsset(
			runtime,
			String(normalizedResult.url),
			asset,
			config,
			reportProgress,
			signal
		);
	}
	if ('data' in normalizedResult) {
		if (typeof normalizedResult.data === 'string') {
			const bytes = enforceAssetSize(
				asset,
				textEncoder.encode(normalizedResult.data),
				byteLimit
			);
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: normalizedResult.mimeType };
		}
		if (normalizedResult.data instanceof ArrayBuffer) {
			const bytes = enforceAssetSize(asset, new Uint8Array(normalizedResult.data), byteLimit);
			reportProgress(bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: normalizedResult.mimeType };
		}
		if (normalizedResult.data instanceof Uint8Array) {
			enforceAssetSize(asset, normalizedResult.data, byteLimit);
			reportProgress(normalizedResult.data.byteLength, normalizedResult.data.byteLength);
			return { bytes: normalizedResult.data, mimeType: normalizedResult.mimeType };
		}
		if (normalizedResult.data.size > byteLimit) {
			throw new Error(`Runtime asset ${asset} exceeds the ${byteLimit} byte limit`);
		}
		let cancelOnAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_resolve, reject) => {
			cancelOnAbort = () =>
				reject(signal.reason ?? new Error('Runtime asset load was aborted'));
			signal.addEventListener('abort', cancelOnAbort, { once: true });
		});
		try {
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			const materialized = normalizedResult.data.arrayBuffer();
			const bytes = enforceAssetSize(
				asset,
				new Uint8Array(await Promise.race([materialized, aborted])),
				byteLimit
			);
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset load was aborted');
			}
			reportProgress(bytes.byteLength, bytes.byteLength);
			return {
				bytes,
				mimeType: normalizedResult.mimeType || normalizedResult.data.type || undefined
			};
		} finally {
			if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
		}
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
	if (runtime === 'd' && !(D_OUTER_ASSETS as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected D runtime asset: ${asset}`);
	}
	if (runtime === 'ruby' && !(RUBY_RUNTIME_ASSET_NAMES as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected Ruby runtime asset: ${asset}`);
	}
	if (runtime === 'awk' && asset !== AWK_RUNTIME_WORKER_PATH) {
		throw new Error(`Unexpected AWK runtime asset: ${asset}`);
	}
	if (runtime === 'prolog' && asset !== 'runner-worker.js') {
		throw new Error(`Unexpected Prolog runtime asset: ${asset}`);
	}
	if (runtime === 'perl' && asset !== 'runner-worker.js') {
		throw new Error(`Unexpected Perl runtime asset: ${asset}`);
	}
	if (runtime === 'janet' && asset !== 'runner-worker.js') {
		throw new Error(`Unexpected Janet runtime asset: ${asset}`);
	}
	if (runtime === 'tcl' && asset !== 'runner-worker.js') {
		throw new Error(`Unexpected Tcl runtime asset: ${asset}`);
	}
	if (config.integrity && !Object.hasOwn(config.integrity, asset)) {
		throw new Error(`Runtime asset ${asset} is missing integrity metadata`);
	}
	const timeoutMs = options.timeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	return await runWithSignalAndTimeout(
		async (signal) => {
			let loaded: LoadedLanguageToolAsset | null = null;
			if (config.loader) {
				let cancelOnAbort: (() => void) | undefined;
				const aborted = new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () =>
						reject(signal.reason ?? new Error('Runtime asset load was aborted'));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				});
				let loaderResult: LanguageToolAssetLoaderResult;
				try {
					if (signal.aborted) {
						throw signal.reason ?? new Error('Runtime asset load was aborted');
					}
					const pendingResult = Promise.resolve(
						config.loader({
							runtime,
							asset,
							signal,
							reportProgress
						})
					);
					loaderResult = await Promise.race([pendingResult, aborted]);
					if (signal.aborted) {
						throw signal.reason ?? new Error('Runtime asset load was aborted');
					}
				} finally {
					if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
				}
				loaded = await normalizeLoaderResult(
					runtime,
					loaderResult,
					asset,
					config,
					reportProgress,
					signal
				);
			}
			loaded ||= await fetchAsset(runtime, asset, asset, config, reportProgress, signal);
			loaded = {
				...loaded,
				bytes: enforceAssetSize(
					asset,
					loaded.bytes,
					configuredAssetByteLimit(asset, config)
				)
			};
			return await verifyAssetIntegrity(runtime, asset, loaded, config);
		},
		{
			signal: options.signal,
			timeoutMs,
			operationName: 'Language tool asset',
			timeoutError: () => new LanguageToolAssetTimeoutError(asset, timeoutMs)
		}
	);
}
