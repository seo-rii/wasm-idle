import { isSupportedLanguageId, languageAliases } from './languages.js';
import type { CanonicalLanguageId, LanguageAliasId } from './languages.js';
import type { RuntimeCapabilities } from './protocol.js';

export const RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION = 1 as const;

export type RuntimeAssetEncoding = 'identity' | 'gzip' | 'br';

export interface RuntimeRegistryProfile {
	readonly profileId: string;
	readonly manifestSchemaVersion: number;
	readonly manifestSha256: string;
	readonly protocolVersion: number;
	readonly trustProfileId: string;
	readonly trustProfileSchemaVersion: number;
}

export interface RuntimeRegistryIdentity {
	readonly languageId: CanonicalLanguageId;
	readonly dialect?: string;
	readonly implementationId: string;
	readonly implementationVersion: string;
	readonly profile: RuntimeRegistryProfile;
}

export interface RuntimeRegistryAsset {
	readonly key: string;
	readonly path: string;
	readonly sha256: string;
	readonly compressedBytes: number;
	readonly uncompressedBytes: number;
	readonly mediaType: string;
	readonly encoding: RuntimeAssetEncoding;
}

export interface RuntimeRegistryContractTargets {
	readonly routeId: string;
	readonly runtimeAssetKey: string;
	readonly documentationId: string;
	readonly syncTarget?: string;
	readonly browserTestId?: string;
}

export interface RuntimeRegistryEntry {
	readonly runtimeId: string;
	readonly identity: RuntimeRegistryIdentity;
	readonly aliases?: readonly LanguageAliasId[];
	readonly capabilities: RuntimeCapabilities;
	readonly requiredBrowserFeatures: readonly string[];
	readonly assetRoot?: string;
	readonly assets: readonly RuntimeRegistryAsset[];
	readonly contracts: RuntimeRegistryContractTargets;
}

export interface RuntimeRegistryManifest {
	readonly schemaVersion: typeof RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION;
	readonly manifestId: string;
	readonly revision: string;
	readonly runtimes: readonly RuntimeRegistryEntry[];
}

