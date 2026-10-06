import {
	defineRuntimeRegistryManifest,
	preflightRuntimeAssets,
	ResourceLimitError,
	RuntimeConfigurationError,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { WASM_LEAN4_PROFILE as profile } from './wasmLean4Version';

/** Linear memory needed to start Lean, import Init, and interpret a small program. */
export const LEAN4_INITIAL_MEMORY_BYTES = 256 * 1024 * 1024;
/** Default limit: importing the 277 MB Init library grows the heap to about 370 MiB. */
export const LEAN4_DEFAULT_WASM_MEMORY_BYTES = 1024 ** 3;

type Lean4AssetReceipt = {
	readonly bytes: number;
	readonly sha256: string;
	readonly encoding?: 'gzip';
	readonly logicalName?: string;
	readonly uncompressed?: { readonly bytes: number; readonly sha256: string };
};

const assets = Object.entries(profile.assets) as [string, Lean4AssetReceipt][];

function mediaType(name: string) {
	if (name.endsWith('.mjs')) return 'text/javascript';
	if (name.endsWith('.json')) return 'application/json';
	if (name.startsWith('lean.wasm')) return 'application/wasm';
	return 'application/octet-stream';
}

export const LEAN4_RUNTIME_MANIFEST = defineRuntimeRegistryManifest({
	schemaVersion: 2,
	manifestId: 'wasm-idle/lean4',
	revision: profile.assets['producer-receipt.json'].sha256,
	runtimes: [
		{
			runtimeId: 'LEAN4',
			identity: {
				languageId: 'LEAN4',
				implementationId: 'lean4-emscripten',
				implementationVersion: profile.version,
				profile: {
					profileId: profile.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: profile.assets['producer-receipt.json'].sha256,
					protocolVersion: 1,
					trustProfileId: profile.profileId,
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
			requiredBrowserFeatures: ['wasm', 'wasm-exceptions', 'shared-array-buffer'],
			assetRoot: '.',
			assets: assets.map(([name, receipt]) => ({
				key: name,
				path: name,
				compressedSha256: receipt.sha256,
				uncompressedSha256: receipt.uncompressed?.sha256 ?? receipt.sha256,
				compressedBytes: receipt.bytes,
				uncompressedBytes: receipt.uncompressed?.bytes ?? receipt.bytes,
				encoding: receipt.encoding ?? 'identity',
				mediaType: mediaType(name)
			})),
			contracts: {
				routeId: 'LEAN4',
				runtimeAssetKey: 'lean4',
				documentationId: 'lean4',
				syncTarget: 'sync:wasm-lean4',
				browserTestId: 'LEAN4'
			}
		}
	]
});

export function resolveLean4RuntimeAssetConfig(
	runtimeAssets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets.rootUrl || '';
	const override = typeof runtimeAssets === 'string' ? undefined : runtimeAssets.lean4?.baseUrl;
	const baseUrl = new URL(override ?? `${root.replace(/\/+$/, '')}/wasm-lean4/`, currentUrl);
	if (
		!['http:', 'https:'].includes(baseUrl.protocol) ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'Lean 4 requires a credential-free HTTP(S) asset directory.',
			{ runtimeId: 'LEAN4' }
		);
	}
	if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	const workerUrl = new URL('runner-worker.js', baseUrl);
	workerUrl.searchParams.set('v', profile.workerReceipt.sha256);
	return {
		baseUrl: baseUrl.href,
		workerUrl: workerUrl.href,
		manifestFingerprint: profile.assets['producer-receipt.json'].sha256,
		workerReceipt: profile.workerReceipt
	};
}

export async function preflightLean4RuntimeAssets(
	baseUrl: string,
	options: {
		limits: ExecutionLimits;
		persistentCache?: RuntimeAssetCacheOptions;
		signal?: AbortSignal;
		reportProgress?: (value: number, stage: string) => void;
		fetch?: typeof globalThis.fetch;
	}
) {
	if (options.limits.maxWasmMemoryBytes < LEAN4_INITIAL_MEMORY_BYTES) {
		throw new ResourceLimitError('Lean 4 needs at least 256 MiB of Wasm memory.', {
			runtimeId: 'LEAN4',
			phase: 'asset',
			resource: 'wasm-memory',
			actual: LEAN4_INITIAL_MEMORY_BYTES,
			limit: options.limits.maxWasmMemoryBytes
		});
	}
	const loaded = new Map<string, number>();
	const total = assets.reduce((sum, [, asset]) => sum + asset.bytes, 0);
	const result = await preflightRuntimeAssets({
		manifest: LEAN4_RUNTIME_MANIFEST,
		runtimeId: 'LEAN4',
		rootUrl: baseUrl,
		assetUrls: Object.fromEntries(
			assets.map(([name, asset]) => [name, new URL(`${name}?v=${asset.sha256}`, baseUrl)])
		),
		limits: options.limits,
		persistentCache: options.persistentCache,
		signal: options.signal,
		fetch: options.fetch,
		redirect: 'error',
		requireExactResponseUrl: true,
		maxConcurrentDownloads: 3,
		maxTotalDeliveryBytes: total,
		reportProgress(progress) {
			loaded.set(progress.assetKey, progress.loadedBytes);
			options.reportProgress?.(
				0.04 + (0.13 * [...loaded.values()].reduce((a, b) => a + b, 0)) / total,
				`Downloading Lean 4 ${progress.assetKey}`
			);
		}
	});
	return Object.freeze({
		fingerprint: profile.assets['producer-receipt.json'].sha256,
		...Object.fromEntries(
			Object.entries(result.assets).map(([name, asset]) => [name, asset.bytes])
		)
	});
}
