import {
	RuntimeConfigurationError,
	preflightRuntimeAssets,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import {
	VERILOG_PROFILE,
	VERILOG_WORKER_RECEIPT,
	VERILOG_MANIFEST_RECEIPT
} from './wasmVerilogVersion';

const assets = Object.entries(VERILOG_PROFILE.assets).map(([name, receipt]) => ({
	key: name.replace('.js', 'JavaScript').replace('.wasm', 'Wasm'),
	path: name,
	mediaType: name.endsWith('.js') ? 'text/javascript' : 'application/wasm',
	compressedBytes: receipt.bytes,
	uncompressedBytes: receipt.bytes,
	compressedSha256: receipt.sha256,
	uncompressedSha256: receipt.sha256,
	encoding: 'identity' as const
}));
const registry: RuntimeRegistryManifest = {
	schemaVersion: 2,
	manifestId: 'wasm-idle/verilog-preflight',
	revision: VERILOG_MANIFEST_RECEIPT.sha256,
	runtimes: [
		{
			runtimeId: 'VERILOG',
			identity: {
				languageId: 'VERILOG',
				implementationId: 'iverilog',
				implementationVersion: '14.0-devel',
				profile: {
					profileId: VERILOG_PROFILE.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: VERILOG_MANIFEST_RECEIPT.sha256,
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
				...assets,
				{
					key: 'manifestBytes',
					path: 'runtime-build.json',
					mediaType: 'application/json',
					compressedBytes: VERILOG_MANIFEST_RECEIPT.bytes,
					uncompressedBytes: VERILOG_MANIFEST_RECEIPT.bytes,
					compressedSha256: VERILOG_MANIFEST_RECEIPT.sha256,
					uncompressedSha256: VERILOG_MANIFEST_RECEIPT.sha256,
					encoding: 'identity'
				}
			],
			contracts: {
				routeId: 'verilog',
				runtimeAssetKey: 'verilog',
				documentationId: 'VERILOG',
				syncTarget: 'sync:wasm-verilog',
				browserTestId: 'browser:verilog'
			}
		}
	]
};

/** Genuine Icarus preprocessing, compilation and simulation in a disposable Worker. */
export default class Verilog extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'VERILOG',
			displayName: 'Icarus Verilog',
			defaultActivePath: 'main.v',
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
				const baseUrl = new URL(root.replace(/\/$/u, '') + '/wasm-verilog/', currentUrl)
					.href;
				return {
					baseUrl,
					workerUrl: new URL('runner-worker.js', baseUrl).href,
					manifestUrl: new URL('runtime-build.json', baseUrl).href,
					manifestFingerprint: VERILOG_MANIFEST_RECEIPT.sha256,
					workerReceipt: VERILOG_WORKER_RECEIPT
				};
			},
			async preflightRuntimeAssets(urls, context) {
				const result = await preflightRuntimeAssets({
					manifest: registry,
					runtimeId: 'VERILOG',
					rootUrl: urls.baseUrl,
					limits: context.limits,
					persistentCache: context.persistentCache,
					signal: context.signal,
					redirect: 'error',
					requireExactResponseUrl: true,
					maxTotalDeliveryBytes: assets.reduce<number>(
						(sum, asset) => sum + asset.compressedBytes,
						VERILOG_MANIFEST_RECEIPT.bytes
					),
					reportProgress(progress) {
						context.reportProgress(0.1, `Preflighting Verilog ${progress.assetKey}`);
					}
				});
				return context.createOwnedDelivery(
					Object.freeze({
						protocol: 'wasm-idle-verilog-preflight',
						profileId: VERILOG_PROFILE.profileId,
						...Object.fromEntries(
							assets.map((asset) => [asset.key, result.assets[asset.key].bytes])
						)
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
			const resolved = resolveSandboxExecutionArgs('VERILOG', args, options);
			if (resolved.compileArgs.length)
				throw new RuntimeConfigurationError(
					'Verilog compiler arguments are fixed by this runtime profile',
					{ runtimeId: 'VERILOG' }
				);
			return super.run(code, prepare, log, progress, resolved.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
