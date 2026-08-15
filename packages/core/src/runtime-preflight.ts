import {
	verifyRuntimeAssetIntegrity,
	type VerifiedRuntimeAssetIntegrity
} from './asset-integrity.js';
import {
	AssetIntegrityError,
	AssetNotFoundError,
	AssetTooLargeError,
	CancelledError,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	isWasmIdleError
} from './errors.js';
import { resolveExecutionLimits, type ExecutionLimits } from './execution.js';
import {
	defineRuntimeRegistryManifest,
	type RuntimeRegistryAsset,
	type RuntimeRegistryManifest
} from './runtime-manifest.js';

export interface RuntimeAssetPreflightProgress {
	readonly runtimeId: string;
	readonly assetKey: string;
	readonly loadedBytes: number;
	readonly totalBytes: number;
}

export interface RuntimeAssetPreflightRequest {
	readonly manifest: RuntimeRegistryManifest;
	readonly runtimeId: string;
	readonly rootUrl: string | URL;
	readonly assetUrls?: Readonly<Record<string, string | URL>>;
	readonly fetch?: typeof globalThis.fetch;
	readonly signal?: AbortSignal;
	readonly limits?: Partial<ExecutionLimits>;
	readonly maxConcurrentDownloads?: number;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
}

export interface PreflightedRuntimeAsset {
	readonly key: string;
	readonly path: string;
	readonly url: string;
	readonly cacheKey: string;
	readonly bytes: Uint8Array;
	readonly mimeType?: string;
	readonly contentEncoding?: string;
	readonly deliveryIntegrity: VerifiedRuntimeAssetIntegrity;
	readonly runtimeIntegrity?: VerifiedRuntimeAssetIntegrity;
}

export interface RuntimeAssetPreflightResult {
	readonly runtimeId: string;
	readonly profileId: string;
	readonly assetRootUrl?: string;
	readonly assets: Readonly<Record<string, PreflightedRuntimeAsset>>;
}

const DEFAULT_STREAM_BUFFER_BYTES = 64 * 1024;
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 4;

function waitForAbortable<T>(
	operation: Promise<T>,
	signal: AbortSignal,
	onLateValue?: (value: T, reason: unknown) => void | Promise<void>
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const cancelOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', cancelOnAbort);
			reject(signal.reason ?? new Error('Runtime asset preflight was aborted'));
		};
		signal.addEventListener('abort', cancelOnAbort, { once: true });
		operation.then(
			(value) => {
				if (settled) {
					if (onLateValue) {
						void Promise.resolve()
							.then(() => onLateValue(value, signal.reason))
							.catch(() => {});
					}
					return;
				}
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				reject(error);
			}
		);
		if (signal.aborted) cancelOnAbort();
	});
}

function normalizeRootUrl(value: string | URL): URL {
	let url: URL;
	try {
		url = new URL(String(value));
	} catch {
		throw new RuntimeConfigurationError('Runtime asset root URL is invalid', {
			phase: 'asset'
		});
	}
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new RuntimeConfigurationError(
			'Runtime asset root must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset' }
		);
	}
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url;
}

function requireConfinedUrl(
	value: string | URL,
	assetRootUrl: URL,
	asset: RuntimeRegistryAsset,
	runtimeId: string,
	profileId: string,
	allowRelative: boolean,
	allowQuery: boolean
): URL {
	const expectedUrl = new URL(asset.path, assetRootUrl);
	let url: URL;
	try {
		url = allowRelative ? new URL(String(value), assetRootUrl) : new URL(String(value));
	} catch {
		throw new RuntimeConfigurationError(`Runtime asset ${asset.key} has an invalid URL`, {
			phase: 'asset',
			runtimeId,
			profileId
		});
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new RuntimeConfigurationError(`Runtime asset ${asset.key} URL must use HTTP(S)`, {
			phase: 'asset',
			runtimeId,
			profileId
		});
	}
	if (url.username || url.password || (!allowQuery && url.search) || url.hash) {
		throw new RuntimeConfigurationError(
			`Runtime asset ${asset.key} URL must not include credentials${
				allowQuery ? '' : ', a query'
			}, or a fragment`,
			{ phase: 'asset', runtimeId, profileId }
		);
	}
	if (url.origin !== assetRootUrl.origin || !url.pathname.startsWith(assetRootUrl.pathname)) {
		throw new RuntimeConfigurationError(
			`Runtime asset ${asset.key} URL is outside its declared asset root`,
			{ phase: 'asset', runtimeId, profileId }
		);
	}
	if (url.origin !== expectedUrl.origin || url.pathname !== expectedUrl.pathname) {
		throw new RuntimeConfigurationError(
			`Runtime asset ${asset.key} URL does not match its declared path`,
			{ phase: 'asset', runtimeId, profileId }
		);
	}
	return url;
}

