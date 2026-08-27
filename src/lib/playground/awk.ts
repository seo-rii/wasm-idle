import { resolveAwkRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightAwkRuntimeAssets,
	snapshotAwkRuntimePreflightProfile,
	type AwkRuntimePreflightProfile
} from '@wasm-idle/core';

class Awk extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'AWK',
			displayName: 'AWK',
			defaultActivePath: 'main.awk',
			stdin: {
				mode: 'streaming',
				sourceHintPattern:
					/\bgetline\b|\$[0-9]|\b(NR|FNR|NF)\b|(^|\n)\s*(?:\/|[!$({]|[A-Za-z_]\w*\s*(?:\(|==|!=|~|!~|<|>|<=|>=))/
			},
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveAwkRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotAwkRuntimePreflightProfile(resolved.preflightProfile);
				if (
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					profile.workerReceipt.bytes !== resolved.workerReceipt.bytes ||
					profile.workerReceipt.sha256 !== resolved.workerReceipt.sha256
				) {
					throw new RuntimeConfigurationError(
						'AWK runtime requires one coherent preflight profile and runner receipt.',
						{ runtimeId: 'AWK' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const resolved = urls as ReturnType<typeof resolveAwkRuntimeAssetConfig>;
				const profile = resolved.preflightProfile as AwkRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const totalDownloadBytes = [
					profile.manifestReceipt.bytes,
					profile.goShimReceipt.bytes,
					profile.wasmReceipt.bytes
				].reduce<number>((total, bytes) => total + (bytes ?? 0), 0);
				const totalDecompressedBytes = profile.wasmReceipt.uncompressedBytes ?? 0;
				const payload = await preflightAwkRuntimeAssets({
					baseUrl: resolved.baseUrl,
					manifestUrl: resolved.manifestUrl,
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
							`Preflighting AWK asset ${progress.assetKey}`
						);
					},
					reportDecompressionProgress(loadedBytes) {
						const fraction =
							totalDecompressedBytes > 0 ? loadedBytes / totalDecompressedBytes : 0;
						context.reportProgress(
							0.14 + Math.min(1, fraction) * 0.03,
							'Decompressing verified AWK runtime'
						);
					}
				});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default Awk;
