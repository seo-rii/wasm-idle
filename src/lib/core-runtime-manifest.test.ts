import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	defineRuntimeRegistryManifest,
	runtimeIntegrityFromRegistryManifest,
	runtimeProfilesFromRegistryManifest,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const compressedSha256 = 'a'.repeat(64);
const uncompressedSha256 = 'b'.repeat(64);

function createManifest(): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/browser-runtimes',
		revision: '2026.07.28',
		runtimes: [
			{
				runtimeId: 'fortran/f2c',
				identity: {
					languageId: 'FORTRAN',
					dialect: 'Fortran 77',
					implementationId: 'netlib-f2c',
					implementationVersion: '20200916',
					profile: {
						profileId: 'f2c-browser-v1',
						manifestSchemaVersion: 1,
						manifestSha256: compressedSha256,
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				aliases: ['F77'],
				capabilities: {
					stdin: 'prebuffered',
					workspace: false,
					abort: false,
					artifacts: false,
					streamingOutput: true
				},
				requiredBrowserFeatures: ['wasm', 'bulk-memory', 'wasm'],
				assetRoot: 'wasm-fortran',
				assets: [
					{
						key: 'f2c.wasm.gz',
						path: 'f2c.wasm.gz',
						compressedSha256,
						uncompressedSha256,
						compressedBytes: 10,
						uncompressedBytes: 20,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'fortran',
					runtimeAssetKey: 'fortran',
					documentationId: 'FORTRAN',
					syncTarget: 'sync:wasm-fortran',
					browserTestId: 'browser:fortran'
				}
			}
		]
	};
}

describe('runtime registry manifest', () => {
	it('normalizes and freezes identity, capability, asset, and contract data', () => {
		const manifest = defineRuntimeRegistryManifest(createManifest());

		expect(manifest.runtimes[0]?.requiredBrowserFeatures).toEqual(['bulk-memory', 'wasm']);
		expect(manifest.runtimes[0]?.aliases).toEqual(['F77']);
		expect(Object.isFrozen(manifest)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes[0]?.identity.profile)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes[0]?.assets[0])).toBe(true);
	});

	it('projects cache profiles and both integrity stages from the registry', () => {
		const manifest = createManifest();

		expect(runtimeProfilesFromRegistryManifest(manifest)).toEqual({
			fortran: {
				profileId: 'f2c-browser-v1',
				manifestSchemaVersion: 1,
				manifestSha256: compressedSha256,
				protocolVersion: 1,
				trustProfileId: 'restricted-browser-worker-v1',
				trustProfileSchemaVersion: 1
			}
		});
		expect(runtimeIntegrityFromRegistryManifest(manifest)).toEqual({
			fortran: {
				'f2c.wasm.gz': {
					sha256: compressedSha256,
					bytes: 10,
					mediaType: 'application/wasm',
					uncompressedSha256,
					uncompressedBytes: 20
				}
			}
		});
	});

	it('rejects aliases that name a different language implementation', () => {
		const manifest = createManifest();
		const runtime = manifest.runtimes[0]!;

		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [{ ...runtime, aliases: ['PYPY3'] }]
			})
		).toThrow('Alias PYPY3 does not select language FORTRAN');
	});

	it('rejects duplicate runtime and generated contract identities', () => {
		const manifest = createManifest();
		const runtime = manifest.runtimes[0]!;

		expect(() =>
			defineRuntimeRegistryManifest({ ...manifest, runtimes: [runtime, runtime] })
		).toThrow('Duplicate runtime ID: fortran/f2c');
	});

	it('rejects missing capability and generated contract fields at runtime', () => {
		const manifest = createManifest();
		const runtime = manifest.runtimes[0]!;
		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [
					{
						...runtime,
						capabilities: {
							...runtime.capabilities,
							abort: undefined as unknown as boolean
						}
					}
				]
			})
		).toThrow('Runtime capability abort must be boolean');

		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [
					{
						...runtime,
						contracts: {
							...runtime.contracts,
							routeId: undefined as unknown as string
						}
					}
				]
			})
		).toThrow('Invalid routeId contract target');
	});

	it('rejects unsafe paths and incomplete integrity metadata', () => {
		const unsafePath = createManifest();
		const unsafeRuntime = unsafePath.runtimes[0]!;
		expect(() =>
			defineRuntimeRegistryManifest({
				...unsafePath,
				runtimes: [
					{
						...unsafeRuntime,
						assets: [{ ...unsafeRuntime.assets[0]!, path: '../f2c.wasm.gz' }]
					}
				]
			})
		).toThrow('Runtime asset path must be normalized and relative');

		const invalidHash = createManifest();
		const invalidHashRuntime = invalidHash.runtimes[0]!;
		expect(() =>
			defineRuntimeRegistryManifest({
				...invalidHash,
				runtimes: [
					{
						...invalidHashRuntime,
						assets: [
							{ ...invalidHashRuntime.assets[0]!, uncompressedSha256: 'unverified' }
						]
					}
				]
			})
		).toThrow('Invalid uncompressed asset SHA-256');
	});
});