function parseContentLength(
	response: Response,
	asset: RuntimeRegistryAsset,
	runtimeId: string,
	profileId: string
): number | undefined {
	const raw = response.headers.get('content-length');
	if (raw === null) return undefined;
	const normalized = raw.trim();
	const value = Number(normalized);
	if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(value)) {
		throw new ProtocolError(`Runtime asset ${asset.key} has an invalid Content-Length`, {
			phase: 'asset',
			runtimeId,
			profileId
		});
	}
	return value;
}

function cancelResponseBody(response: Response, reason?: unknown) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the boundary failure that caused cancellation.
	}
}

async function readBoundedResponse(
	response: Response,
	asset: RuntimeRegistryAsset,
	maxAssetBytes: number,
	signal: AbortSignal,
	reportProgress: (loadedBytes: number) => void,
	runtimeId: string,
	profileId: string
): Promise<Uint8Array> {
	let declaredLength: number | undefined;
	try {
		declaredLength = parseContentLength(response, asset, runtimeId, profileId);
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}
	if (declaredLength !== undefined && declaredLength > maxAssetBytes) {
		const error = new AssetTooLargeError(
			`Runtime asset ${asset.key} exceeds the ${maxAssetBytes} byte limit`,
			{
				limit: maxAssetBytes,
				actual: declaredLength,
				runtimeId,
				profileId
			}
		);
		cancelResponseBody(response, error);
		throw error;
	}
	if (!response.body) {
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset preflight was aborted');
		}
		const materialized = response.arrayBuffer();
		const bytes = new Uint8Array(await waitForAbortable(materialized, signal));
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset preflight was aborted');
		}
		if (bytes.byteLength > maxAssetBytes) {
			throw new AssetTooLargeError(
				`Runtime asset ${asset.key} exceeds the ${maxAssetBytes} byte limit`,
				{
					limit: maxAssetBytes,
					actual: bytes.byteLength,
					runtimeId,
					profileId
				}
			);
		}
		reportProgress(bytes.byteLength);
		return bytes;
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
		const reason = signal.reason ?? new Error('Runtime asset preflight was aborted');
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () => {
			const reason = signal.reason ?? new Error('Runtime asset preflight was aborted');
			cancelReader(reason);
			reject(reason);
		};
		signal.addEventListener('abort', cancelOnAbort, { once: true });
	});
	let loadedBytes!: Uint8Array;
	let releaseFailure: { error: unknown } | undefined;
	try {
		let receivedLength = 0;
		let bytes = new Uint8Array(
			Math.min(maxAssetBytes, declaredLength ?? DEFAULT_STREAM_BUFFER_BYTES)
		);
		while (true) {
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset preflight was aborted');
			}
			const pendingRead = reader.read();
			const { done, value } = await Promise.race([pendingRead, aborted]);
			if (signal.aborted) {
				throw signal.reason ?? new Error('Runtime asset preflight was aborted');
			}
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxAssetBytes) {
				const error = new AssetTooLargeError(
					`Runtime asset ${asset.key} exceeds the ${maxAssetBytes} byte limit`,
					{
						limit: maxAssetBytes,
						actual: nextLength,
						runtimeId,
						profileId
					}
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const capacity = Math.min(
					maxAssetBytes,
					Math.max(
						nextLength,
						Math.max(DEFAULT_STREAM_BUFFER_BYTES, bytes.byteLength * 2)
					)
				);
				const grown = new Uint8Array(capacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			reportProgress(receivedLength);
		}
		if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
		reportProgress(receivedLength);
		loadedBytes = bytes;
	} catch (error) {
		if (signal.aborted) {
			const reason = signal.reason ?? new Error('Runtime asset preflight was aborted');
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
			if (!signal.aborted) releaseFailure = { error };
		}
	}
	if (releaseFailure) throw releaseFailure.error;
	return loadedBytes;
}

