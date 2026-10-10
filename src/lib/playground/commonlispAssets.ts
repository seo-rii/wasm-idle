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
import { WASM_COMMONLISP_PROFILE as profile } from './wasmCommonLispVersion';

export const COMMONLISP_INITIAL_MEMORY_BYTES = 64 * 1024 * 1024;

/** ecl.wasm is delivered as the producer's pinned gzip bytes; `.bin` keeps hosts from adding
 * Content-Encoding, so the browser never transparently decodes it before verification. */
export const COMMONLISP_WASM_STORAGE_PATH = 'ecl.wasm.gz.bin';
const identityAsset = (name: 'producer-receipt.json' | 'ecl.mjs', mediaType: string) => ({
	key: name,
	path: name,
	compressedSha256: profile.assets[name].sha256,
	uncompressedSha256: profile.assets[name].sha256,
	compressedBytes: profile.assets[name].bytes,
	uncompressedBytes: profile.assets[name].bytes,
	encoding: 'identity' as const,
	mediaType
});
const deliveryAssets = [
	identityAsset('producer-receipt.json', 'application/json'),
	identityAsset('ecl.mjs', 'text/javascript'),
	{
		key: 'ecl.wasm',
		path: COMMONLISP_WASM_STORAGE_PATH,
		compressedSha256: profile.assets['ecl.wasm.gz'].sha256,
		uncompressedSha256: profile.runtime['ecl.wasm'].sha256,
		compressedBytes: profile.assets['ecl.wasm.gz'].bytes,
		uncompressedBytes: profile.runtime['ecl.wasm'].bytes,
		encoding: 'gzip' as const,
		mediaType: 'application/wasm'
	}
];

export const COMMONLISP_RUNTIME_MANIFEST = defineRuntimeRegistryManifest({
	schemaVersion: 2,
	manifestId: 'wasm-idle/commonlisp',
	revision: profile.assets['producer-receipt.json'].sha256,
	runtimes: [
		{
			runtimeId: 'COMMONLISP',
			identity: {
				languageId: 'COMMONLISP',
				implementationId: 'ecl-emscripten',
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
			requiredBrowserFeatures: ['wasm', 'wasm-exceptions', 'decompression-stream'],
			assetRoot: '.',
			assets: deliveryAssets,
			contracts: {
				routeId: 'COMMONLISP',
				runtimeAssetKey: 'commonlisp',
				documentationId: 'commonlisp',
				syncTarget: 'wasm-commonlisp',
				browserTestId: 'COMMONLISP'
			}
		}
	]
});

export function resolveCommonLispRuntimeAssetConfig(
	assets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof assets === 'string' ? assets : assets.rootUrl || '';
	const override = typeof assets === 'string' ? undefined : assets.commonlisp?.baseUrl;
	const baseUrl = new URL(override ?? `${root.replace(/\/+$/, '')}/wasm-commonlisp/`, currentUrl);
	if (
		!['http:', 'https:'].includes(baseUrl.protocol) ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'Common Lisp requires a credential-free HTTP(S) asset directory.',
			{ runtimeId: 'COMMONLISP' }
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

export async function preflightCommonLispRuntimeAssets(
	baseUrl: string,
	options: {
		limits: ExecutionLimits;
		persistentCache?: RuntimeAssetCacheOptions;
		signal?: AbortSignal;
		reportProgress?: (value: number, stage: string) => void;
		fetch?: typeof globalThis.fetch;
	}
) {
	if (options.limits.maxWasmMemoryBytes < COMMONLISP_INITIAL_MEMORY_BYTES) {
		throw new ResourceLimitError('Common Lisp needs at least 64 MiB of Wasm memory.', {
			runtimeId: 'COMMONLISP',
			phase: 'asset',
			resource: 'wasm-memory',
			actual: COMMONLISP_INITIAL_MEMORY_BYTES,
			limit: options.limits.maxWasmMemoryBytes
		});
	}
	const loaded = new Map<string, number>();
	const total = deliveryAssets.reduce((sum, asset) => sum + asset.compressedBytes, 0);
	const result = await preflightRuntimeAssets({
		manifest: COMMONLISP_RUNTIME_MANIFEST,
		runtimeId: 'COMMONLISP',
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
				`Verifying ECL ${progress.assetKey}`
			);
		}
	});
	const wasm = await decompressCommonLispWasm(result.assets['ecl.wasm'].bytes, options.signal);
	return Object.freeze({
		fingerprint: profile.assets['producer-receipt.json'].sha256,
		'producer-receipt.json': result.assets['producer-receipt.json'].bytes,
		'ecl.mjs': result.assets['ecl.mjs'].bytes,
		'ecl.wasm': wasm
	});
}

/** Decode the verified gzip delivery into an exactly sized buffer and verify the logical receipt. */
export async function decompressCommonLispWasm(compressed: Uint8Array, signal?: AbortSignal) {
	const context = { runtimeId: 'COMMONLISP', profileId: profile.profileId };
	if (typeof DecompressionStream !== 'function')
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			...context,
			phase: 'asset'
		});
	const expected = profile.runtime['ecl.wasm'];
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
					'ECL ecl.wasm gzip output exceeds its receipt',
					context
				);
			wasm.set(value, offset);
			offset += value.byteLength;
		}
	} catch (error) {
		void reader.cancel().catch(() => undefined);
		if (error instanceof AssetIntegrityError || signal?.aborted) throw error;
		throw new AssetIntegrityError('ECL ecl.wasm gzip decompression failed', {
			...context,
			cause: error
		});
	}
	if (offset !== wasm.byteLength)
		throw new AssetIntegrityError('ECL ecl.wasm gzip output is truncated', context);
	await verifyRuntimeAssetIntegrity({
		asset: 'ecl.wasm',
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
