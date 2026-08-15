import {
	resolveBqnRuntimeAssetConfig,
	type BqnRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { preflightBqnRuntimeAssets } from '$lib/playground/bqnPreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Bqn extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'BQN',
			displayName: 'BQN',
			defaultActivePath: 'main.bqn',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			stdin: { mode: 'streaming', sourceHintPattern: /•GetLine|stdin/iu },
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveBqnRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = resolved.preflightProfile;
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'BQN runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'BQN' }
					);
				}
				return resolved;
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as BqnRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes =
					(profile.manifestReceipt?.bytes ?? 0) +
					(profile.moduleReceipt?.bytes ?? 0) +
					(profile.wasmReceipt?.bytes ?? 0);
				return await preflightBqnRuntimeAssets({
					baseUrl: urls.baseUrl,
					manifestUrl: urls.manifestUrl || '',
					profile,
					limits: context.limits,
					signal: context.signal,
					reportProgress(progress) {
						loadedByAsset.set(progress.assetKey, progress.loadedBytes);
						const loadedBytes = [...loadedByAsset.values()].reduce(
							(total, loaded) => total + loaded,
							0
						);
						const fraction =
							totalDownloadBytes > 0 ? loadedBytes / totalDownloadBytes : 0;
						context.reportProgress(
							0.04 + Math.min(1, fraction) * 0.11,
							`Preflighting BQN asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(loadedBytes, totalBytes) {
						const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
						context.reportProgress(
							0.15 + Math.min(1, fraction) * 0.02,
							'Decompressing verified BQN Wasm'
						);
					}
				});
			}
		});
	}
}

export default Bqn;
