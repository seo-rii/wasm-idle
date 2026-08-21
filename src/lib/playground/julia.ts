import {
	resolveJuliaRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import {
	RuntimeConfigurationError,
	preflightJuliaRuntimeAssets,
	requireJuliaRuntimePreflightPayload,
	snapshotJuliaRuntimePreflightProfile,
	type JuliaRuntimePreflightProfile
} from '@wasm-idle/core';

class Julia extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Julia',
			languageId: 'JULIA',
			defaultActivePath: 'main.jl',
			workerLifetime: { mode: 'per-run' },
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:readline|readlines|read|eachline|stdin)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJuliaRuntimeAssetConfig(runtimeAssets, currentUrl);
				const profile = snapshotJuliaRuntimePreflightProfile(resolved.preflightProfile);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					profile.manifestFingerprint !== resolved.manifestFingerprint ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Julia runtime requires one coherent preflight profile, manifest fingerprint, and worker receipt.',
						{ runtimeId: 'JULIA' }
					);
				}
				return { ...resolved, preflightProfile: profile };
			},
			async preflightRuntimeAssets(urls, context) {
				const profile = urls.preflightProfile as JuliaRuntimePreflightProfile;
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
				return await preflightJuliaRuntimeAssets({
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
							`Preflighting Julia asset ${progress.assetKey}`
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
							`Decompressing verified Julia ${asset}`
						);
					}
				});
			},
			consumeRuntimePreflightTransferables(runtimePreflight) {
				const payload = requireJuliaRuntimePreflightPayload(runtimePreflight);
				const buffers = [
					payload.manifestBytes,
					payload.javascriptBytes,
					payload.wasmBytes,
					payload.dataBytes
				].map((bytes) => {
					if (
						!(bytes.buffer instanceof ArrayBuffer) ||
						bytes.byteOffset !== 0 ||
						bytes.byteLength !== bytes.buffer.byteLength
					) {
						throw new RuntimeConfigurationError(
							'Julia runtime preflight transfer requires owned whole ArrayBuffers.',
							{ phase: 'protocol', runtimeId: 'JULIA' }
						);
					}
					return bytes.buffer;
				});
				if (new Set(buffers).size !== buffers.length) {
					throw new RuntimeConfigurationError(
						'Julia runtime preflight transfer buffers must be unique.',
						{ phase: 'protocol', runtimeId: 'JULIA' }
					);
				}
				return buffers;
			}
		});
	}
}

export default Julia;
