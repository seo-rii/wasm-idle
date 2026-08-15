import type { ClojureScriptRuntimePreflightProfile } from '$lib/playground/assets';
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
	type RuntimeAssetPreflightProgress,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';

export const CLOJURESCRIPT_PREFLIGHT_PROTOCOL = 'wasm-idle-clojurescript-preflight' as const;
export const CLOJURESCRIPT_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID = 'CLOJURESCRIPT' as const;

const MAX_MANIFEST_BYTES = 64 * 1024;
const HARD_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const VERIFIED_COMPILER_STORAGE_PATH = 'compiler.js.gz.bin';

export interface ClojureScriptRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: ClojureScriptRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface ClojureScriptRuntimePreflightPayload {
	readonly protocol: typeof CLOJURESCRIPT_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof CLOJURESCRIPT_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly sourceRevision: string;
	readonly integrationRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly compilerBytes: Uint8Array;
}

export async function preflightClojureScriptRuntimeAssets(
	request: ClojureScriptRuntimePreflightRequest
): Promise<ClojureScriptRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('ClojureScript runtime preflight request is required', {
			phase: 'asset',
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('ClojureScript runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
			'ClojureScript runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID }
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
			'ClojureScript runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID }
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
			'ClojureScript runtime manifest path must be a normalized file beneath the runtime base',
			{ phase: 'asset', runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (manifestPath === VERIFIED_COMPILER_STORAGE_PATH) {
		throw new RuntimeConfigurationError(
			'ClojureScript runtime manifest and compiler storage paths must be distinct',
			{ phase: 'asset', runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID }
		);
	}

	const profile = request.profile;
	if (
		!profile ||
		typeof profile !== 'object' ||
		typeof profile.profileId !== 'string' ||
		!/^clojurescript-[A-Za-z0-9._+-]+$/u.test(profile.profileId) ||
		typeof profile.sourceRevision !== 'string' ||
		profile.sourceRevision !== 'r1.12.134' ||
		typeof profile.integrationRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(profile.integrationRevision) ||
		typeof profile.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(profile.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('ClojureScript runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
			'ClojureScript runtime manifest preflight receipt is invalid',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
			'ClojureScript runtime compiler preflight receipt is invalid',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
				`ClojureScript runtime ${label} exceeds the ${limit} byte limit`,
				{
					actual: bytes,
					limit,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
		});
	}

	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'ClojureScript runtime manifest query must be the pinned manifest fingerprint cache-buster',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
		manifestId: 'wasm-idle/clojurescript-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'CLOJURESCRIPT',
					implementationId: 'cljs.js',
					implementationVersion: profile.sourceRevision,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: manifestReceipt.sha256,
						protocolVersion: CLOJURESCRIPT_PREFLIGHT_PROTOCOL_VERSION,
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
					routeId: 'clojurescript',
					runtimeAssetKey: 'clojurescript',
					documentationId: 'CLOJURESCRIPT',
					syncTarget: 'sync:wasm-clojurescript',
					browserTestId: 'browser:clojurescript'
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
		controller.abort(
			new DOMException('ClojureScript runtime preflight timed out', 'TimeoutError')
		);
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				compiler: compilerRequestUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			maxConcurrentDownloads: 2,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const compilerAsset = preflight.assets.compiler;
		if (!manifestAsset || !compilerAsset) {
			throw new RuntimeConfigurationError(
				'ClojureScript runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		if (compilerAsset.bytes[0] !== 0x1f || compilerAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError(
				'ClojureScript runtime compiler storage asset is not gzip data',
				{
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
		}

		const compressedBody = new Response(Uint8Array.from(compilerAsset.bytes)).body;
		if (!compressedBody) {
			throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
						'ClojureScript compiler gzip output exceeds its logical receipt',
						{
							profileId: profile.profileId,
							runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
			throw new AssetIntegrityError(
				'ClojureScript runtime compiler gzip decompression failed',
				{
					cause: error,
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
				}
			);
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
				'ClojureScript compiler gzip output is shorter than its logical receipt',
				{
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
			runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
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
							'ClojureScript runtime integrity verification aborted',
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
			protocol: CLOJURESCRIPT_PREFLIGHT_PROTOCOL,
			protocolVersion: CLOJURESCRIPT_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			sourceRevision: profile.sourceRevision,
			integrationRevision: profile.integrationRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			compilerBytes
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`ClojureScript runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('ClojureScript runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: CLOJURESCRIPT_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
