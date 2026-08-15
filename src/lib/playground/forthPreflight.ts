import type { ForthRuntimePreflightProfile } from '$lib/playground/assets';
import {
	RuntimeConfigurationError,
	preflightRuntimeAssets,
	type ExecutionLimits,
	type RuntimeAssetPreflightProgress,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';

export const FORTH_PREFLIGHT_PROTOCOL = 'wasm-idle-forth-preflight' as const;
export const FORTH_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const FORTH_PREFLIGHT_RUNTIME_ID = 'FORTH' as const;

export interface ForthRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: ForthRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
}

export interface ForthRuntimePreflightPayload {
	readonly protocol: typeof FORTH_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof FORTH_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly implementationVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly runtimeBytes: Uint8Array;
}

export async function preflightForthRuntimeAssets(
	request: ForthRuntimePreflightRequest
): Promise<ForthRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Forth runtime preflight request is required', {
			phase: 'asset',
			runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
		});
	}
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Forth runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
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
			'Forth runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', runtimeId: FORTH_PREFLIGHT_RUNTIME_ID }
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
			'Forth runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', runtimeId: FORTH_PREFLIGHT_RUNTIME_ID }
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
			'Forth runtime manifest path must be a normalized file beneath the runtime base',
			{ phase: 'asset', runtimeId: FORTH_PREFLIGHT_RUNTIME_ID }
		);
	}

	const profile = request.profile;
	if (
		!profile ||
		typeof profile !== 'object' ||
		typeof profile.profileId !== 'string' ||
		!/^waforth-[A-Za-z0-9._-]+$/u.test(profile.profileId) ||
		typeof profile.implementationVersion !== 'string' ||
		!/^[A-Za-z0-9._-]+$/u.test(profile.implementationVersion) ||
		profile.profileId !== `waforth-${profile.implementationVersion}` ||
		typeof profile.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(profile.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Forth runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, receipt] of [
		['manifest', profile.manifestReceipt],
		['runtime', profile.runtimeReceipt]
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
				`Forth runtime ${label} preflight receipt is invalid`,
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	if (manifestPath === 'waforth.js') {
		throw new RuntimeConfigurationError(
			'Forth runtime manifest and executable asset paths must be distinct',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
			}
		);
	}

	const manifestReceipt = profile.manifestReceipt!;
	const runtimeReceipt = profile.runtimeReceipt!;
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'Forth runtime manifest query must be the pinned manifest fingerprint cache-buster',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const runtimeRequestUrl = new URL('waforth.js', baseUrl);
	runtimeRequestUrl.searchParams.set('v', runtimeReceipt.sha256);
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/forth-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: FORTH_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'FORTH',
					implementationId: 'waforth',
					implementationVersion: profile.implementationVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: manifestReceipt.sha256,
						protocolVersion: FORTH_PREFLIGHT_PROTOCOL_VERSION,
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
				requiredBrowserFeatures: ['wasm'],
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
						key: 'runtime',
						path: 'waforth.js',
						compressedSha256: runtimeReceipt.sha256,
						uncompressedSha256: runtimeReceipt.sha256,
						compressedBytes: runtimeReceipt.bytes!,
						uncompressedBytes: runtimeReceipt.bytes!,
						mediaType: 'application/javascript',
						encoding: 'identity'
					}
				],
				contracts: {
					routeId: 'forth',
					runtimeAssetKey: 'forth',
					documentationId: 'FORTH',
					syncTarget: 'sync:wasm-forth',
					browserTestId: 'browser:forth'
				}
			}
		]
	};
	const preflight = await preflightRuntimeAssets({
		manifest: registry,
		runtimeId: FORTH_PREFLIGHT_RUNTIME_ID,
		rootUrl: baseUrl,
		assetUrls: {
			manifest: manifestRequestUrl,
			runtime: runtimeRequestUrl
		},
		fetch: request.fetch,
		signal: request.signal,
		limits: request.limits,
		maxConcurrentDownloads: 2,
		reportProgress: request.reportProgress
	});
	const manifestAsset = preflight.assets.manifest;
	const runtimeAsset = preflight.assets.runtime;
	if (!manifestAsset || !runtimeAsset) {
		throw new RuntimeConfigurationError(
			'Forth runtime preflight returned an incomplete asset set',
			{
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: FORTH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return Object.freeze({
		protocol: FORTH_PREFLIGHT_PROTOCOL,
		protocolVersion: FORTH_PREFLIGHT_PROTOCOL_VERSION,
		profileId: profile.profileId,
		implementationVersion: profile.implementationVersion,
		manifestFingerprint: profile.manifestFingerprint,
		manifestBytes: Uint8Array.from(manifestAsset.bytes),
		runtimeBytes: Uint8Array.from(runtimeAsset.bytes)
	});
}
