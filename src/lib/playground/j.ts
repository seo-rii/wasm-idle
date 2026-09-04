import {
	resolveJRuntimeAssetConfig,
	type JRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { JRuntimePreflightPayload } from '$lib/playground/jPreflight';
import { preflightStaticRuntimeAssetsInWorker } from '$lib/playground/staticRuntimePreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class J extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'J',
			displayName: 'J',
			defaultActivePath: 'main.ijs',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			runtimePreflightDelivery: 'transfer-owned',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /1!:\s*1|\/dev\/stdin|\bstdin\b/iu
			},
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = resolved.preflightProfile;
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'J runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'J' }
					);
				}
				return resolved;
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as JRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes =
					(profile.manifestReceipt?.bytes ?? 0) +
					(profile.moduleReceipt?.bytes ?? 0) +
					(profile.wasmReceipt?.bytes ?? 0);
				const payload =
					await preflightStaticRuntimeAssetsInWorker<JRuntimePreflightPayload>({
						runtimeId: 'J',
						displayName: 'J',
						baseUrl: urls.baseUrl,
						manifestUrl: urls.manifestUrl || '',
						profile,
						limits: context.limits,
						signal: context.signal,
						reportProgress(progress) {
							if (progress.kind === 'asset') {
								loadedByAsset.set(
									progress.progress.assetKey,
									progress.progress.loadedBytes
								);
								const loadedBytes = [...loadedByAsset.values()].reduce(
									(total, loaded) => total + loaded,
									0
								);
								const fraction =
									totalDownloadBytes > 0 ? loadedBytes / totalDownloadBytes : 0;
								context.reportProgress(
									0.04 + Math.min(1, fraction) * 0.11,
									`Preflighting J asset ${progress.progress.assetKey}`
								);
								return;
							}
							const { loadedBytes, totalBytes } = progress;
							const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
							context.reportProgress(
								0.15 + Math.min(1, fraction) * 0.02,
								'Decompressing verified J Wasm'
							);
						}
					});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default J;
