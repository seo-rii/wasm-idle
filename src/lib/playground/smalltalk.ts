import {
	RuntimeConfigurationError,
	AssetIntegrityError,
	verifyRuntimeAssetIntegrity,
	preflightRuntimeAssets,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import {
	SMALLTALK_PROFILE,
	SMALLTALK_WORKER_RECEIPT,
	SMALLTALK_MANIFEST_RECEIPT
} from './wasmSmalltalkVersion';

const assets = Object.entries(SMALLTALK_PROFILE.assets).map(([name, receipt]) => ({
	key: name,
	path: name,
	mediaType: name.endsWith('.js') ? 'text/javascript' : 'application/json',
	compressedBytes: receipt.bytes,
	uncompressedBytes: 'uncompressedBytes' in receipt ? receipt.uncompressedBytes : receipt.bytes,
	compressedSha256: receipt.sha256,
	uncompressedSha256:
		'uncompressedSha256' in receipt ? receipt.uncompressedSha256 : receipt.sha256,
	encoding: name.endsWith('.gz.bin') ? ('gzip' as const) : ('identity' as const)
}));
const registry: RuntimeRegistryManifest = {
	schemaVersion: 2,
	manifestId: 'wasm-idle/smalltalk-preflight',
	revision: SMALLTALK_MANIFEST_RECEIPT.sha256,
	runtimes: [
		{
			runtimeId: 'SMALLTALK',
			identity: {
				languageId: 'SMALLTALK',
				implementationId: 'ismalltalk',
				implementationVersion: '0.32.0',
				profile: {
					profileId: SMALLTALK_PROFILE.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: SMALLTALK_MANIFEST_RECEIPT.sha256,
					protocolVersion: 1,
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
			requiredBrowserFeatures: [],
			assetRoot: '.',
			assets: [
				...assets,
				{
					key: 'manifestBytes',
					path: 'runtime-build.json',
					mediaType: 'application/json',
					compressedBytes: SMALLTALK_MANIFEST_RECEIPT.bytes,
					uncompressedBytes: SMALLTALK_MANIFEST_RECEIPT.bytes,
					compressedSha256: SMALLTALK_MANIFEST_RECEIPT.sha256,
					uncompressedSha256: SMALLTALK_MANIFEST_RECEIPT.sha256,
					encoding: 'identity'
				}
			],
			contracts: {
				routeId: 'smalltalk',
				runtimeAssetKey: 'smalltalk',
				documentationId: 'SMALLTALK',
				syncTarget: 'sync:wasm-smalltalk',
				browserTestId: 'browser:smalltalk'
			}
		}
	]
};

/** The original Amber compiler, chunk importer and kernel, isolated for each run. */
export default class Smalltalk extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'SMALLTALK',
			displayName: 'Smalltalk (Amber)',
			defaultActivePath: 'main.st',
			stdin: { mode: 'streaming', sourceHintPattern: /[\s\S]/u },
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			moduleWorker: true,
			requireExactWorkerResponseUrl: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const root =
					typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets.rootUrl || '';
				const baseUrl = new URL(root.replace(/\/$/u, '') + '/wasm-smalltalk/', currentUrl)
					.href;
				return {
					baseUrl,
					workerUrl: new URL('runner-worker.js', baseUrl).href,
					manifestUrl: new URL('runtime-build.json', baseUrl).href,
					manifestFingerprint: SMALLTALK_MANIFEST_RECEIPT.sha256,
					workerReceipt: SMALLTALK_WORKER_RECEIPT
				};
			},
			async preflightRuntimeAssets(urls, context) {
				const result = await preflightRuntimeAssets({
					manifest: registry,
					runtimeId: 'SMALLTALK',
					rootUrl: urls.baseUrl,
					limits: context.limits,
					persistentCache: context.persistentCache,
					signal: context.signal,
					redirect: 'error',
					requireExactResponseUrl: true,
					maxTotalDeliveryBytes: assets.reduce<number>(
						(sum, asset) => sum + asset.compressedBytes,
						SMALLTALK_MANIFEST_RECEIPT.bytes
					),
					reportProgress(progress) {
						context.reportProgress(0.1, `Preflighting Smalltalk ${progress.assetKey}`);
					}
				});
				const payload: Record<string, Uint8Array> = {};
				for (const asset of assets) {
					let bytes = result.assets[asset.key].bytes;
					if (asset.encoding === 'gzip') {
						const reader = new Response(Uint8Array.from(bytes))
							.body!.pipeThrough(new DecompressionStream('gzip'))
							.getReader();
						const output = new Uint8Array(asset.uncompressedBytes);
						let offset = 0;
						const abort = () => {
							void reader.cancel(context.signal?.reason).catch(() => {});
						};
						context.signal?.addEventListener('abort', abort, { once: true });
						try {
							for (;;) {
								context.signal?.throwIfAborted();
								const part = await reader.read();
								if (part.done) break;
								if (offset + part.value.length > output.length)
									throw new AssetIntegrityError(
										'Smalltalk decompression exceeded its receipt',
										{ runtimeId: 'SMALLTALK' }
									);
								output.set(part.value, offset);
								offset += part.value.length;
							}
							context.signal?.throwIfAborted();
						} catch (error) {
							await reader.cancel().catch(() => {});
							throw error;
						} finally {
							context.signal?.removeEventListener('abort', abort);
							reader.releaseLock();
						}
						if (offset !== output.length)
							throw new AssetIntegrityError('Smalltalk decompression size mismatch', {
								runtimeId: 'SMALLTALK'
							});
						bytes = output;
					}
					await verifyRuntimeAssetIntegrity({
						asset: asset.key,
						bytes,
						expected: {
							bytes: asset.uncompressedBytes,
							sha256: asset.uncompressedSha256
						},
						runtimeId: 'SMALLTALK'
					});
					payload[asset.key] = bytes;
				}
				return context.createOwnedDelivery(
					Object.freeze({
						protocol: 'wasm-idle-smalltalk-preflight',
						profileId: SMALLTALK_PROFILE.profileId,
						...payload
					})
				);
			}
		});
	}
	override run(
		code: string,
		prepare: boolean,
		log = true,
		progress?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	) {
		try {
			const resolved = resolveSandboxExecutionArgs('SMALLTALK', args, options);
			if (resolved.compileArgs.length)
				throw new RuntimeConfigurationError(
					'Smalltalk compiler arguments are fixed by this runtime profile',
					{ runtimeId: 'SMALLTALK' }
				);
			return super.run(code, prepare, log, progress, resolved.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
