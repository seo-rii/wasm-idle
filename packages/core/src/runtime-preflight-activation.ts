import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	RuntimeConfigurationError,
	TimeoutError,
	isWasmIdleError
} from './errors.js';
import { resolveExecutionLimits, type ExecutionLimits } from './execution.js';
import {
	RuntimeProfileActivationStore,
	type RuntimeProfileActivationSnapshot,
	type RuntimeProfileAssetCandidate
} from './runtime-activation.js';
import {
	defineRuntimeRegistryManifest,
	type RuntimeAssetEncoding,
	type RuntimeRegistryAsset,
	type RuntimeRegistryManifest
} from './runtime-manifest.js';
import type { RuntimeAssetPreflightResult } from './runtime-preflight.js';

export interface RuntimeAssetDecodeRequest {
	readonly runtimeId: string;
	readonly profileId: string;
	readonly asset: RuntimeRegistryAsset;
	readonly encoding: Exclude<RuntimeAssetEncoding, 'identity'>;
	readonly bytes: Uint8Array;
	readonly maxOutputBytes: number;
	readonly signal: AbortSignal;
}

export type RuntimeAssetDecoder = (
	request: RuntimeAssetDecodeRequest
) => Uint8Array | Promise<Uint8Array>;

export interface ActivatePreflightedRuntimeProfileRequest {
	readonly store: RuntimeProfileActivationStore;
	readonly manifest: RuntimeRegistryManifest;
	readonly preflight: RuntimeAssetPreflightResult;
	readonly decode?: RuntimeAssetDecoder;
	readonly signal?: AbortSignal;
	readonly limits?: Partial<ExecutionLimits>;
}

