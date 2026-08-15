import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	defineRuntimeRegistryManifest,
	runtimeIndexFromRegistryManifest,
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
				workerLifetime: {
					mode: 'persistent',
					idleTimeoutMs: 60_000,
					evictOnMemoryPressure: true
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
	it('rejects the previous registry schema after the lifetime contract migration', () => {
		const manifest = createManifest();

		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				schemaVersion: 1 as never
			})
		).toThrow('Unsupported runtime registry manifest schema: 1');
	});

	it('normalizes and freezes identity, capability, asset, and contract data', () => {
		const manifest = defineRuntimeRegistryManifest(createManifest());

		expect(manifest.runtimes[0]?.requiredBrowserFeatures).toEqual(['bulk-memory', 'wasm']);
		expect(manifest.runtimes[0]?.aliases).toEqual(['F77']);
		expect(Object.isFrozen(manifest)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes[0]?.identity.profile)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes[0]?.workerLifetime)).toBe(true);
		expect(Object.isFrozen(manifest.runtimes[0]?.assets[0])).toBe(true);
	});

	it('allows an explicit current-directory asset root without permitting traversal', () => {
		const manifest = createManifest();
		const runtime = manifest.runtimes[0]!;

		expect(
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [{ ...runtime, assetRoot: '.' }]
			}).runtimes[0]?.assetRoot
		).toBe('.');
		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [{ ...runtime, assetRoot: './runtime' }]
			})
		).toThrow('Runtime asset root must be a normalized relative path');
	});

	it('validates persistent and pooled worker lifetime bounds', () => {
		const manifest = createManifest();
		const runtime = manifest.runtimes[0]!;

		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [
					{
						...runtime,
						workerLifetime: {
							mode: 'persistent',
							idleTimeoutMs: 0,
							evictOnMemoryPressure: true
						}
					}
				]
			})
		).toThrow('Persistent worker idle timeout must be a positive safe integer');

		expect(() =>
			defineRuntimeRegistryManifest({
				...manifest,
				runtimes: [
					{
						...runtime,
						workerLifetime: {
							mode: 'pool',
							idleTimeoutMs: 60_000,
							maxWorkers: 1,
							evictOnMemoryPressure: true
						}
					}
				]
			})
		).toThrow('Worker pool size must be a safe integer of at least two');

		const pooled = defineRuntimeRegistryManifest({
			...manifest,
			runtimes: [
				{
					...runtime,
					workerLifetime: {
						mode: 'pool',
						idleTimeoutMs: 30_000,
						maxWorkers: 3,
						evictOnMemoryPressure: false
					}
				}
			]
		});
		expect(pooled.runtimes[0]?.workerLifetime).toEqual({
			mode: 'pool',
			idleTimeoutMs: 30_000,
			maxWorkers: 3,
			evictOnMemoryPressure: false
		});
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

	it('generates immutable consumer indexes from manifest contract targets', () => {
		const manifest = createManifest();
		const baseRuntime = manifest.runtimes[0]!;
		const index = runtimeIndexFromRegistryManifest({
			...manifest,
			runtimes: [
				baseRuntime,
				{
					...baseRuntime,
					runtimeId: 'fortran/modern',
					identity: {
						...baseRuntime.identity,
						implementationId: 'modern-fortran',
						implementationVersion: '1.0.0',
						profile: {
							...baseRuntime.identity.profile,
							profileId: 'modern-fortran-browser-v1'
						}
					},
					aliases: [],
					assetRoot: undefined,
					assets: [],
					contracts: {
						routeId: 'fortran-modern',
						runtimeAssetKey: 'fortran-modern',
						documentationId: 'FORTRAN',
						syncTarget: 'sync:wasm-fortran',
						browserTestId: 'browser:fortran-modern'
					}
				}
			]
		});
		const runtime = index.runtime('fortran/f2c');

		expect(runtime).toBe(index.runtimeForAlias(' f77 '));
		expect(runtime).toBe(index.runtimeForRoute('fortran'));
		expect(runtime).toBe(index.runtimeForAssetKey('fortran'));
		expect(runtime).toBe(index.runtimeForBrowserTest('browser:fortran'));
		expect(index.runtimesForLanguage('FORTRAN').map(({ runtimeId }) => runtimeId)).toEqual([
			'fortran/f2c',
			'fortran/modern'
		]);
		expect(index.runtimesForDocumentation('FORTRAN')).toEqual(
			index.runtimesForLanguage('FORTRAN')
		);
		expect(index.runtimesForSyncTarget('sync:wasm-fortran')).toEqual(
			index.runtimesForLanguage('FORTRAN')
		);
		expect(index.runtimesForLanguage('C')).toEqual([]);
		expect(index.runtimeForRoute('missing')).toBeUndefined();
		expect(Object.isFrozen(index)).toBe(true);
		expect(Object.isFrozen(index.manifest)).toBe(true);
		expect(Object.isFrozen(index.runtimesForLanguage('FORTRAN'))).toBe(true);
		expect(Object.isFrozen(index.runtimesForLanguage('C'))).toBe(true);
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
				runtimes: [{ ...runtime, workerLifetime: undefined as never }]
			})
		).toThrow('must declare a worker lifetime policy');

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
