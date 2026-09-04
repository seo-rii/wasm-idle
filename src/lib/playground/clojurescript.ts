import {
	resolveClojureScriptRuntimeAssetConfig,
	type ClojureScriptRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { ClojureScriptRuntimePreflightPayload } from '$lib/playground/clojurescriptPreflight';
import { preflightStaticRuntimeAssetsInWorker } from '$lib/playground/staticRuntimePreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class ClojureScript extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'CLOJURESCRIPT',
			displayName: 'ClojureScript',
			defaultActivePath: 'main.cljs',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:wasm-idle\.runtime\/)?(?:read-line|stdin)\b|\bread-line\b/
			},
			inlineVerifiedWorker: true,
			runtimePreflightDelivery: 'transfer-owned',
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveClojureScriptRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = resolved.preflightProfile;
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'ClojureScript runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'CLOJURESCRIPT' }
					);
				}
				return resolved;
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as ClojureScriptRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes =
					(profile.manifestReceipt?.bytes ?? 0) + (profile.compilerReceipt?.bytes ?? 0);
				const payload =
					await preflightStaticRuntimeAssetsInWorker<ClojureScriptRuntimePreflightPayload>(
						{
							runtimeId: 'CLOJURESCRIPT',
							displayName: 'ClojureScript',
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
										totalDownloadBytes > 0
											? loadedBytes / totalDownloadBytes
											: 0;
									context.reportProgress(
										0.04 + Math.min(1, fraction) * 0.11,
										`Preflighting ClojureScript asset ${progress.progress.assetKey}`
									);
									return;
								}
								const { loadedBytes, totalBytes } = progress;
								const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
								context.reportProgress(
									0.15 + Math.min(1, fraction) * 0.02,
									'Decompressing verified ClojureScript compiler'
								);
							}
						}
					);
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default ClojureScript;
