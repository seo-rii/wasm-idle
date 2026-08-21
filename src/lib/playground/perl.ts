import {
	resolvePerlRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightPerlRuntimeAssets,
	snapshotPerlRuntimePreflightProfile,
	type PerlRuntimePreflightProfile
} from '@wasm-idle/core';

class Perl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PERL',
			displayName: 'Perl',
			defaultActivePath: 'main.pl',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /<\s*STDIN\s*>|\bSTDIN\b|\breadline\b|<\s*>/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolvePerlRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotPerlRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'WebPerl runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'PERL' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as PerlRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const decompressedByAsset = new Map<'javascript' | 'wasm' | 'data', number>();
				const totalDownloadBytes =
					(profile.manifestReceipt.bytes ?? 0) +
					(profile.javascriptReceipt.bytes ?? 0) +
					(profile.wasmReceipt.bytes ?? 0) +
					(profile.dataReceipt.bytes ?? 0);
				const totalDecompressedBytes =
					(profile.javascriptReceipt.uncompressedBytes ?? 0) +
					(profile.wasmReceipt.uncompressedBytes ?? 0) +
					(profile.dataReceipt.uncompressedBytes ?? 0);
				return await preflightPerlRuntimeAssets({
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
							`Preflighting WebPerl asset ${progress.assetKey}`
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
							`Decompressing verified WebPerl ${asset}`
						);
					}
				});
			}
		});
	}
}

export default Perl;
