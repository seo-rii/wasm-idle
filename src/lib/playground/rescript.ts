import {
	resolveReScriptRuntimeAssetConfig,
	type ReScriptRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { ReScriptRuntimePreflightPayload } from '$lib/playground/rescriptPreflight';
import { preflightStaticRuntimeAssetsInWorker } from '$lib/playground/staticRuntimePreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class ReScript extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'RESCRIPT',
			displayName: 'ReScript',
			defaultActivePath: 'Main.res',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:readLineSync|readFileSync)\b|\/dev\/stdin\b/
			},
			inlineVerifiedWorker: true,
			runtimePreflightDelivery: 'transfer-owned',
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveReScriptRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = resolved.preflightProfile;
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'ReScript runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'RESCRIPT' }
					);
				}
				return resolved;
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as ReScriptRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes =
					(profile.manifestReceipt?.bytes ?? 0) + (profile.compilerReceipt?.bytes ?? 0);
				const payload =
					await preflightStaticRuntimeAssetsInWorker<ReScriptRuntimePreflightPayload>({
						runtimeId: 'RESCRIPT',
						displayName: 'ReScript',
						baseUrl: urls.baseUrl,
						manifestUrl: urls.manifestUrl || '',
						profile,
						limits: context.limits,
						persistentCache: context.persistentCache,
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
									`Preflighting ReScript asset ${progress.progress.assetKey}`
								);
								return;
							}
							const { loadedBytes, totalBytes } = progress;
							const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
							context.reportProgress(
								0.15 + Math.min(1, fraction) * 0.02,
								'Decompressing verified ReScript compiler'
							);
						}
					});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default ReScript;