async function preflightAsset(
	asset: RuntimeRegistryAsset,
	assetRootUrl: URL,
	requestUrlOverride: string | URL | undefined,
	fetchImpl: typeof globalThis.fetch,
	signal: AbortSignal,
	maxAssetBytes: number,
	reportProgress: (loadedBytes: number) => void,
	runtimeId: string,
	profileId: string
): Promise<PreflightedRuntimeAsset> {
	if (asset.compressedBytes > maxAssetBytes || asset.uncompressedBytes > maxAssetBytes) {
		throw new AssetTooLargeError(
			`Runtime asset ${asset.key} exceeds the ${maxAssetBytes} byte limit declared for this execution`,
			{
				limit: maxAssetBytes,
				actual: Math.max(asset.compressedBytes, asset.uncompressedBytes),
				runtimeId,
				profileId
			}
		);
	}
	const requestUrl = requireConfinedUrl(
		requestUrlOverride ?? asset.path,
		assetRootUrl,
		asset,
		runtimeId,
		profileId,
		true,
		requestUrlOverride !== undefined
	);
	let response: Response;
	try {
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset preflight was aborted');
		}
		const pendingResponse = Promise.resolve(
			fetchImpl(requestUrl.href, {
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer',
				signal
			})
		);
		response = await waitForAbortable(pendingResponse, signal, (lateResponse, reason) => {
			cancelResponseBody(lateResponse, reason);
		});
		if (signal.aborted) {
			const reason = signal.reason ?? new Error('Runtime asset preflight was aborted');
			cancelResponseBody(response, reason);
			throw reason;
		}
	} catch (error) {
		if (signal.aborted) throw error;
		throw new AssetNotFoundError(`Failed to load runtime asset ${asset.key}`, {
			runtimeId,
			profileId,
			cause: error,
			recoverable: true
		});
	}
	let responseUrl: URL;
	try {
		responseUrl = requireConfinedUrl(
			response.url || requestUrl.href,
			assetRootUrl,
			asset,
			runtimeId,
			profileId,
			false,
			requestUrlOverride !== undefined
		);
		if (responseUrl.href !== requestUrl.href) {
			throw new RuntimeConfigurationError(
				`Runtime asset ${asset.key} response URL does not match its requested URL`,
				{ phase: 'asset', runtimeId, profileId }
			);
		}
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}
	if (!response.ok) {
		const error = new AssetNotFoundError(
			`Failed to load runtime asset ${asset.key}: HTTP ${response.status}`,
			{ runtimeId, profileId, recoverable: response.status >= 500 }
		);
		cancelResponseBody(response, error);
		throw error;
	}
	const contentEncoding = response.headers.get('content-encoding') || undefined;
	if (
		asset.encoding !== 'identity' &&
		contentEncoding
			?.toLowerCase()
			.split(',')
			.map((encoding) => encoding.trim())
			.includes(asset.encoding)
	) {
		const error = new AssetIntegrityError(
			`Runtime asset ${asset.key} delivery bytes were transparently ${asset.encoding}-decoded by HTTP`,
			{ runtimeId, profileId }
		);
		cancelResponseBody(response, error);
		throw error;
	}
	const bytes = await readBoundedResponse(
		response,
		asset,
		maxAssetBytes,
		signal,
		reportProgress,
		runtimeId,
		profileId
	);
	const expected = {
		sha256: asset.compressedSha256,
		bytes: asset.compressedBytes,
		mediaType: asset.mediaType,
		uncompressedSha256: asset.uncompressedSha256,
		uncompressedBytes: asset.uncompressedBytes
	};
	if (signal.aborted) {
		throw signal.reason ?? new Error('Runtime asset preflight was aborted');
	}
	const deliveryIntegrity = await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: asset.path,
			bytes,
			expected,
			stage: 'compressed',
			runtimeId,
			profileId
		}),
		signal
	);
	const mimeType = response.headers.get('content-type') || undefined;
	let runtimeIntegrity: VerifiedRuntimeAssetIntegrity | undefined;
	if (asset.encoding === 'identity') {
		if (signal.aborted) {
			throw signal.reason ?? new Error('Runtime asset preflight was aborted');
		}
		runtimeIntegrity = await waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: asset.path,
				bytes,
				expected,
				stage: 'uncompressed',
				mimeType,
				runtimeId,
				profileId
			}),
			signal
		);
	}
	return Object.freeze({
		key: asset.key,
		path: asset.path,
		url: responseUrl.href,
		cacheKey: `sha256:${deliveryIntegrity.sha256}`,
		bytes,
		mimeType,
		contentEncoding,
		deliveryIntegrity,
		runtimeIntegrity
	});
}

