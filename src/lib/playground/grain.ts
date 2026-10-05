import { resolveGrainBaseUrl } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	bundledGrainProfile as profile,
	bundledGrainWorkerReceipt
} from '$lib/playground/wasmGrainVersion';
import { preflightRuntimeAssets, type RuntimeRegistryManifest } from '@wasm-idle/core';

const registry: RuntimeRegistryManifest = {
	schemaVersion: 2,
	manifestId: 'wasm-idle/grain-preflight',
	revision: profile.compilerJavaScript.sha256,
	runtimes: [
		{
			runtimeId: 'GRAIN',
			identity: {
				languageId: 'GRAIN',
				implementationId: 'grainc',
				implementationVersion: profile.grainVersion,
				profile: {
					profileId: profile.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: profile.compilerJavaScript.sha256,
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
			requiredBrowserFeatures: ['wasm'],
			assetRoot: '.',
			assets: [
				{
					key: 'compilerBytes',
					path: 'grainc.js.gz.bin',
					mediaType: 'text/javascript',
					compressedSha256: profile.compilerStorage.sha256,
					compressedBytes: profile.compilerStorage.bytes,
					uncompressedSha256: profile.compilerJavaScript.sha256,
					uncompressedBytes: profile.compilerJavaScript.bytes,
					encoding: 'gzip'
				},
				{
					key: 'stdlibBytes',
					path: 'stdlib.pack.gz.bin',
					mediaType: 'application/octet-stream',
					compressedSha256: profile.stdlibStorage.sha256,
					compressedBytes: profile.stdlibStorage.bytes,
					uncompressedSha256: profile.stdlibPack.sha256,
					uncompressedBytes: profile.stdlibPack.bytes,
					encoding: 'gzip'
				}
			],
			contracts: {
				routeId: 'grain',
				runtimeAssetKey: 'grain',
				documentationId: 'GRAIN',
				syncTarget: 'sync:wasm-grain',
				browserTestId: 'browser:grain'
			}
		}
	]
};

/** Upstream Grain compiler (js_of_ocaml build) plus a WASI host for the program it emits. */
class Grain extends StaticWorkerRuntimeSandbox {
	readonly memoryEvidence: { current: unknown };

	constructor() {
		const memoryEvidence = { current: undefined as unknown };
		super({
			displayName: 'Grain',
			languageId: 'GRAIN',
			defaultActivePath: 'main.gr',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\bFile\.(?:fdRead|stdin)\b|"wasi\/file"/u
			},
			inlineVerifiedWorker: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			onEvidence(evidence) {
				memoryEvidence.current = evidence;
			},
			resolveRuntimeAssets(runtimeAssets, currentUrl) {
				const baseUrl = resolveGrainBaseUrl(runtimeAssets, currentUrl);
				return {
					baseUrl,
					workerUrl: new URL('runner-worker.js', baseUrl).href,
					manifestUrl: new URL('runtime-build.json', baseUrl).href,
					manifestFingerprint: profile.compilerJavaScript.sha256,
					preflightKey: profile.stdlibPack.sha256,
					workerReceipt: bundledGrainWorkerReceipt
				};
			},
			async preflightRuntimeAssets(urls, context) {
				memoryEvidence.current = undefined;
				const result = await preflightRuntimeAssets({
					manifest: registry,
					runtimeId: 'GRAIN',
					rootUrl: urls.baseUrl,
					limits: context.limits,
					persistentCache: context.persistentCache,
					signal: context.signal,
					redirect: 'error',
					requireExactResponseUrl: true,
					maxTotalDeliveryBytes:
						profile.compilerStorage.bytes + profile.stdlibStorage.bytes,
					reportProgress(progress) {
						context.reportProgress(0.1, `Preflighting Grain ${progress.assetKey}`);
					}
				});
				return context.createOwnedDelivery(
					Object.freeze({
						protocol: 'wasm-idle-grain-preflight',
						profileId: profile.profileId,
						compilerBytes: result.assets.compilerBytes.bytes,
						stdlibBytes: result.assets.stdlibBytes.bytes
					})
				);
			}
		});
		this.memoryEvidence = memoryEvidence;
	}
}

export default Grain;
