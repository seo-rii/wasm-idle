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

function normalizeRootUrl(value: string | URL): URL {
	let url: URL;
	try {
		url = new URL(String(value));
	} catch {
		throw new RuntimeConfigurationError(`Runtime asset root URL is invalid: ${String(value)}`, {
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
			`Runtime asset root must be an HTTP(S) directory URL: ${url.href}`,
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
	profileId: string
): URL {
	const expectedUrl = new URL(asset.path, assetRootUrl);
	let url: URL;
	try {
		url = new URL(String(value), assetRootUrl);
	} catch {
		throw new RuntimeConfigurationError(`Runtime asset ${asset.key} has an invalid URL`, {
			phase: 'asset',
			runtimeId,
			profileId
		});
	}
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		url.username ||
		url.password ||
		url.origin !== assetRootUrl.origin ||
		!url.pathname.startsWith(assetRootUrl.pathname)
	) {
		throw new RuntimeConfigurationError(
			`Runtime asset ${asset.key} URL is outside its declared asset root: ${url.href}`,
			{ phase: 'asset', runtimeId, profileId }
		);
	}
	if (url.href !== expectedUrl.href) {
		throw new RuntimeConfigurationError(
			`Runtime asset ${asset.key} URL does not match its declared path: ${url.href}`,
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
		throw new ProtocolError(
			`Runtime asset ${asset.key} has an invalid Content-Length: ${raw}`,
			{ phase: 'asset', runtimeId, profileId }
		);
	}
	return value;
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
		await response.body?.cancel(error).catch(() => undefined);
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
		await response.body?.cancel(error).catch(() => undefined);
		throw error;
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
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
	const cancelReader = () => {
		void reader.cancel(signal.reason).catch(() => {});
	};
	if (signal.aborted) {
		await reader.cancel(signal.reason);
		throw signal.reason;
	}
	signal.addEventListener('abort', cancelReader, { once: true });
	try {
		let receivedLength = 0;
		let bytes = new Uint8Array(
			Math.min(maxAssetBytes, declaredLength ?? DEFAULT_STREAM_BUFFER_BYTES)
		);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxAssetBytes) {
				await reader.cancel();
				throw new AssetTooLargeError(
					`Runtime asset ${asset.key} exceeds the ${maxAssetBytes} byte limit`,
					{
						limit: maxAssetBytes,
						actual: nextLength,
						runtimeId,
						profileId
					}
				);
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
		return bytes;
	} finally {
		signal.removeEventListener('abort', cancelReader);
	}
}

async function preflightAsset(
	asset: RuntimeRegistryAsset,
	assetRootUrl: URL,
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
	const requestUrl = requireConfinedUrl(asset.path, assetRootUrl, asset, runtimeId, profileId);
	let response: Response;
	try {
		response = await fetchImpl(requestUrl.href, {
			credentials: 'omit',
			redirect: 'follow',
			referrerPolicy: 'no-referrer',
			signal
		});
	} catch (error) {
		if (signal.aborted) throw error;
		throw new AssetNotFoundError(`Failed to load runtime asset ${asset.key}`, {
			runtimeId,
			profileId,
			cause: error,
			recoverable: true
		});
	}
	const responseUrl = requireConfinedUrl(
		response.url || requestUrl.href,
		assetRootUrl,
		asset,
		runtimeId,
		profileId
	);
	if (!response.ok) {
		throw new AssetNotFoundError(
			`Failed to load runtime asset ${asset.key}: HTTP ${response.status}`,
			{ runtimeId, profileId, recoverable: response.status >= 500 }
		);
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
		throw new AssetIntegrityError(
			`Runtime asset ${asset.key} delivery bytes were transparently ${asset.encoding}-decoded by HTTP`,
			{ runtimeId, profileId }
		);
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
	const deliveryIntegrity = await verifyRuntimeAssetIntegrity({
		asset: asset.path,
		bytes,
		expected,
		stage: 'compressed',
		runtimeId,
		profileId
	});
	const mimeType = response.headers.get('content-type') || undefined;
	const runtimeIntegrity =
		asset.encoding === 'identity'
			? await verifyRuntimeAssetIntegrity({
					asset: asset.path,
					bytes,
					expected,
					stage: 'uncompressed',
					mimeType,
					runtimeId,
					profileId
				})
			: undefined;
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