export async function preflightRuntimeAssets(
	request: RuntimeAssetPreflightRequest
): Promise<RuntimeAssetPreflightResult> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Runtime asset preflight request is required', {
			phase: 'asset'
		});
	}
	const manifest = defineRuntimeRegistryManifest(request.manifest);
	const runtime = manifest.runtimes.find(
		(candidate) => candidate.runtimeId === request.runtimeId
	);
	if (!runtime) {
		throw new RuntimeConfigurationError(
			`Runtime registry manifest does not declare ${request.runtimeId}`,
			{ phase: 'asset', runtimeId: request.runtimeId }
		);
	}
	const rootUrl = normalizeRootUrl(request.rootUrl);
	const assetRootUrl = runtime.assetRoot ? new URL(`${runtime.assetRoot}/`, rootUrl) : undefined;
	if (runtime.assets.length > 0 && !assetRootUrl) {
		throw new RuntimeConfigurationError(`Runtime ${runtime.runtimeId} has no asset root`, {
			phase: 'asset',
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId
		});
	}
	const limits = resolveExecutionLimits(request.limits);
	const concurrency = request.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT_DOWNLOADS;
	if (!Number.isSafeInteger(concurrency) || concurrency <= 0 || concurrency > 32) {
		throw new RuntimeConfigurationError(
			'Runtime asset preflight concurrency must be an integer from 1 through 32',
			{
				phase: 'asset',
				runtimeId: runtime.runtimeId,
				profileId: runtime.identity.profile.profileId
			}
		);
	}
	const fetchImpl = request.fetch ?? globalThis.fetch;
	if (runtime.assets.length > 0 && typeof fetchImpl !== 'function') {
		throw new AssetNotFoundError('fetch is unavailable for runtime asset preflight', {
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId
		});
	}
	if (request.signal?.aborted) {
		throw new CancelledError('Runtime asset preflight cancelled', {
			phase: 'asset',
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId,
			cause: request.signal.reason
		});
	}
	if (
		request.assetUrls !== undefined &&
		(!request.assetUrls ||
			typeof request.assetUrls !== 'object' ||
			Array.isArray(request.assetUrls))
	) {
		throw new RuntimeConfigurationError('Runtime asset URL overrides must be an object', {
			phase: 'asset',
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId
		});
	}
	const declaredAssetKeys = new Set(runtime.assets.map((asset) => asset.key));
	for (const assetKey of Object.keys(request.assetUrls ?? {})) {
		if (!declaredAssetKeys.has(assetKey)) {
			throw new RuntimeConfigurationError(
				`Runtime asset URL override references undeclared asset ${assetKey}`,
				{
					phase: 'asset',
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId
				}
			);
		}
	}

	const controller = new AbortController();
	let timedOut = false;
	const abortFromCaller = () => controller.abort(request.signal?.reason);
	request.signal?.addEventListener('abort', abortFromCaller, { once: true });
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, limits.assetTimeoutMs);
	try {
		const loaded = new Array<readonly [string, PreflightedRuntimeAsset]>(runtime.assets.length);
		let nextIndex = 0;
		const workers = Array.from(
			{ length: Math.min(concurrency, runtime.assets.length) },
			async () => {
				while (nextIndex < runtime.assets.length) {
					const index = nextIndex++;
					const asset = runtime.assets[index]!;
					try {
						const preflighted = await preflightAsset(
							asset,
							assetRootUrl!,
							Object.prototype.hasOwnProperty.call(request.assetUrls ?? {}, asset.key)
								? request.assetUrls![asset.key]
								: undefined,
							fetchImpl!,
							controller.signal,
							limits.maxAssetBytes,
							(loadedBytes) =>
								request.reportProgress?.({
									runtimeId: runtime.runtimeId,
									assetKey: asset.key,
									loadedBytes,
									totalBytes: asset.compressedBytes
								}),
							runtime.runtimeId,
							runtime.identity.profile.profileId
						);
						loaded[index] = [asset.key, preflighted];
					} catch (error) {
						controller.abort(error);
						throw error;
					}
				}
			}
		);
		await Promise.all(workers);
		return Object.freeze({
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId,
			assetRootUrl: assetRootUrl?.href,
			assets: Object.freeze(Object.fromEntries(loaded))
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Runtime asset preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					phase: 'asset',
					timeoutMs: limits.assetTimeoutMs,
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId,
					cause: error
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Runtime asset preflight cancelled', {
				phase: 'asset',
				runtimeId: runtime.runtimeId,
				profileId: runtime.identity.profile.profileId,
				cause: request.signal.reason
			});
		}
		if (isWasmIdleError(error)) throw error;
		throw new AssetNotFoundError('Runtime asset preflight failed', {
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId,
			cause: error
		});
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
