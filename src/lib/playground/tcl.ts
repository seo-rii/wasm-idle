import { resolveTclRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightTclRuntimeAssets,
	snapshotTclRuntimePreflightProfile,
	type TclRuntimePreflightProfile
} from '@wasm-idle/core';

class Tcl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'TCL',
			displayName: 'Tcl',
			defaultActivePath: 'main.tcl',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(gets|read)\s+(stdin|file\d*)\b|\bstdin\b/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveTclRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotTclRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Tcl runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'TCL' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as TclRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const decompressedByAsset = new Map<'libraryData' | 'wasm', number>();
				const totalDownloadBytes =
					(profile.manifestReceipt.bytes ?? 0) +
					(profile.requireJsReceipt.bytes ?? 0) +
					(profile.customDataReceipt.bytes ?? 0) +
					(profile.libraryDataReceipt.bytes ?? 0) +
					(profile.glueReceipt.bytes ?? 0) +
					(profile.wasmReceipt.bytes ?? 0);
				const totalDecompressedBytes =
					(profile.libraryDataReceipt.uncompressedBytes ?? 0) +
					(profile.wasmReceipt.uncompressedBytes ?? 0);
				return await preflightTclRuntimeAssets({
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
							`Preflighting Tcl asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(asset, loadedBytes) {
						decompressedByAsset.set(asset, loadedBytes);
						const decompressedBytes = [...decompressedByAsset.values()].reduce(
							(total, loaded) => total + loaded,
							0
						);
						const fraction =
							totalDecompressedBytes > 0
								? decompressedBytes / totalDecompressedBytes
								: 0;
						context.reportProgress(
							0.14 + Math.min(1, fraction) * 0.03,
							`Decompressing verified Tcl ${asset}`
						);
					}
				});
			}
		});
	}
}

export default Tcl;
