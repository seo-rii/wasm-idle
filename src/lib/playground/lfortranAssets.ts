import {
	defineRuntimeRegistryManifest,
	preflightRuntimeAssets,
	ResourceLimitError,
	RuntimeConfigurationError,
	type ExecutionLimits
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { WASM_LFORTRAN_PROFILE as profile } from './wasmLfortranVersion';

export const LFORTRAN_INITIAL_MEMORY_BYTES = 128 * 1024 * 1024;

export const LFORTRAN_RUNTIME_MANIFEST = defineRuntimeRegistryManifest({
	schemaVersion: 2,
	manifestId: 'wasm-idle/lfortran',
	revision: profile.assets['producer-receipt.json'].sha256,
	runtimes: [
		{
			runtimeId: 'LFORTRAN',
			identity: {
				languageId: 'LFORTRAN',
				implementationId: 'lfortran-llvm-emscripten',
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
			assets: Object.entries(profile.assets).map(([name, receipt]) => ({
				key: name,
				path: name === 'lfortran.data' ? 'lfortran.data.bin' : name,
				compressedSha256: receipt.sha256,
				uncompressedSha256: receipt.sha256,
				compressedBytes: receipt.bytes,
				uncompressedBytes: receipt.bytes,
				encoding: 'identity',
				mediaType: name.endsWith('.wasm')
					? 'application/wasm'
					: name.endsWith('.js')
						? 'text/javascript'
						: name.endsWith('.json')
							? 'application/json'
							: 'application/octet-stream'
			})),
			contracts: {
				routeId: 'LFORTRAN',
				runtimeAssetKey: 'lfortran',
				documentationId: 'lfortran',
				syncTarget: 'wasm-lfortran',
				browserTestId: 'LFORTRAN'
			}
		}
	]
});

export function resolveLfortranRuntimeAssetConfig(
	assets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof assets === 'string' ? assets : assets.rootUrl || '';
	const override = typeof assets === 'string' ? undefined : assets.lfortran?.baseUrl;
	const baseUrl = new URL(override ?? `${root.replace(/\/+$/, '')}/wasm-lfortran/`, currentUrl);
	if (
		!['http:', 'https:'].includes(baseUrl.protocol) ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'LFortran requires a credential-free HTTP(S) asset directory.',
			{ runtimeId: 'LFORTRAN' }
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

export async function preflightLfortranRuntimeAssets(
	baseUrl: string,
	options: {
		limits: ExecutionLimits;
		signal?: AbortSignal;
		reportProgress?: (value: number, stage: string) => void;
		fetch?: typeof globalThis.fetch;
	}
) {
	if (options.limits.maxWasmMemoryBytes < LFORTRAN_INITIAL_MEMORY_BYTES) {
		throw new ResourceLimitError('LFortran needs at least 128 MiB of Wasm memory.', {
			runtimeId: 'LFORTRAN',
			phase: 'asset',
			resource: 'wasm-memory',
			actual: LFORTRAN_INITIAL_MEMORY_BYTES,
			limit: options.limits.maxWasmMemoryBytes
		});
	}
	const loaded = new Map<string, number>();
	const total = Object.values(profile.assets).reduce((sum, asset) => sum + asset.bytes, 0);
	const result = await preflightRuntimeAssets({
		manifest: LFORTRAN_RUNTIME_MANIFEST,
		runtimeId: 'LFORTRAN',
		rootUrl: baseUrl,
		assetUrls: Object.fromEntries(
			Object.entries(profile.assets).map(([name, asset]) => [
				name,
				new URL(
					`${name === 'lfortran.data' ? 'lfortran.data.bin' : name}?v=${asset.sha256}`,
					baseUrl
				)
			])
		),
		limits: options.limits,
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
				`Verifying LFortran ${progress.assetKey}`
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
