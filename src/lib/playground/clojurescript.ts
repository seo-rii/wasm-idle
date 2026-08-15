import {
	resolveClojureScriptRuntimeAssetConfig,
	type ClojureScriptRuntimePreflightProfile,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { preflightClojureScriptRuntimeAssets } from '$lib/playground/clojurescriptPreflight';
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
				return await preflightClojureScriptRuntimeAssets({
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
							`Preflighting ClojureScript asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(loadedBytes, totalBytes) {
						const fraction = totalBytes > 0 ? loadedBytes / totalBytes : 0;
						context.reportProgress(
							0.15 + Math.min(1, fraction) * 0.02,
							'Decompressing verified ClojureScript compiler'
						);
					}
				});
			}
		});
	}
}

export default ClojureScript;