export function defineRuntimeRegistryManifest(
	manifest: RuntimeRegistryManifest
): RuntimeRegistryManifest {
	if (manifest.schemaVersion !== RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION) {
		throw new TypeError(
			`Unsupported runtime registry manifest schema: ${String(manifest.schemaVersion)}`
		);
	}
	if (
		typeof manifest.manifestId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(manifest.manifestId)
	) {
		throw new TypeError('Runtime registry manifest ID must be a stable identifier');
	}
	if (
		typeof manifest.revision !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(manifest.revision)
	) {
		throw new TypeError('Runtime registry revision must be a stable identifier');
	}
	if (manifest.runtimes.length === 0) {
		throw new TypeError('Runtime registry manifest must declare at least one runtime');
	}

	const runtimeIds = new Set<string>();
	const aliases = new Set<LanguageAliasId>();
	const routeIds = new Set<string>();
	const browserTestIds = new Set<string>();
	const normalizedRuntimes = manifest.runtimes.map((runtime) => {
		if (
			typeof runtime.runtimeId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(runtime.runtimeId)
		) {
			throw new TypeError('Runtime ID must be a stable identifier');
		}
		if (runtimeIds.has(runtime.runtimeId)) {
			throw new TypeError(`Duplicate runtime ID: ${runtime.runtimeId}`);
		}
		runtimeIds.add(runtime.runtimeId);
		if (!isSupportedLanguageId(runtime.identity.languageId)) {
			throw new TypeError(
				`Unsupported canonical language ID: ${runtime.identity.languageId}`
			);
		}
		if (
			typeof runtime.identity.implementationId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(runtime.identity.implementationId)
		) {
			throw new TypeError(`Invalid implementation ID for runtime ${runtime.runtimeId}`);
		}
		if (
			typeof runtime.identity.implementationVersion !== 'string' ||
			!runtime.identity.implementationVersion.trim()
		) {
			throw new TypeError(`Missing implementation version for runtime ${runtime.runtimeId}`);
		}
		if (
			runtime.identity.dialect !== undefined &&
			(typeof runtime.identity.dialect !== 'string' || !runtime.identity.dialect.trim())
		) {
			throw new TypeError(`Empty dialect for runtime ${runtime.runtimeId}`);
		}

		const profile = runtime.identity.profile;
		if (
			typeof profile.profileId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(profile.profileId)
		) {
			throw new TypeError(`Invalid profile ID for runtime ${runtime.runtimeId}`);
		}
		if (
			!Number.isSafeInteger(profile.manifestSchemaVersion) ||
			profile.manifestSchemaVersion < 1
		) {
			throw new TypeError(`Invalid profile manifest schema for runtime ${runtime.runtimeId}`);
		}
		if (
			typeof profile.manifestSha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(profile.manifestSha256)
		) {
			throw new TypeError(
				`Invalid profile manifest SHA-256 for runtime ${runtime.runtimeId}`
			);
		}
		if (!Number.isSafeInteger(profile.protocolVersion) || profile.protocolVersion < 1) {
			throw new TypeError(`Invalid protocol version for runtime ${runtime.runtimeId}`);
		}
		if (
			typeof profile.trustProfileId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(profile.trustProfileId)
		) {
			throw new TypeError(`Invalid trust profile ID for runtime ${runtime.runtimeId}`);
		}
		if (
			!Number.isSafeInteger(profile.trustProfileSchemaVersion) ||
			profile.trustProfileSchemaVersion < 1
		) {
			throw new TypeError(`Invalid trust profile schema for runtime ${runtime.runtimeId}`);
		}

		const normalizedAliases = [...new Set(runtime.aliases ?? [])].sort();
		for (const alias of normalizedAliases) {
			const definition = languageAliases[alias];
			if (!definition || definition.canonicalId !== runtime.identity.languageId) {
				throw new TypeError(
					`Alias ${alias} does not select language ${runtime.identity.languageId}`
				);
			}
			if (aliases.has(alias)) throw new TypeError(`Duplicate runtime alias: ${alias}`);
			aliases.add(alias);
		}

		const capabilities = runtime.capabilities;
		if (!['none', 'prebuffered', 'streaming'].includes(capabilities.stdin)) {
			throw new TypeError(`Invalid stdin capability for runtime ${runtime.runtimeId}`);
		}
		for (const name of ['workspace', 'abort', 'artifacts', 'streamingOutput'] as const) {
			if (typeof capabilities[name] !== 'boolean') {
				throw new TypeError(`Runtime capability ${name} must be boolean`);
			}
		}

		const requiredBrowserFeatures = [...new Set(runtime.requiredBrowserFeatures)].sort();
		for (const feature of requiredBrowserFeatures) {
			if (typeof feature !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/u.test(feature)) {
				throw new TypeError(
					`Invalid browser feature for runtime ${runtime.runtimeId}: ${feature}`
				);
			}
		}

		if (
			runtime.assetRoot !== undefined &&
			(typeof runtime.assetRoot !== 'string' ||
				runtime.assetRoot.startsWith('/') ||
				runtime.assetRoot.includes('\\') ||
				runtime.assetRoot.includes('\0') ||
				runtime.assetRoot.includes('?') ||
				runtime.assetRoot.includes('#') ||
				runtime.assetRoot
					.split('/')
					.some((segment) => !segment || segment === '.' || segment === '..'))
		) {
			throw new TypeError(
				`Runtime asset root must be a normalized relative path: ${runtime.assetRoot}`
			);
		}
		if (runtime.assets.length > 0 && runtime.assetRoot === undefined) {
			throw new TypeError(
				`Runtime ${runtime.runtimeId} declares assets without an asset root`
			);
		}
		const assetKeys = new Set<string>();
		const assetPaths = new Set<string>();
		const normalizedAssets = runtime.assets.map((asset) => {
			if (typeof asset.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(asset.key)) {
				throw new TypeError(
					`Invalid asset key for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (assetKeys.has(asset.key)) {
				throw new TypeError(
					`Duplicate asset key for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			assetKeys.add(asset.key);
			if (
				typeof asset.path !== 'string' ||
				asset.path.startsWith('/') ||
				asset.path.includes('\\') ||
				asset.path.includes('\0') ||
				asset.path.includes('?') ||
				asset.path.includes('#') ||
				asset.path
					.split('/')
					.some((segment) => !segment || segment === '.' || segment === '..')
			) {
				throw new TypeError(
					`Runtime asset path must be normalized and relative: ${asset.path}`
				);
			}
			if (assetPaths.has(asset.path)) {
				throw new TypeError(
					`Duplicate asset path for runtime ${runtime.runtimeId}: ${asset.path}`
				);
			}
			assetPaths.add(asset.path);
			if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
				throw new TypeError(
					`Invalid asset SHA-256 for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (!Number.isSafeInteger(asset.compressedBytes) || asset.compressedBytes < 0) {
				throw new TypeError(
					`Invalid compressed size for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (!Number.isSafeInteger(asset.uncompressedBytes) || asset.uncompressedBytes < 0) {
				throw new TypeError(
					`Invalid uncompressed size for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (typeof asset.mediaType !== 'string' || !asset.mediaType.includes('/')) {
				throw new TypeError(
					`Invalid media type for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (
				typeof asset.encoding !== 'string' ||
				!['identity', 'gzip', 'br'].includes(asset.encoding)
			) {
				throw new TypeError(
					`Invalid asset encoding for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			if (
				asset.encoding === 'identity' &&
				asset.compressedBytes !== asset.uncompressedBytes
			) {
				throw new TypeError(
					`Identity asset sizes differ for runtime ${runtime.runtimeId}: ${asset.key}`
				);
			}
			return Object.freeze({ ...asset });
		});

		for (const name of ['routeId', 'runtimeAssetKey', 'documentationId'] as const) {
			const value = runtime.contracts[name];
			if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)) {
				throw new TypeError(
					`Invalid ${name} contract target for runtime ${runtime.runtimeId}`
				);
			}
		}
		for (const name of ['syncTarget', 'browserTestId'] as const) {
			const value = runtime.contracts[name];
			if (
				value !== undefined &&
				(typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value))
			) {
				throw new TypeError(
					`Invalid ${name} contract target for runtime ${runtime.runtimeId}`
				);
			}
		}
		if (routeIds.has(runtime.contracts.routeId)) {
			throw new TypeError(`Duplicate runtime route ID: ${runtime.contracts.routeId}`);
		}
		routeIds.add(runtime.contracts.routeId);
		if (runtime.contracts.browserTestId !== undefined) {
			if (browserTestIds.has(runtime.contracts.browserTestId)) {
				throw new TypeError(
					`Duplicate browser test ID: ${runtime.contracts.browserTestId}`
				);
			}
			browserTestIds.add(runtime.contracts.browserTestId);
		}

		return Object.freeze({
			runtimeId: runtime.runtimeId,
			identity: Object.freeze({
				languageId: runtime.identity.languageId,
				dialect: runtime.identity.dialect,
				implementationId: runtime.identity.implementationId,
				implementationVersion: runtime.identity.implementationVersion,
				profile: Object.freeze({ ...profile })
			}),
			aliases: Object.freeze(normalizedAliases),
			capabilities: Object.freeze({ ...capabilities }),
			requiredBrowserFeatures: Object.freeze(requiredBrowserFeatures),
			assetRoot: runtime.assetRoot,
			assets: Object.freeze(
				normalizedAssets.sort((left, right) => left.key.localeCompare(right.key))
			),
			contracts: Object.freeze({ ...runtime.contracts })
		});
	});

	return Object.freeze({
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: manifest.manifestId,
		revision: manifest.revision,
		runtimes: Object.freeze(
			normalizedRuntimes.sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))
		)
	});
}
