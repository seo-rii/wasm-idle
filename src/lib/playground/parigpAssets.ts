import {
	AssetIntegrityError,
	defineRuntimeRegistryManifest,
	UnsupportedBrowserFeatureError,
	preflightRuntimeAssets,
	ResourceLimitError,
	RuntimeConfigurationError,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions,
	verifyRuntimeAssetIntegrity
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { WASM_PARIGP_PROFILE as profile } from './wasmPariGpVersion';

export const PARIGP_INITIAL_MEMORY_BYTES = 393 * 65536;

/** gp.wasm is delivered as deterministic gzip of the pinned official bytes; `.bin` keeps hosts from adding
 * Content-Encoding, so the browser never transparently decodes it before verification. */
export const PARIGP_WASM_STORAGE_PATH = 'gp.wasm.gz.bin';
const deliveryAssets = [
	{
		key: 'gp.mjs',
		path: 'gp.mjs',
		compressedSha256: profile.delivery['gp.mjs'].sha256,
		uncompressedSha256: profile.delivery['gp.mjs'].sha256,
		compressedBytes: profile.delivery['gp.mjs'].bytes,
		uncompressedBytes: profile.delivery['gp.mjs'].bytes,
		encoding: 'identity' as const,
		mediaType: 'text/javascript'
	},
	{
		key: 'gp.wasm',
		path: PARIGP_WASM_STORAGE_PATH,
		compressedSha256: profile.delivery['gp.wasm.gz.bin'].sha256,
		uncompressedSha256: profile.assets['gp.wasm'].sha256,
		compressedBytes: profile.delivery['gp.wasm.gz.bin'].bytes,
		uncompressedBytes: profile.assets['gp.wasm'].bytes,
		encoding: 'gzip' as const,
		mediaType: 'application/wasm'
	}
];

export const PARIGP_RUNTIME_MANIFEST = defineRuntimeRegistryManifest({
	schemaVersion: 2,
	manifestId: 'wasm-idle/parigp',
	revision: profile.assets['gp.wasm'].sha256,
	runtimes: [
		{
			runtimeId: 'PARIGP',
			identity: {
				languageId: 'PARIGP',
				implementationId: 'pari-gp-emscripten',
				implementationVersion: profile.version,
				profile: {
					profileId: 'pari-gp-2.19.0-wasm32',
					manifestSchemaVersion: 1,
					manifestSha256: profile.assets['gp.wasm'].sha256,
					protocolVersion: 1,
					trustProfileId: 'pari-gp-2.19.0-wasm32',
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
			requiredBrowserFeatures: ['wasm', 'decompression-stream'],
			assetRoot: '.',
			assets: deliveryAssets,
			contracts: {
				routeId: 'PARIGP',
				runtimeAssetKey: 'parigp',
				documentationId: 'parigp',
				syncTarget: 'wasm-parigp',
				browserTestId: 'PARIGP'
			}
		}
	]
});

export function resolvePariGpRuntimeAssetConfig(
	assets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof assets === 'string' ? assets : assets.rootUrl || '';
	const override = typeof assets === 'string' ? undefined : assets.parigp?.baseUrl;
	const baseUrl = new URL(override ?? `${root.replace(/\/+$/, '')}/wasm-parigp/`, currentUrl);
	if (
		!['http:', 'https:'].includes(baseUrl.protocol) ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'PARI/GP requires a credential-free HTTP(S) asset directory.',
			{ runtimeId: 'PARIGP' }
		);
	}
	if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	const workerUrl = new URL('runner-worker.js', baseUrl);
	workerUrl.searchParams.set('v', profile.workerReceipt.sha256);
	return {
		baseUrl: baseUrl.href,
		workerUrl: workerUrl.href,
		manifestFingerprint: profile.assets['gp.wasm'].sha256,
		workerReceipt: profile.workerReceipt
	};
}

export async function preflightPariGpRuntimeAssets(
	baseUrl: string,
	options: {
		limits: ExecutionLimits;
		persistentCache?: RuntimeAssetCacheOptions;
		signal?: AbortSignal;
		reportProgress?: (value: number, stage: string) => void;
		fetch?: typeof globalThis.fetch;
	}
) {
	if (options.limits.maxWasmMemoryBytes < PARIGP_INITIAL_MEMORY_BYTES) {
		throw new ResourceLimitError('PARI/GP needs at least 25 MiB of Wasm memory.', {
			runtimeId: 'PARIGP',
			phase: 'asset',
			resource: 'wasm-memory',
			actual: PARIGP_INITIAL_MEMORY_BYTES,
			limit: options.limits.maxWasmMemoryBytes
		});
	}
	const loaded = new Map<string, number>();
	const total = deliveryAssets.reduce((sum, asset) => sum + asset.compressedBytes, 0);
	const result = await preflightRuntimeAssets({
		manifest: PARIGP_RUNTIME_MANIFEST,
		runtimeId: 'PARIGP',
		rootUrl: baseUrl,
		assetUrls: Object.fromEntries(
			deliveryAssets.map((asset) => [
				asset.key,
				new URL(`${asset.path}?v=${asset.compressedSha256}`, baseUrl)
			])
		),
		limits: options.limits,
		persistentCache: options.persistentCache,
		signal: options.signal,
		fetch: options.fetch,
		redirect: 'error',
		requireExactResponseUrl: true,
		maxConcurrentDownloads: 2,
		maxTotalDeliveryBytes: total,
		reportProgress(progress) {
			loaded.set(progress.assetKey, progress.loadedBytes);
			options.reportProgress?.(
				0.04 + (0.13 * [...loaded.values()].reduce((a, b) => a + b, 0)) / total,
				`Verifying PARI/GP ${progress.assetKey}`
			);
		}
	});
	const wasm = await decompressPariGpWasm(result.assets['gp.wasm'].bytes, options.signal);
	return Object.freeze({
		fingerprint: profile.assets['gp.wasm'].sha256,
		'gp.mjs': result.assets['gp.mjs'].bytes,
		'gp.wasm': wasm
	});
}

/** Decode the verified gzip delivery into an exactly sized buffer and verify the logical receipt. */
export async function decompressPariGpWasm(compressed: Uint8Array, signal?: AbortSignal) {
	const context = { runtimeId: 'PARIGP', profileId: 'pari-gp-2.19.0-wasm32' };
	if (typeof DecompressionStream !== 'function')
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			...context,
			phase: 'asset'
		});
	const expected = profile.assets['gp.wasm'];
	const body = new Response(Uint8Array.from(compressed)).body!;
	const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	const wasm = new Uint8Array(expected.bytes);
	let offset = 0;
	try {
		for (;;) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.byteLength > wasm.byteLength)
				throw new AssetIntegrityError(
					'PARI/GP gp.wasm gzip output exceeds its receipt',
					context
				);
			wasm.set(value, offset);
			offset += value.byteLength;
		}
	} catch (error) {
		void reader.cancel().catch(() => undefined);
		if (error instanceof AssetIntegrityError || signal?.aborted) throw error;
		throw new AssetIntegrityError('PARI/GP gp.wasm gzip decompression failed', {
			...context,
			cause: error
		});
	}
	if (offset !== wasm.byteLength)
		throw new AssetIntegrityError('PARI/GP gp.wasm gzip output is truncated', context);
	await verifyRuntimeAssetIntegrity({
		asset: 'gp.wasm',
		bytes: wasm,
		expected: {
			...expected,
			uncompressedSha256: expected.sha256,
			uncompressedBytes: expected.bytes
		},
		stage: 'uncompressed',
		mimeType: 'application/wasm',
		...context
	});
	return wasm;
}
