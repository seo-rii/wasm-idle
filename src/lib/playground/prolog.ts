import {
	resolvePrologRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { preflightStaticRuntimeAssetsInWorker } from '$lib/playground/staticRuntimePreflight';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	snapshotPrologRuntimePreflightProfile,
	type PrologRuntimePreflightPayload,
	type PrologRuntimePreflightProfile
} from '@wasm-idle/core';

export const PROLOG_WORKER_IDLE_TIMEOUT_MS = 60_000;

class Prolog extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PROLOG',
			displayName: 'Prolog',
			defaultActivePath: 'main.prolog',
			stdin: {
				mode: 'streaming',
				sourceHintPattern:
					/\b(read_line_to_string|read_line_to_codes|get_char|get_code|read\s*\(|read_string)\b/
			},
			workerLifetime: {
				mode: 'persistent',
				idleTimeoutMs: PROLOG_WORKER_IDLE_TIMEOUT_MS,
				evictOnMemoryPressure: true
			},
			inlineVerifiedWorker: true,
			runtimePreflightDelivery: 'transfer-owned-worker-cache',
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolvePrologRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotPrologRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Prolog runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'PROLOG' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as PrologRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const decompressedByAsset = new Map<'wasm' | 'data', number>();
				const totalDownloadBytes =
					(profile.manifestReceipt.bytes ?? 0) +
					(profile.javascriptReceipt.bytes ?? 0) +
					(profile.wasmReceipt.bytes ?? 0) +
					(profile.dataReceipt.bytes ?? 0);
				const totalDecompressedBytes =
					(profile.wasmReceipt.uncompressedBytes ?? 0) +
					(profile.dataReceipt.uncompressedBytes ?? 0);
				const payload =
					await preflightStaticRuntimeAssetsInWorker<PrologRuntimePreflightPayload>({
						runtimeId: 'PROLOG',
						displayName: 'Prolog',
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
									0.04 + Math.min(1, fraction) * 0.1,
									`Preflighting Prolog asset ${progress.progress.assetKey}`
								);
								return;
							}
							const { asset, loadedBytes } = progress;
							if (!asset) return;
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
								`Decompressing verified Prolog ${asset}`
							);
						}
					});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default Prolog;