function isUint8Array(value: unknown): value is Uint8Array {
	return (
		ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

function requireMatchingPreflight(
	manifest: RuntimeRegistryManifest,
	preflight: RuntimeAssetPreflightResult
) {
	if (!preflight || typeof preflight !== 'object') {
		throw new RuntimeConfigurationError('A runtime asset preflight result is required', {
			phase: 'asset'
		});
	}
	const runtime = manifest.runtimes.find(
		(candidate) => candidate.runtimeId === preflight.runtimeId
	);
	if (!runtime) {
		throw new RuntimeConfigurationError(
			`Runtime registry manifest does not declare ${String(preflight.runtimeId)}`,
			{ phase: 'asset', runtimeId: preflight.runtimeId }
		);
	}
	if (preflight.profileId !== runtime.identity.profile.profileId) {
		throw new RuntimeConfigurationError(
			`Runtime preflight profile mismatch: expected ${runtime.identity.profile.profileId}, received ${String(preflight.profileId)}`,
			{
				phase: 'asset',
				runtimeId: runtime.runtimeId,
				profileId: runtime.identity.profile.profileId
			}
		);
	}
	if (
		!preflight.assets ||
		typeof preflight.assets !== 'object' ||
		Array.isArray(preflight.assets)
	) {
		throw new RuntimeConfigurationError('Runtime preflight assets must be a record', {
			phase: 'asset',
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId
		});
	}
	const expectedKeys = runtime.assets.map((asset) => asset.key).sort();
	const receivedKeys = Object.keys(preflight.assets).sort();
	const missing = expectedKeys.filter((key) => !receivedKeys.includes(key));
	const unexpected = receivedKeys.filter((key) => !expectedKeys.includes(key));
	if (missing.length > 0 || unexpected.length > 0) {
		throw new RuntimeConfigurationError(
			`Runtime preflight asset set mismatch: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
			{
				phase: 'asset',
				runtimeId: runtime.runtimeId,
				profileId: runtime.identity.profile.profileId
			}
		);
	}
	return runtime;
}

export async function activatePreflightedRuntimeProfile(
	request: ActivatePreflightedRuntimeProfileRequest
): Promise<RuntimeProfileActivationSnapshot> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Runtime preflight activation request is required', {
			phase: 'asset'
		});
	}
	if (!request.store || typeof request.store.activate !== 'function') {
		throw new RuntimeConfigurationError('Runtime profile activation store is required', {
			phase: 'asset'
		});
	}
	const manifest = defineRuntimeRegistryManifest(request.manifest);
	const runtime = requireMatchingPreflight(manifest, request.preflight);
	const profileId = runtime.identity.profile.profileId;
	const limits = resolveExecutionLimits(request.limits);
	if (request.signal?.aborted) {
		throw new CancelledError('Runtime profile activation cancelled', {
			phase: 'asset',
			runtimeId: runtime.runtimeId,
			profileId,
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
		const candidates: Record<string, RuntimeProfileAssetCandidate> = {};
		for (const asset of runtime.assets) {
			const preflighted = request.preflight.assets[asset.key]!;
			if (
				asset.compressedBytes > limits.maxAssetBytes ||
				asset.uncompressedBytes > limits.maxAssetBytes
			) {
				throw new AssetTooLargeError(
					`Runtime asset ${asset.key} exceeds the ${limits.maxAssetBytes} byte limit declared for this activation`,
					{
						limit: limits.maxAssetBytes,
						actual: Math.max(asset.compressedBytes, asset.uncompressedBytes),
						runtimeId: runtime.runtimeId,
						profileId
					}
				);
			}
			if (!preflighted || !isUint8Array(preflighted.bytes)) {
				throw new AssetIntegrityError(
					`Runtime preflight asset ${asset.key} did not provide byte data`,
					{ runtimeId: runtime.runtimeId, profileId }
				);
			}
			if (preflighted.key !== asset.key || preflighted.path !== asset.path) {
				throw new AssetIntegrityError(
					`Runtime preflight asset identity mismatch for ${asset.key}`,
					{ runtimeId: runtime.runtimeId, profileId }
				);
			}
			if (preflighted.bytes.byteLength > limits.maxAssetBytes) {
				throw new AssetTooLargeError(
					`Preflighted runtime asset ${asset.key} exceeds the ${limits.maxAssetBytes} byte limit`,
					{
						limit: limits.maxAssetBytes,
						actual: preflighted.bytes.byteLength,
						runtimeId: runtime.runtimeId,
						profileId
					}
				);
			}
			const expectedCacheKey = `sha256:${asset.compressedSha256}`;
			if (preflighted.cacheKey !== expectedCacheKey) {
				throw new RuntimeConfigurationError(
					`Runtime preflight asset ${asset.key} cache key does not match its delivery hash`,
					{ phase: 'asset', runtimeId: runtime.runtimeId, profileId }
				);
			}
			const compressed = Uint8Array.from(preflighted.bytes);
			let uncompressed: Uint8Array;
			if (asset.encoding === 'identity') {
				uncompressed = compressed;
			} else {
				if (!request.decode) {
					throw new RuntimeConfigurationError(
						`Runtime asset ${asset.key} requires a ${asset.encoding} decoder`,
						{ phase: 'asset', runtimeId: runtime.runtimeId, profileId }
					);
				}
				let decoded: unknown;
				try {
					decoded = await awaitWithAbort(
						Promise.resolve(
							request.decode({
								runtimeId: runtime.runtimeId,
								profileId,
								asset,
								encoding: asset.encoding,
								bytes: Uint8Array.from(compressed),
								maxOutputBytes: limits.maxAssetBytes,
								signal: controller.signal
							})
						),
						controller.signal
					);
				} catch (error) {
					if (controller.signal.aborted) throw error;
					if (isWasmIdleError(error)) throw error;
					throw new AssetIntegrityError(
						`Failed to decode runtime asset ${asset.key} as ${asset.encoding}`,
						{ runtimeId: runtime.runtimeId, profileId, cause: error }
					);
				}
				if (!isUint8Array(decoded)) {
					throw new AssetIntegrityError(
						`Runtime asset decoder returned invalid bytes for ${asset.key}`,
						{ runtimeId: runtime.runtimeId, profileId }
					);
				}
				uncompressed = decoded;
			}
			if (uncompressed.byteLength > limits.maxAssetBytes) {
				throw new AssetTooLargeError(
					`Decoded runtime asset ${asset.key} exceeds the ${limits.maxAssetBytes} byte limit`,
					{
						limit: limits.maxAssetBytes,
						actual: uncompressed.byteLength,
						runtimeId: runtime.runtimeId,
						profileId
					}
				);
			}
			candidates[asset.key] = {
				cacheKey: preflighted.cacheKey,
				compressed,
				uncompressed,
				mimeType: asset.mediaType
			};
		}

		return await awaitWithAbort(
			request.store.activate({
				manifest,
				runtimeId: runtime.runtimeId,
				assets: candidates,
				signal: controller.signal
			}),
			controller.signal
		);
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Runtime profile activation timed out after ${limits.assetTimeoutMs} ms`,
				{
					phase: 'asset',
					timeoutMs: limits.assetTimeoutMs,
					runtimeId: runtime.runtimeId,
					profileId,
					cause: error
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Runtime profile activation cancelled', {
				phase: 'asset',
				runtimeId: runtime.runtimeId,
				profileId,
				cause: request.signal.reason
			});
		}
		if (isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError('Runtime profile activation failed', {
			runtimeId: runtime.runtimeId,
			profileId,
			cause: error
		});
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
