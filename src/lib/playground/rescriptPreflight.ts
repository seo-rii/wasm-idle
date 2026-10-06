import type { ReScriptRuntimePreflightProfile } from '$lib/playground/assets';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	RuntimeConfigurationError,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	isWasmIdleError,
	preflightRuntimeAssets,
	resolveExecutionLimits,
	verifyRuntimeAssetIntegrity,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions,
	type RuntimeAssetPreflightProgress,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';

export const RESCRIPT_PREFLIGHT_PROTOCOL = 'wasm-idle-rescript-preflight' as const;
export const RESCRIPT_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const RESCRIPT_PREFLIGHT_RUNTIME_ID = 'RESCRIPT' as const;

const MAX_MANIFEST_BYTES = 64 * 1024;
const HARD_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const VERIFIED_COMPILER_STORAGE_PATH = 'compiler.js.gz.bin';

export interface ReScriptRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: ReScriptRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly persistentCache?: RuntimeAssetCacheOptions;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface ReScriptRuntimePreflightPayload {
	readonly protocol: typeof RESCRIPT_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof RESCRIPT_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly sourceRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly compilerBytes: Uint8Array;
}

export async function preflightReScriptRuntimeAssets(
	request: ReScriptRuntimePreflightRequest
): Promise<ReScriptRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('ReScript runtime preflight request is required', {
			phase: 'asset',
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('ReScript runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		(baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'ReScript runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (
		(manifestUrl.protocol !== 'https:' && manifestUrl.protocol !== 'http:') ||
		manifestUrl.username ||
		manifestUrl.password ||
		manifestUrl.hash ||
		manifestUrl.origin !== baseUrl.origin ||
		!manifestUrl.pathname.startsWith(baseUrl.pathname)
	) {
		throw new RuntimeConfigurationError(
			'ReScript runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}
	const manifestPath = manifestUrl.pathname.slice(baseUrl.pathname.length);
	if (
		!manifestPath ||
		manifestPath.includes('\\') ||
		manifestPath.includes('\0') ||
		manifestPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new RuntimeConfigurationError(
			'ReScript runtime manifest path must be a normalized file beneath the runtime base',
			{ phase: 'asset', runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (manifestPath === VERIFIED_COMPILER_STORAGE_PATH) {
		throw new RuntimeConfigurationError(
			'ReScript runtime manifest and compiler storage paths must be distinct',
			{ phase: 'asset', runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}

	const profile = request.profile;
	if (
		!profile ||
		typeof profile !== 'object' ||
		typeof profile.profileId !== 'string' ||
		!/^rescript-[A-Za-z0-9._+-]+$/u.test(profile.profileId) ||
		typeof profile.sourceRevision !== 'string' ||
		profile.sourceRevision !== 'v12.3.1' ||
		typeof profile.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(profile.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('ReScript runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}
	const manifestReceipt = profile.manifestReceipt;
	if (
		!manifestReceipt ||
		typeof manifestReceipt !== 'object' ||
		!Number.isSafeInteger(manifestReceipt.bytes) ||
		(manifestReceipt.bytes ?? 0) <= 0 ||
		typeof manifestReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(manifestReceipt.sha256)
	) {
		throw new RuntimeConfigurationError(
			'ReScript runtime manifest preflight receipt is invalid',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const compilerReceipt = profile.compilerReceipt;
	if (
		!compilerReceipt ||
		typeof compilerReceipt !== 'object' ||
		!Number.isSafeInteger(compilerReceipt.bytes) ||
		(compilerReceipt.bytes ?? 0) <= 0 ||
		typeof compilerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(compilerReceipt.sha256) ||
		!Number.isSafeInteger(compilerReceipt.uncompressedBytes) ||
		(compilerReceipt.uncompressedBytes ?? 0) <= 0 ||
		typeof compilerReceipt.uncompressedSha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(compilerReceipt.uncompressedSha256)
	) {
		throw new RuntimeConfigurationError(
			'ReScript runtime compiler preflight receipt is invalid',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			}
		);
	}

	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, HARD_MAX_ASSET_BYTES);
	const oversized = [
		['manifest', manifestReceipt.bytes!, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['compressed compiler', compilerReceipt.bytes!, maxAssetBytes],
		['logical compiler', compilerReceipt.uncompressedBytes!, maxAssetBytes]
	] as const;
	for (const [label, bytes, limit] of oversized) {
		if (bytes > limit) {
			throw new AssetTooLargeError(
				`ReScript runtime ${label} exceeds the ${limit} byte limit`,
				{
					actual: bytes,
					limit,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}

	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'ReScript runtime manifest query must be the pinned manifest fingerprint cache-buster',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const compilerRequestUrl = new URL(VERIFIED_COMPILER_STORAGE_PATH, baseUrl);
	compilerRequestUrl.searchParams.set('v', compilerReceipt.sha256);

	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/rescript-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'RESCRIPT',
					implementationId: 'rescript-playground',
					implementationVersion: profile.sourceRevision,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: manifestReceipt.sha256,
						protocolVersion: RESCRIPT_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: true,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: manifestPath,
						compressedSha256: manifestReceipt.sha256,
						uncompressedSha256: manifestReceipt.sha256,
						compressedBytes: manifestReceipt.bytes!,
						uncompressedBytes: manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'compiler',
						path: VERIFIED_COMPILER_STORAGE_PATH,
						compressedSha256: compilerReceipt.sha256,
						uncompressedSha256: compilerReceipt.uncompressedSha256!,
						compressedBytes: compilerReceipt.bytes!,
						uncompressedBytes: compilerReceipt.uncompressedBytes!,
						mediaType: 'text/javascript',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'rescript',
					runtimeAssetKey: 'rescript',
					documentationId: 'RESCRIPT',
					syncTarget: 'sync:wasm-rescript',
					browserTestId: 'browser:rescript'
				}
			}
		]
	};

	const controller = new AbortController();
	let timedOut = false;
	const abortFromCaller = () => controller.abort(request.signal?.reason);
	request.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (request.signal?.aborted) abortFromCaller();
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException('ReScript runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				compiler: compilerRequestUrl
			},
			fetch: request.fetch,
			persistentCache: request.persistentCache,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			maxConcurrentDownloads: 2,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const compilerAsset = preflight.assets.compiler;
		if (!manifestAsset || !compilerAsset) {
			throw new RuntimeConfigurationError(
				'ReScript runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		if (compilerAsset.bytes[0] !== 0x1f || compilerAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError(
				'ReScript runtime compiler storage asset is not gzip data',
				{
					profileId: profile.profileId,
					runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}

		const compressedBody = new Response(Uint8Array.from(compilerAsset.bytes)).body;
		if (!compressedBody) {
			throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			});
		}
		const stream = compressedBody.pipeThrough(new DecompressionStream('gzip'));
		const reader = stream.getReader();
		const compilerBytes = new Uint8Array(compilerReceipt.uncompressedBytes!);
		let offset = 0;
		const cancelDecompression = () => {
			try {
				void reader.cancel(controller.signal.reason).catch(() => undefined);
			} catch {
				// Preserve the cancellation or integrity failure that stopped decompression.
			}
		};
		controller.signal.addEventListener('abort', cancelDecompression, { once: true });
		try {
			for (;;) {
				if (controller.signal.aborted) throw controller.signal.reason;
				const { done, value } = await reader.read();
				if (done) break;
				if (offset + value.byteLength > compilerBytes.byteLength) {
					const error = new AssetIntegrityError(
						'ReScript compiler gzip output exceeds its logical receipt',
						{
							profileId: profile.profileId,
							runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
						}
					);
					try {
						await reader.cancel(error);
					} catch {
						// Preserve the expansion-limit failure.
					}
					throw error;
				}
				compilerBytes.set(value, offset);
				offset += value.byteLength;
				request.reportDecompressionProgress?.(offset, compilerBytes.byteLength);
			}
		} catch (error) {
			if (controller.signal.aborted || isWasmIdleError(error)) throw error;
			throw new AssetIntegrityError('ReScript runtime compiler gzip decompression failed', {
				cause: error,
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			});
		} finally {
			controller.signal.removeEventListener('abort', cancelDecompression);
			try {
				reader.releaseLock();
			} catch {
				// Cancellation may already have detached the stream reader.
			}
		}
		if (offset !== compilerBytes.byteLength) {
			throw new AssetIntegrityError(
				'ReScript compiler gzip output is shorter than its logical receipt',
				{
					profileId: profile.profileId,
					runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const logicalIntegrity = verifyRuntimeAssetIntegrity({
			asset: 'compiler.js',
			bytes: compilerBytes,
			expected: compilerReceipt,
			stage: 'uncompressed',
			mimeType: 'text/javascript',
			profileId: profile.profileId,
			runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
		});
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const rejectOnAbort = () => {
				if (settled) return;
				settled = true;
				controller.signal.removeEventListener('abort', rejectOnAbort);
				reject(
					controller.signal.reason ??
						new DOMException(
							'ReScript runtime integrity verification aborted',
							'AbortError'
						)
				);
			};
			controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
			void logicalIntegrity.then(
				() => {
					if (settled) return;
					settled = true;
					controller.signal.removeEventListener('abort', rejectOnAbort);
					resolve();
				},
				(error) => {
					if (settled) return;
					settled = true;
					controller.signal.removeEventListener('abort', rejectOnAbort);
					reject(error);
				}
			);
			if (controller.signal.aborted) rejectOnAbort();
		});
		return Object.freeze({
			protocol: RESCRIPT_PREFLIGHT_PROTOCOL,
			protocolVersion: RESCRIPT_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			sourceRevision: profile.sourceRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			compilerBytes
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`ReScript runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('ReScript runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RESCRIPT_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
