import {
	resolvePascalRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightPascalRuntimeAssets,
	snapshotPascalRuntimePreflightProfile,
	type PascalRuntimePreflightProfile
} from '@wasm-idle/core';

class Pascal extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PASCAL',
			displayName: 'Pascal',
			defaultActivePath: 'main.pas',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			stdin: { mode: 'streaming', sourceHintPattern: /\bReadLn\s*\(/i },
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolvePascalRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotPascalRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Pascal runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'PASCAL' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const resolved = urls as ReturnType<typeof resolvePascalRuntimeAssetConfig>;
				const profile = resolved.preflightProfile as PascalRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes = [
					profile.manifestReceipt.bytes,
					profile.compilerJavaScriptReceipt.bytes,
					profile.rtlJavaScriptReceipt.bytes,
					profile.systemPascalReceipt.bytes
				].reduce<number>((total, bytes) => total + (bytes ?? 0), 0);
				const totalDecompressedBytes =
					profile.compilerJavaScriptReceipt.uncompressedBytes ?? 0;
				const payload = await preflightPascalRuntimeAssets({
					baseUrl: resolved.baseUrl,
					manifestUrl: resolved.manifestUrl,
					compilerJavaScriptUrl: resolved.compilerJavaScriptUrl,
					rtlJavaScriptUrl: resolved.rtlJavaScriptUrl,
					systemPascalUrl: resolved.systemPascalUrl,
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
							`Preflighting Pascal asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(loadedBytes) {
						const fraction =
							totalDecompressedBytes > 0 ? loadedBytes / totalDecompressedBytes : 0;
						context.reportProgress(
							0.14 + Math.min(1, fraction) * 0.03,
							'Decompressing verified Pascal compiler'
						);
					}
				});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default Pascal;
