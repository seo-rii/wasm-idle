import { resolveNimRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightNimRuntimeAssets,
	snapshotNimRuntimePreflightProfile,
	type NimRuntimePreflightProfile
} from '@wasm-idle/core';

class Nim extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Nim',
			languageId: 'NIM',
			defaultActivePath: 'main.nim',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:stdin|readLine|readAll|lines)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveNimRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotNimRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Nim runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'NIM' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as NimRuntimePreflightProfile;
				const loadedByAsset = new Map<string, number>();
				const decompressedByAsset = new Map<string, number>();
				const totalDownloadBytes = [
					profile.manifestReceipt.bytes,
					profile.nimJavaScriptReceipt.bytes,
					profile.nimWasmReceipt.bytes,
					profile.nimbaseReceipt.bytes,
					profile.clangJavaScriptReceipt.bytes,
					profile.clangWasmReceipt.bytes,
					profile.lldWasmReceipt.bytes,
					profile.memfsWasmReceipt.bytes,
					profile.sysrootReceipt.bytes
				].reduce((total, bytes) => total + (bytes ?? 0), 0);
				const totalDecompressedBytes = [
					profile.nimJavaScriptReceipt.uncompressedBytes,
					profile.nimWasmReceipt.uncompressedBytes,
					profile.clangWasmReceipt.uncompressedBytes,
					profile.lldWasmReceipt.uncompressedBytes,
					profile.memfsWasmReceipt.uncompressedBytes,
					profile.sysrootReceipt.uncompressedBytes
				].reduce((total, bytes) => total + (bytes ?? 0), 0);
				const payload = await preflightNimRuntimeAssets({
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
							`Preflighting Nim asset ${progress.assetKey}`
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
							`Decompressing verified Nim ${asset}`
						);
					}
				});
				return context.createOwnedDelivery(payload);
			}
		});
	}
}

export default Nim;
