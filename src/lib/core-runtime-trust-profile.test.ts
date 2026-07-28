import {
	DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	createRuntimeAssetsKey,
	defineRuntimeTrustProfile
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const manifestSha256 = 'a'.repeat(64);

describe('runtime trust profiles', () => {
	it('publishes an immutable restricted browser-worker default', () => {
		expect(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE).toMatchObject({
			schemaVersion: 1,
			profileId: 'restricted-browser-worker-v1',
			network: { mode: 'none', allowedOrigins: [] },
			storage: { mode: 'ephemeral' },
			environment: { mode: 'none', allowedNames: [] },
			threads: { maxThreads: 0 },
			workers: { maxNestedWorkers: 0 },
			sharedArrayBuffer: false,
			dynamicCode: 'wasm-only',
			sameOriginAccess: false
		});
		expect(Object.isFrozen(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE)).toBe(true);
		expect(Object.isFrozen(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE.network)).toBe(true);
		expect(
			Object.isFrozen(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE.network.allowedOrigins)
		).toBe(true);
	});

	it('normalizes allowlists into deterministic immutable values', () => {
		const profile = defineRuntimeTrustProfile({
			schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
			profileId: 'curated-pack-v1',
			network: {
				mode: 'allowlist',
				allowedOrigins: ['https://packages.example.com/', 'https://cdn.example.com']
			},
			storage: { mode: 'persistent' },
			environment: { mode: 'allowlist', allowedNames: ['TZ', 'LANG', 'TZ'] },
			threads: { maxThreads: 4 },
			workers: { maxNestedWorkers: 1 },
			sharedArrayBuffer: true,
			dynamicCode: 'javascript-and-wasm',
			sameOriginAccess: false
		});

		expect(profile.network.allowedOrigins).toEqual([
			'https://cdn.example.com',
			'https://packages.example.com'
		]);
		expect(profile.environment.allowedNames).toEqual(['LANG', 'TZ']);
		expect(Object.isFrozen(profile.environment.allowedNames)).toBe(true);
	});

	it('rejects capabilities that cannot satisfy their declared policy', () => {
		expect(() =>
			defineRuntimeTrustProfile({
				...DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
				profileId: 'invalid-network-v1',
				network: { mode: 'none', allowedOrigins: ['https://cdn.example.com'] }
			})
		).toThrow('cannot declare allowed origins');
		expect(() =>
			defineRuntimeTrustProfile({
				...DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
				profileId: 'invalid-threads-v1',
				threads: { maxThreads: 1 }
			})
		).toThrow('threads require SharedArrayBuffer');
		expect(() =>
			defineRuntimeTrustProfile({
				...DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
				profileId: 'invalid-origin-v1',
				network: { mode: 'allowlist', allowedOrigins: ['https://cdn.example.com/runtime'] }
			})
		).toThrow('requires HTTP(S) origins');
	});

	it('binds trust-profile identity into runtime asset cache keys', () => {
		const createKey = (trustProfileId: string) =>
			createRuntimeAssetsKey({
				runtimeProfiles: {
					clang: {
						profileId: 'clang-wasi-22',
						manifestSchemaVersion: 2,
						manifestSha256,
						protocolVersion: 1,
						trustProfileId,
						trustProfileSchemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION
					}
				}
			});

		expect(createKey('restricted-browser-worker-v1')).not.toBe(createKey('networked-pack-v1'));
		expect(() =>
			createRuntimeAssetsKey({
				runtimeProfiles: {
					clang: {
						profileId: 'clang-wasi-22',
						manifestSchemaVersion: 2,
						manifestSha256,
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1'
					}
				}
			})
		).toThrow('requires both trust profile ID and schema version');
	});
});
