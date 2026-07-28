import {
	DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	createPlaygroundBinding,
	defineRuntimeTrustProfile,
	enforceRuntimeTrustProfile,
	type ExecutionResult
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

const curatedProfile = defineRuntimeTrustProfile({
	schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	profileId: 'curated-runtime-v1',
	network: {
		mode: 'allowlist',
		allowedOrigins: ['https://packages.example.com']
	},
	storage: { mode: 'persistent' },
	environment: { mode: 'allowlist', allowedNames: ['LANG', 'TZ'] },
	threads: { maxThreads: 2 },
	workers: { maxNestedWorkers: 1 },
	sharedArrayBuffer: true,
	dynamicCode: 'javascript-and-wasm',
	sameOriginAccess: false
});

const completedResult: ExecutionResult = {
	ok: true,
	exitCode: 0,
	stdout: '',
	stderr: '',
	diagnostics: [],
	artifacts: [],
	timings: { assetMs: 0, startupMs: 0, compileMs: 0, executeMs: 1, totalMs: 1 },
	terminationReason: 'completed',
	runtime: {
		languageId: 'C',
		implementationId: 'clang',
		version: '22.1.8',
		protocolVersion: 1
	}
};

describe('runtime trust-profile enforcement', () => {
	it('normalizes and grants requests within every declared boundary', () => {
		const grant = enforceRuntimeTrustProfile(curatedProfile, {
			environment: { TZ: 'UTC', LANG: 'C.UTF-8' },
			networkUrls: ['https://packages.example.com/z', 'https://packages.example.com/a'],
			pageOrigin: 'https://app.example.com',
			storage: 'persistent',
			threads: 2,
			nestedWorkers: 1,
			sharedArrayBuffer: true,
			dynamicCode: 'javascript-and-wasm'
		});

		expect(grant.environment).toEqual({ LANG: 'C.UTF-8', TZ: 'UTC' });
		expect(grant.networkUrls).toEqual([
			'https://packages.example.com/a',
			'https://packages.example.com/z'
		]);
		expect(grant.pageOrigin).toBe('https://app.example.com');
		expect(Object.isFrozen(grant)).toBe(true);
		expect(Object.isFrozen(grant.environment)).toBe(true);
	});

	it('fails closed for environment and network access outside the profile', () => {
		expect(() =>
			enforceRuntimeTrustProfile(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE, {
				environment: { TOKEN: 'secret' }
			})
		).toThrow('does not allow environment variables');
		expect(() =>
			enforceRuntimeTrustProfile(curatedProfile, {
				environment: { TOKEN: 'secret' }
			})
		).toThrow('TOKEN is not allowed');
		expect(() =>
			enforceRuntimeTrustProfile(curatedProfile, {
				networkUrls: ['https://untrusted.example.com/pkg'],
				pageOrigin: 'https://app.example.com'
			})
		).toThrow('network origin https://untrusted.example.com is not allowed');
		expect(() =>
			enforceRuntimeTrustProfile(
				defineRuntimeTrustProfile({
					...curatedProfile,
					profileId: 'same-origin-blocked-v1',
					network: {
						mode: 'allowlist',
						allowedOrigins: ['https://app.example.com']
					}
				}),
				{
					networkUrls: ['https://app.example.com/api'],
					pageOrigin: 'https://app.example.com'
				}
			)
		).toThrow('does not allow same-origin access');
	});

	it('enforces storage, thread, worker, shared-memory, and dynamic-code ceilings', () => {
		expect(() =>
			enforceRuntimeTrustProfile(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE, {
				storage: 'persistent'
			})
		).toThrow('storage persistent exceeds');
		expect(() => enforceRuntimeTrustProfile(curatedProfile, { threads: 3 })).toThrow(
			'requested 3 threads'
		);
		expect(() => enforceRuntimeTrustProfile(curatedProfile, { threads: 1 })).toThrow(
			'thread requests require SharedArrayBuffer'
		);
		expect(() => enforceRuntimeTrustProfile(curatedProfile, { nestedWorkers: 2 })).toThrow(
			'requested 2 nested workers'
		);
		expect(() =>
			enforceRuntimeTrustProfile(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE, {
				sharedArrayBuffer: true
			})
		).toThrow('does not allow SharedArrayBuffer');
		expect(() =>
			enforceRuntimeTrustProfile(DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE, {
				dynamicCode: 'javascript-and-wasm'
			})
		).toThrow('dynamic-code request javascript-and-wasm exceeds');
	});

	it('enforces the environment allowlist at bound load, run, and execute requests', async () => {
		const execute = vi.fn(async () => completedResult);
		const run = vi.fn(async () => true);
		const load = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding(
			'/runtime',
			async () => ({
				constructor: class {},
				eof: () => undefined,
				load,
				run,
				execute,
				terminate: () => undefined,
				clear: async () => undefined
			}),
			{ trustProfile: curatedProfile }
		);
		const sandbox = await binding.load('C');

		await sandbox.load('', false, [], { env: { TZ: 'UTC' } });
		await sandbox.run('', false, false, undefined, [], { env: { LANG: 'C' } });
		await sandbox.execute?.({ code: '', env: { TZ: 'UTC', LANG: 'C' } });
		expect(load).toHaveBeenCalledWith(
			'/runtime',
			'',
			false,
			[],
			expect.objectContaining({ env: { TZ: 'UTC' } }),
			undefined
		);
		expect(run).toHaveBeenCalledWith(
			'',
			false,
			false,
			undefined,
			[],
			expect.objectContaining({ env: { LANG: 'C' } })
		);
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({ env: { LANG: 'C', TZ: 'UTC' } })
		);
		expect(sandbox.trustProfile).toEqual(curatedProfile);
		expect(binding.terminalProps.trustProfile).toEqual(curatedProfile);

		await expect(
			sandbox.run('', false, false, undefined, [], { env: { TOKEN: 'secret' } })
		).rejects.toThrow('TOKEN is not allowed');
	});
});
