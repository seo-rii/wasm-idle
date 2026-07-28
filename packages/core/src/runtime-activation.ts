import { verifyRuntimeAssetPair, type VerifiedRuntimeAssetPair } from './asset-integrity.js';
import { RuntimeConfigurationError } from './errors.js';
import { defineRuntimeRegistryManifest, type RuntimeRegistryManifest } from './runtime-manifest.js';

export interface RuntimeProfileAssetCandidate {
	readonly cacheKey: string;
	readonly compressed: Uint8Array;
	readonly uncompressed: Uint8Array;
	readonly mimeType?: string;
}

export interface RuntimeProfileActivationRequest {
	readonly manifest: RuntimeRegistryManifest;
	readonly runtimeId: string;
	readonly assets: Readonly<Record<string, RuntimeProfileAssetCandidate>>;
}

export interface ActivatedRuntimeAsset {
	readonly cacheKey: string;
	readonly integrity: VerifiedRuntimeAssetPair;
}

export interface RuntimeProfileActivationSnapshot {
	readonly runtimeId: string;
	readonly profileId: string;
	readonly manifestId: string;
	readonly manifestRevision: string;
	readonly manifestSchemaVersion: number;
	readonly manifestSha256: string;
	readonly assets: Readonly<Record<string, ActivatedRuntimeAsset>>;
}

export class RuntimeProfileActivationStore {
	private readonly active = new Map<string, RuntimeProfileActivationSnapshot>();
	private readonly history = new Map<string, RuntimeProfileActivationSnapshot[]>();
	private readonly activationVersions = new Map<string, number>();

	get(runtimeId: string): RuntimeProfileActivationSnapshot | undefined {
		return this.active.get(runtimeId);
	}

	async activate(
		request: RuntimeProfileActivationRequest
	): Promise<RuntimeProfileActivationSnapshot> {
		const manifest = defineRuntimeRegistryManifest(request.manifest);
		const runtime = manifest.runtimes.find(
			(candidate) => candidate.runtimeId === request.runtimeId
		);
		if (!runtime) {
			throw new RuntimeConfigurationError(
				`Runtime registry manifest does not declare ${request.runtimeId}`,
				{ runtimeId: request.runtimeId }
			);
		}

		const expectedAssetKeys = runtime.assets.map((asset) => asset.key).sort();
		const receivedAssetKeys = Object.keys(request.assets).sort();
		const missingAssets = expectedAssetKeys.filter(
			(asset) => !receivedAssetKeys.includes(asset)
		);
		if (missingAssets.length > 0) {
			throw new RuntimeConfigurationError(
				`Runtime profile ${runtime.identity.profile.profileId} is missing assets: ${missingAssets.join(', ')}`,
				{
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId
				}
			);
		}
		const unexpectedAssets = receivedAssetKeys.filter(
			(asset) => !expectedAssetKeys.includes(asset)
		);
		if (unexpectedAssets.length > 0) {
			throw new RuntimeConfigurationError(
				`Runtime profile ${runtime.identity.profile.profileId} has unexpected assets: ${unexpectedAssets.join(', ')}`,
				{
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId
				}
			);
		}
		const activationVersion = (this.activationVersions.get(runtime.runtimeId) ?? 0) + 1;
		this.activationVersions.set(runtime.runtimeId, activationVersion);

		const verifiedAssets = await Promise.all(
			runtime.assets.map(async (asset) => {
				const candidate = request.assets[asset.key]!;
				if (!candidate.cacheKey || candidate.cacheKey.includes('\0')) {
					throw new RuntimeConfigurationError(
						`Runtime asset ${asset.key} requires a stable cache key`,
						{
							runtimeId: runtime.runtimeId,
							profileId: runtime.identity.profile.profileId
						}
					);
				}
				const integrity = await verifyRuntimeAssetPair({
					asset: asset.path,
					compressed: candidate.compressed,
					uncompressed: candidate.uncompressed,
					expected: {
						sha256: asset.compressedSha256,
						bytes: asset.compressedBytes,
						mediaType: asset.mediaType,
						uncompressedSha256: asset.uncompressedSha256,
						uncompressedBytes: asset.uncompressedBytes
					},
					mimeType: candidate.mimeType,
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId
				});
				return [
					asset.key,
					Object.freeze({ cacheKey: candidate.cacheKey, integrity })
				] as const;
			})
		);
		if (this.activationVersions.get(runtime.runtimeId) !== activationVersion) {
			throw new RuntimeConfigurationError(
				`Runtime profile ${runtime.identity.profile.profileId} activation was superseded by a newer request`,
				{
					runtimeId: runtime.runtimeId,
					profileId: runtime.identity.profile.profileId
				}
			);
		}

		const snapshot = Object.freeze({
			runtimeId: runtime.runtimeId,
			profileId: runtime.identity.profile.profileId,
			manifestId: manifest.manifestId,
			manifestRevision: manifest.revision,
			manifestSchemaVersion: runtime.identity.profile.manifestSchemaVersion,
			manifestSha256: runtime.identity.profile.manifestSha256,
			assets: Object.freeze(Object.fromEntries(verifiedAssets))
		});
		const current = this.active.get(runtime.runtimeId);
		if (current) {
			const history = this.history.get(runtime.runtimeId) ?? [];
			this.history.set(runtime.runtimeId, [...history, current]);
		}
		this.active.set(runtime.runtimeId, snapshot);
		return snapshot;
	}

	rollback(runtimeId: string): RuntimeProfileActivationSnapshot | undefined {
		this.activationVersions.set(runtimeId, (this.activationVersions.get(runtimeId) ?? 0) + 1);
		const history = this.history.get(runtimeId);
		const previous = history?.at(-1);
		if (!previous) return undefined;
		if (history!.length === 1) this.history.delete(runtimeId);
		else this.history.set(runtimeId, history!.slice(0, -1));
		this.active.set(runtimeId, previous);
		return previous;
	}
}
