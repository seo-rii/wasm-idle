import {
	RuntimeConfigurationError,
	preflightRuntimeAssets,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import { COQ_PROFILE, COQ_WORKER_RECEIPT, COQ_MANIFEST_RECEIPT } from './wasmCoqVersion';

const assets = Object.entries(COQ_PROFILE.assets).map(([name, receipt]) => ({
	key: name,
	path: name,
	mediaType: name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
	compressedBytes: receipt.bytes,
	uncompressedBytes: receipt.bytes,
	compressedSha256: receipt.sha256,
	uncompressedSha256: receipt.sha256,
	encoding: 'identity' as const
}));
export const COQ_RUNTIME_MANIFEST: RuntimeRegistryManifest = {
	schemaVersion: 2,
	manifestId: 'wasm-idle/coq-preflight',
	revision: COQ_MANIFEST_RECEIPT.sha256,
	runtimes: [
		{
			runtimeId: 'COQ',
			identity: {
				languageId: 'COQ',
				implementationId: 'coq-jscoq',
				implementationVersion: '8.17.1',
				profile: {
					profileId: COQ_PROFILE.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: COQ_MANIFEST_RECEIPT.sha256,
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
			requiredBrowserFeatures: ['shared-array-buffer', 'atomics-wait'],
			assetRoot: '.',
			assets: [
				...assets,
				{
					key: 'manifestBytes',
					path: 'runtime-build.json',
					mediaType: 'application/json',
					compressedBytes: COQ_MANIFEST_RECEIPT.bytes,
					uncompressedBytes: COQ_MANIFEST_RECEIPT.bytes,
					compressedSha256: COQ_MANIFEST_RECEIPT.sha256,
					uncompressedSha256: COQ_MANIFEST_RECEIPT.sha256,
					encoding: 'identity'
				}
			],
			contracts: {
				routeId: 'coq',
				runtimeAssetKey: 'coq',
				documentationId: 'COQ',
				syncTarget: 'sync:wasm-coq',
				browserTestId: 'browser:coq'
			}
		}
	]
};

export function resolveCoqRuntimeAssets(
	runtimeAssets: string | PlaygroundRuntimeAssets,
	currentUrl: string
) {
	const root = typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets.rootUrl || '';
	const base = new URL(root.replace(/\/$/u, '') + '/wasm-coq/', currentUrl);
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new RuntimeConfigurationError(
			'Coq requires a credential-free HTTP(S) asset directory',
			{ runtimeId: 'COQ' }
		);
	return {
		baseUrl: base.href,
		workerUrl: new URL('runner-worker.js', base).href,
		manifestUrl: new URL('runtime-build.json', base).href,
		manifestFingerprint: COQ_MANIFEST_RECEIPT.sha256,
		workerReceipt: COQ_WORKER_RECEIPT
	};
}

/** Real Coq source followed by a command stream; the original kernel parses both files. */
export default class Coq extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'COQ',
			displayName: 'Coq',
			defaultActivePath: 'main.v',
			stdin: { mode: 'streaming', sourceHintPattern: /[\s\S]/u },
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			moduleWorker: false,
			requireExactWorkerResponseUrl: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			resolveRuntimeAssets: resolveCoqRuntimeAssets,
			async preflightRuntimeAssets(urls, context) {
				const result = await preflightRuntimeAssets({
					manifest: COQ_RUNTIME_MANIFEST,
					runtimeId: 'COQ',
					rootUrl: urls.baseUrl,
					limits: context.limits,
					persistentCache: context.persistentCache,
					signal: context.signal,
					redirect: 'error',
					requireExactResponseUrl: true,
					maxTotalDeliveryBytes: assets.reduce<number>(
						(sum, asset) => sum + asset.compressedBytes,
						COQ_MANIFEST_RECEIPT.bytes
					),
					reportProgress(progress) {
						context.reportProgress(0.1, `Preflighting Coq ${progress.assetKey}`);
					}
				});
				return context.createOwnedDelivery(
					Object.freeze({
						profileId: COQ_PROFILE.profileId,
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
			const resolved = resolveSandboxExecutionArgs('COQ', args, options);
			if (resolved.compileArgs.length || resolved.programArgs.length)
				throw new RuntimeConfigurationError(
					'Coq command streams do not accept program or compiler arguments',
					{ runtimeId: 'COQ' }
				);
			return super.run(code, prepare, log, progress, [], options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
