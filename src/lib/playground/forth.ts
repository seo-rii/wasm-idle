import {
	resolveForthRuntimeAssetConfig,
	type ForthRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { preflightForthRuntimeAssets } from '$lib/playground/forthPreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Forth extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'FORTH',
			displayName: 'Forth',
			defaultActivePath: 'main.fth',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:KEY|ACCEPT|REFILL)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveForthRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = resolved.preflightProfile;
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Forth runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'FORTH' }
					);
				}
				return resolved;
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as ForthRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalBytes =
					(profile.manifestReceipt?.bytes ?? 0) + (profile.runtimeReceipt?.bytes ?? 0);
				return await preflightForthRuntimeAssets({
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
						const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
						context.reportProgress(
							0.04 + Math.min(1, fraction) * 0.13,
							`Preflighting Forth asset ${progress.assetKey}`
						);
					}
				});
			}
		});
	}
}

export default Forth;
