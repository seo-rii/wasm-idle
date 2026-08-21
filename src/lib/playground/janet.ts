import {
	resolveJanetRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightJanetRuntimeAssets,
	snapshotJanetRuntimePreflightProfile,
	type JanetRuntimePreflightProfile
} from '@wasm-idle/core';

class Janet extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Janet',
			languageId: 'JANET',
			defaultActivePath: 'main.janet',
			moduleWorker: true,
			workerLifetime: { mode: 'per-run' },
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:getline|stdin|file\/read)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJanetRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotJanetRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Janet runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'JANET' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as JanetRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes =
					(profile.manifestReceipt.bytes ?? 0) +
					(profile.javascriptReceipt.bytes ?? 0) +
					(profile.wasmReceipt.bytes ?? 0);
				const totalDecompressedBytes = profile.wasmReceipt.uncompressedBytes ?? 0;
				return await preflightJanetRuntimeAssets({
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
							0.04 + Math.min(1, fraction) * 0.1,
							`Preflighting Janet asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(_asset, loadedBytes) {
						const fraction =
							totalDecompressedBytes > 0 ? loadedBytes / totalDecompressedBytes : 0;
						context.reportProgress(
							0.14 + Math.min(1, fraction) * 0.03,
							'Decompressing verified Janet wasm'
						);
					}
				});
			}
		});
	}
}

export default Janet;
