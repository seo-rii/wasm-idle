import {
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	ResourceLimitError,
	RuntimeResourceBudget,
	RuntimeConfigurationError,
	defineRuntimeTrustProfile,
	enforceRuntimeTrustProfile
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const profile = defineRuntimeTrustProfile({
	schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	profileId: 'resource-test-v1',
	network: { mode: 'none', allowedOrigins: [] },
	storage: { mode: 'ephemeral' },
	environment: { mode: 'none', allowedNames: [] },
	threads: { maxThreads: 4 },
	workers: { maxNestedWorkers: 3 },
	sharedArrayBuffer: true,
	dynamicCode: 'wasm-only',
	sameOriginAccess: false
});

const grant = enforceRuntimeTrustProfile(profile, {
	storage: 'ephemeral',
	threads: 3,
	nestedWorkers: 2,
	sharedArrayBuffer: true,
	dynamicCode: 'wasm-only'
});

const createBudget = () =>
	new RuntimeResourceBudget({
		grant,
		runtimeId: 'runtime/resource-test',
		limits: {
			maxWasmMemoryBytes: 1024,
			maxWorkers: 4,
			maxThreads: 4
		}
	});

describe('runtime resource budget', () => {
	it('tracks resource growth, shrinkage, and idempotent release', () => {
		const budget = createBudget();
		const lease = budget.reserve({
			wasmMemoryBytes: 256,
			nestedWorkers: 1,
			threads: 2
		});

		expect(budget.snapshot()).toMatchObject({
			capacity: { wasmMemoryBytes: 1024, nestedWorkers: 2, threads: 3 },
			used: { wasmMemoryBytes: 256, nestedWorkers: 1, threads: 2 },
			remaining: { wasmMemoryBytes: 768, nestedWorkers: 1, threads: 1 },
			disposed: false
		});
		expect(lease.update({ wasmMemoryBytes: 512, nestedWorkers: 2, threads: 1 })).toEqual({
			wasmMemoryBytes: 512,
			nestedWorkers: 2,
			threads: 1
		});
		expect(budget.snapshot().used).toEqual({
			wasmMemoryBytes: 512,
			nestedWorkers: 2,
			threads: 1
		});

		lease.release();
		lease.release();
		expect(lease.released).toBe(true);
		expect(budget.snapshot().used).toEqual({
			wasmMemoryBytes: 0,
			nestedWorkers: 0,
			threads: 0
		});
	});

	it.each([
		['wasm-memory', { wasmMemoryBytes: 1025 }, 1024, 1025],
		['nested-workers', { nestedWorkers: 3 }, 2, 3],
		['threads', { threads: 4 }, 3, 4]
	] as const)(
		'rejects cumulative %s usage above both the grant and execution limit',
		(resource, reservation, limit, actual) => {
			const budget = createBudget();
			expect(() => budget.reserve(reservation)).toThrowError(
				expect.objectContaining({
					name: 'ResourceLimitError',
					code: 'resource-limit',
					resource,
					limit,
					actual,
					runtimeId: 'runtime/resource-test',
					profileId: 'resource-test-v1'
				}) satisfies Partial<ResourceLimitError>
			);
			expect(budget.snapshot().used).toEqual({
				wasmMemoryBytes: 0,
				nestedWorkers: 0,
				threads: 0
			});
		}
	);

	it('keeps accounting unchanged when a lease update exceeds capacity', () => {
		const budget = createBudget();
		const lease = budget.reserve({ wasmMemoryBytes: 500 });

		expect(() => lease.update({ wasmMemoryBytes: 1100 })).toThrow(ResourceLimitError);
		expect(lease.reservation.wasmMemoryBytes).toBe(500);
		expect(budget.snapshot().used.wasmMemoryBytes).toBe(500);
	});

	it('revalidates grants instead of trusting a forged capability object', () => {
		const forgedGrant = { ...grant, threads: 5 };

		expect(
			() => new RuntimeResourceBudget({ grant: forgedGrant, limits: { maxThreads: 8 } })
		).toThrow('trust profile limit is 4');
	});

	it('rejects malformed and empty reservations', () => {
		const budget = createBudget();

		expect(() => budget.reserve({ threads: -1 })).toThrow(RuntimeConfigurationError);
		expect(() => budget.reserve({})).toThrow('must request at least one resource');
	});

	it('invalidates active leases and new reservations on disposal', () => {
		const budget = createBudget();
		const lease = budget.reserve({ nestedWorkers: 1 });

		budget.dispose();
		budget.dispose();
		expect(lease.released).toBe(true);
		expect(budget.snapshot()).toMatchObject({
			used: { wasmMemoryBytes: 0, nestedWorkers: 0, threads: 0 },
			disposed: true
		});
		expect(() => lease.update({ nestedWorkers: 1 })).toThrow('budget is disposed');
		expect(() => budget.reserve({ nestedWorkers: 1 })).toThrow('budget is disposed');
	});
});
