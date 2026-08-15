import type { BqnRuntimePreflightProfile } from '$lib/playground/assets';
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

export const BQN_PREFLIGHT_PROTOCOL = 'wasm-idle-bqn-preflight' as const;
export const BQN_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const BQN_PREFLIGHT_RUNTIME_ID = 'BQN' as const;

const MAX_MANIFEST_BYTES = 64 * 1024;
const VERIFIED_WASM_STORAGE_PATH = 'BQN.wasm.gz.bin';

export interface BqnRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: BqnRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface BqnRuntimePreflightPayload {
	readonly protocol: typeof BQN_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof BQN_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly sourceRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly moduleBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
}

export async function preflightBqnRuntimeAssets(
	request: BqnRuntimePreflightRequest
): Promise<BqnRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('BQN runtime preflight request is required', {
			phase: 'asset',
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
		});
	}
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('BQN runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
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
			'BQN runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', runtimeId: BQN_PREFLIGHT_RUNTIME_ID }
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
			'BQN runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', runtimeId: BQN_PREFLIGHT_RUNTIME_ID }
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
			'BQN runtime manifest path must be a normalized file beneath the runtime base',
			{ phase: 'asset', runtimeId: BQN_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (manifestPath === 'BQN.js' || manifestPath === VERIFIED_WASM_STORAGE_PATH) {
		throw new RuntimeConfigurationError(
			'BQN runtime manifest and executable asset paths must be distinct',
			{ phase: 'asset', runtimeId: BQN_PREFLIGHT_RUNTIME_ID }
		);
	}

	const profile = request.profile;
	if (
		!profile ||
		typeof profile !== 'object' ||
		typeof profile.profileId !== 'string' ||
		!/^dzaima-cbqn-[A-Za-z0-9._-]+$/u.test(profile.profileId) ||
		typeof profile.sourceRevision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(profile.sourceRevision) ||
		typeof profile.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(profile.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('BQN runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, receipt] of [
		['manifest', profile.manifestReceipt],
		['module', profile.moduleReceipt]
	] as const) {
		if (
			!receipt ||
			typeof receipt !== 'object' ||
			!Number.isSafeInteger(receipt.bytes) ||
			(receipt.bytes ?? 0) <= 0 ||
			typeof receipt.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(receipt.sha256)
		) {
			throw new RuntimeConfigurationError(
				`BQN runtime ${label} preflight receipt is invalid`,
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BQN_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	const wasmReceipt = profile.wasmReceipt;
	if (
		!wasmReceipt ||
		typeof wasmReceipt !== 'object' ||
		!Number.isSafeInteger(wasmReceipt.bytes) ||
		(wasmReceipt.bytes ?? 0) <= 0 ||
		typeof wasmReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(wasmReceipt.sha256) ||
		!Number.isSafeInteger(wasmReceipt.uncompressedBytes) ||
		(wasmReceipt.uncompressedBytes ?? 0) <= 0 ||
		typeof wasmReceipt.uncompressedSha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(wasmReceipt.uncompressedSha256)
	) {
		throw new RuntimeConfigurationError('BQN runtime Wasm preflight receipt is invalid', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
		});
	}

	const limits = resolveExecutionLimits(request.limits);
	const oversized = [
		[
			'manifest',
			profile.manifestReceipt!.bytes!,
			Math.min(MAX_MANIFEST_BYTES, limits.maxAssetBytes)
		],
		['module', profile.moduleReceipt!.bytes!, limits.maxAssetBytes],
		['compressed Wasm', wasmReceipt.bytes!, limits.maxAssetBytes],
		['logical Wasm', wasmReceipt.uncompressedBytes!, limits.maxAssetBytes]
	] as const;
	for (const [label, bytes, limit] of oversized) {
		if (bytes > limit) {
			throw new AssetTooLargeError(`BQN runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
		});
	}

	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'BQN runtime manifest query must be the pinned manifest fingerprint cache-buster',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const moduleRequestUrl = new URL('BQN.js', baseUrl);
	moduleRequestUrl.searchParams.set('v', profile.moduleReceipt!.sha256);
	const wasmRequestUrl = new URL(VERIFIED_WASM_STORAGE_PATH, baseUrl);
	wasmRequestUrl.searchParams.set('v', wasmReceipt.sha256);

	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/bqn-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'BQN',
					implementationId: 'dzaima/CBQN',
					implementationVersion: profile.sourceRevision,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt!.sha256,
						protocolVersion: BQN_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: false,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm', 'decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: manifestPath,
						compressedSha256: profile.manifestReceipt!.sha256,
						uncompressedSha256: profile.manifestReceipt!.sha256,
						compressedBytes: profile.manifestReceipt!.bytes!,
						uncompressedBytes: profile.manifestReceipt!.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'module',
						path: 'BQN.js',
						compressedSha256: profile.moduleReceipt!.sha256,
						uncompressedSha256: profile.moduleReceipt!.sha256,
						compressedBytes: profile.moduleReceipt!.bytes!,
						uncompressedBytes: profile.moduleReceipt!.bytes!,
						mediaType: 'text/javascript',
						encoding: 'identity'
					},
					{
						key: 'wasm',
						path: VERIFIED_WASM_STORAGE_PATH,
						compressedSha256: wasmReceipt.sha256,
						uncompressedSha256: wasmReceipt.uncompressedSha256!,
						compressedBytes: wasmReceipt.bytes!,
						uncompressedBytes: wasmReceipt.uncompressedBytes!,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'bqn',
					runtimeAssetKey: 'bqn',
					documentationId: 'BQN',
					syncTarget: 'sync:wasm-bqn',
					browserTestId: 'browser:bqn'
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
		controller.abort(new DOMException('BQN runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				module: moduleRequestUrl,
				wasm: wasmRequestUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits,
			maxConcurrentDownloads: 3,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const moduleAsset = preflight.assets.module;
		const wasmAsset = preflight.assets.wasm;
		if (!manifestAsset || !moduleAsset || !wasmAsset) {
			throw new RuntimeConfigurationError(
				'BQN runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BQN_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		if (wasmAsset.bytes[0] !== 0x1f || wasmAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError('BQN runtime Wasm storage asset is not gzip data', {
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			});
		}

		const compressedBody = new Response(Uint8Array.from(wasmAsset.bytes)).body;
		if (!compressedBody) {
			throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			});
		}
		const stream = compressedBody.pipeThrough(new DecompressionStream('gzip'));
		const reader = stream.getReader();
		const wasmBytes = new Uint8Array(wasmReceipt.uncompressedBytes!);
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
				if (offset + value.byteLength > wasmBytes.byteLength) {
					const error = new AssetIntegrityError(
						'BQN runtime Wasm gzip output exceeds its logical receipt',
						{ profileId: profile.profileId, runtimeId: BQN_PREFLIGHT_RUNTIME_ID }
					);
					try {
						await reader.cancel(error);
					} catch {
						// Preserve the expansion-limit failure.
					}
					throw error;
				}
				wasmBytes.set(value, offset);
				offset += value.byteLength;
				request.reportDecompressionProgress?.(offset, wasmBytes.byteLength);
			}
		} catch (error) {
			if (controller.signal.aborted || isWasmIdleError(error)) throw error;
			throw new AssetIntegrityError('BQN runtime Wasm gzip decompression failed', {
				cause: error,
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			});
		} finally {
			controller.signal.removeEventListener('abort', cancelDecompression);
			try {
				reader.releaseLock();
			} catch {
				// Cancellation may already have detached the stream reader.
			}
		}
		if (offset !== wasmBytes.byteLength) {
			throw new AssetIntegrityError(
				'BQN runtime Wasm gzip output is shorter than its logical receipt',
				{
					profileId: profile.profileId,
					runtimeId: BQN_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const logicalIntegrity = verifyRuntimeAssetIntegrity({
			asset: 'BQN.wasm',
			bytes: wasmBytes,
			expected: wasmReceipt,
			stage: 'uncompressed',
			mimeType: 'application/wasm',
			profileId: profile.profileId,
			runtimeId: BQN_PREFLIGHT_RUNTIME_ID
		});
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const rejectOnAbort = () => {
				if (settled) return;
				settled = true;
				controller.signal.removeEventListener('abort', rejectOnAbort);
				reject(
					controller.signal.reason ??
						new DOMException('BQN runtime integrity verification aborted', 'AbortError')
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
			protocol: BQN_PREFLIGHT_PROTOCOL,
			protocolVersion: BQN_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			sourceRevision: profile.sourceRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			moduleBytes: Uint8Array.from(moduleAsset.bytes),
			wasmBytes
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`BQN runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BQN_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('BQN runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BQN_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
