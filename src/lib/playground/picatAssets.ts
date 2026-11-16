import {
	defineRuntimeRegistryManifest,
	preflightRuntimeAssets,
	verifyRuntimeAssetIntegrity,
	RuntimeConfigurationError,
	ResourceLimitError,
	AssetIntegrityError,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { WASM_PICAT_PROFILE as profile } from './wasmPicatVersion';

const deliveryAssets = Object.entries(profile.assets).map(([key, receipt]) => {
	const path = key.endsWith('.mjs') ? key : `${key}.gz.bin`;
	const storage = profile.storage[path as keyof typeof profile.storage];
	return {
		key,
		path,
		compressedSha256: storage.sha256,
		uncompressedSha256: receipt.sha256,
		compressedBytes: storage.bytes,
		uncompressedBytes: receipt.bytes,
		encoding: key.endsWith('.mjs') ? ('identity' as const) : ('gzip' as const),
		mediaType: key.endsWith('.mjs')
			? 'text/javascript'
			: key.endsWith('.wasm')
				? 'application/wasm'
				: 'application/octet-stream'
	};
});
export const PICAT_RUNTIME_MANIFEST = defineRuntimeRegistryManifest({
	schemaVersion: 2,
	manifestId: 'wasm-idle/picat',
	revision: profile.assets['picat.wasm'].sha256,
	runtimes: [
		{
			runtimeId: 'PICAT',
			identity: {
				languageId: 'PICAT',
				implementationId: 'picat-official-playground',
				implementationVersion: profile.version,
				profile: {
					profileId: profile.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: profile.assets['picat.wasm'].sha256,
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
			requiredBrowserFeatures: ['wasm', 'decompression-stream'],
			assetRoot: '.',
			assets: deliveryAssets,
			contracts: {
				routeId: 'PICAT',
				runtimeAssetKey: 'picat',
				documentationId: 'picat',
				syncTarget: 'wasm-picat',
				browserTestId: 'PICAT'
			}
		}
	]
});

export function resolvePicatRuntimeAssetConfig(
	assets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof assets === 'string' ? assets : assets.rootUrl || '';
	const override = typeof assets === 'string' ? undefined : assets.picat?.baseUrl;
	const base = new URL(override ?? `${root.replace(/\/+$/, '')}/wasm-picat/`, currentUrl);
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new RuntimeConfigurationError(
			'Picat requires a credential-free HTTP(S) asset directory',
			{ runtimeId: 'PICAT' }
		);
	if (!base.pathname.endsWith('/')) base.pathname += '/';
	const worker = new URL('runner-worker.js', base);
	worker.searchParams.set('v', profile.workerReceipt.sha256);
	return {
		baseUrl: base.href,
		workerUrl: worker.href,
		workerReceipt: profile.workerReceipt,
		manifestFingerprint: profile.assets['picat.wasm'].sha256
	};
}

export async function preflightPicatRuntimeAssets(
	baseUrl: string,
	options: {
		limits: ExecutionLimits;
		persistentCache?: RuntimeAssetCacheOptions;
		signal?: AbortSignal;
		fetch?: typeof globalThis.fetch;
	}
) {
	if (options.limits.maxWasmMemoryBytes < 64 * 1024 * 1024)
		throw new ResourceLimitError('Picat requires at least 64 MiB of Wasm memory', {
			runtimeId: 'PICAT',
			phase: 'asset',
			resource: 'wasm-memory',
			actual: 64 * 1024 * 1024,
			limit: options.limits.maxWasmMemoryBytes
		});
	const result = await preflightRuntimeAssets({
		manifest: PICAT_RUNTIME_MANIFEST,
		runtimeId: 'PICAT',
		rootUrl: baseUrl,
		assetUrls: Object.fromEntries(
			deliveryAssets.map((a) => [
				a.key,
				new URL(`${a.path}?v=${a.compressedSha256}`, baseUrl)
			])
		),
		limits: options.limits,
		persistentCache: options.persistentCache,
		signal: options.signal,
		fetch: options.fetch,
		redirect: 'error',
		requireExactResponseUrl: true,
		maxConcurrentDownloads: 3
	});
	const payload: Record<string, unknown> = { fingerprint: profile.assets['picat.wasm'].sha256 };
	for (const asset of deliveryAssets) {
		let bytes = result.assets[asset.key].bytes;
		if (asset.encoding === 'gzip') {
			const reader = new Response(Uint8Array.from(bytes))
				.body!.pipeThrough(new DecompressionStream('gzip'))
				.getReader();
			const output = new Uint8Array(asset.uncompressedBytes);
			let offset = 0;
			try {
				for (;;) {
					options.signal?.throwIfAborted();
					const part = await reader.read();
					if (part.done) break;
					if (offset + part.value.length > output.length)
						throw new AssetIntegrityError('Picat decompression exceeded its receipt', {
							runtimeId: 'PICAT'
						});
					output.set(part.value, offset);
					offset += part.value.length;
				}
			} catch (error) {
				await reader.cancel().catch(() => {});
				throw error;
			}
			if (offset !== output.length)
				throw new AssetIntegrityError('Picat decompression size mismatch', {
					runtimeId: 'PICAT'
				});
			bytes = output;
		}
		await verifyRuntimeAssetIntegrity({
			asset: asset.key,
			bytes,
			expected: profile.assets[asset.key as keyof typeof profile.assets],
			runtimeId: 'PICAT'
		});
		payload[asset.key] = bytes;
	}
	return Object.freeze(payload);
}
