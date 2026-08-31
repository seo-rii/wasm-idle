import {
	RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
	consumeRuntimeAssetDeliveryBytes,
	createRuntimeAssetDeliveryBudget,
	declareRuntimeAssetDeliveryExpectedBytes,
	readRuntimeAssetDeliveryBudget,
	snapshotRuntimeAssetDeliveryBudgetDescriptor
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const BUDGET_MAGIC = 0x5741534d49444c45n;

describe('Core runtime asset delivery budget', () => {
	it('creates the exact versioned shared wire descriptor', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(128);

		expect(Reflect.ownKeys(descriptor).sort()).toEqual(['maxBytes', 'schemaVersion', 'state']);
		expect(descriptor).toMatchObject({
			schemaVersion: RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
			maxBytes: 128
		});
		expect(descriptor.state).toBeInstanceOf(SharedArrayBuffer);
		expect(descriptor.state.byteLength).toBe(40);
		expect([...new BigInt64Array(descriptor.state)]).toEqual([BUDGET_MAGIC, 128n, 0n, 0n, 0n]);
		expect(Object.isFrozen(descriptor)).toBe(true);
		expect(readRuntimeAssetDeliveryBudget(descriptor)).toEqual({
			maxBytes: 128,
			expectedBytes: 0,
			deliveredBytes: 0,
			remainingBytes: 128,
			sequence: 0
		});
	});

	it('shares counters across structured clones and snapshots', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(16);
		const cloned = structuredClone(descriptor);
		const snapshot = snapshotRuntimeAssetDeliveryBudgetDescriptor(cloned);

		expect(Object.isFrozen(snapshot)).toBe(true);
		consumeRuntimeAssetDeliveryBytes(snapshot, 7);
		expect(readRuntimeAssetDeliveryBudget(descriptor)).toMatchObject({
			deliveredBytes: 7,
			remainingBytes: 9,
			sequence: 1
		});
	});

	it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid maximum byte counts: %s',
		(maxBytes) => {
			expect(() => createRuntimeAssetDeliveryBudget(maxBytes)).toThrow(
				'maxBytes must be a positive safe integer'
			);
		}
	);

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid expected and delivered byte counts: %s',
		(value) => {
			const descriptor = createRuntimeAssetDeliveryBudget(16);
			expect(() => declareRuntimeAssetDeliveryExpectedBytes(descriptor, value)).toThrow(
				'expected bytes must be a non-negative safe integer'
			);
			expect(() => consumeRuntimeAssetDeliveryBytes(descriptor, value)).toThrow(
				'byte delta must be a non-negative safe integer'
			);
		}
	);

	it('strictly validates descriptor keys, state size, magic, and bound maximum', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(16);
		const extra = { ...descriptor, extra: true };
		const accessor = Object.defineProperties(
			{},
			{
				schemaVersion: { enumerable: true, get: () => 1 },
				maxBytes: { enumerable: true, value: 16 },
				state: { enumerable: true, value: descriptor.state }
			}
		);

		expect(() => snapshotRuntimeAssetDeliveryBudgetDescriptor(extra)).toThrow(
			'descriptor has invalid keys'
		);
		expect(() => snapshotRuntimeAssetDeliveryBudgetDescriptor(accessor)).toThrow(
			'descriptor has invalid keys'
		);
		expect(() =>
			snapshotRuntimeAssetDeliveryBudgetDescriptor({
				schemaVersion: 1,
				maxBytes: 16,
				state: new SharedArrayBuffer(32)
			})
		).toThrow('state must be a 40-byte SharedArrayBuffer');

		const corruptMagic = structuredClone(descriptor);
		Atomics.store(new BigInt64Array(corruptMagic.state), 0, 0n);
		expect(() => snapshotRuntimeAssetDeliveryBudgetDescriptor(corruptMagic)).toThrow(
			'state magic is invalid'
		);

		const mismatchedMaximum = createRuntimeAssetDeliveryBudget(16);
		expect(() =>
			snapshotRuntimeAssetDeliveryBudgetDescriptor({
				...mismatchedMaximum,
				maxBytes: 15
			})
		).toThrow('state maxBytes does not match');
	});

	it('declares one immutable expectation and records an oversized declaration', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(10);

		expect(declareRuntimeAssetDeliveryExpectedBytes(descriptor, 8)).toMatchObject({
			expectedBytes: 8,
			sequence: 1
		});
		expect(declareRuntimeAssetDeliveryExpectedBytes(descriptor, 8)).toMatchObject({
			expectedBytes: 8,
			sequence: 1
		});
		expect(() => declareRuntimeAssetDeliveryExpectedBytes(descriptor, 9)).toThrow(
			'already declared as 8'
		);

		const oversized = createRuntimeAssetDeliveryBudget(10);
		expect(() =>
			declareRuntimeAssetDeliveryExpectedBytes(oversized, 11, {
				runtimeId: 'rust',
				profileId: 'wasip2'
			})
		).toThrow(
			expect.objectContaining({
				name: 'AssetTooLargeError',
				code: 'asset-too-large',
				phase: 'asset',
				limit: 10,
				actual: 11,
				runtimeId: 'rust',
				profileId: 'wasip2'
			})
		);
		expect(readRuntimeAssetDeliveryBudget(oversized)).toMatchObject({
			expectedBytes: 11,
			sequence: 1
		});
	});

	it('treats zero declarations and consumption as an undeclared no-op', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(16);

		expect(declareRuntimeAssetDeliveryExpectedBytes(descriptor, 0)).toMatchObject({
			expectedBytes: 0,
			sequence: 0
		});
		expect(declareRuntimeAssetDeliveryExpectedBytes(descriptor, 8)).toMatchObject({
			expectedBytes: 8,
			sequence: 1
		});
		expect(consumeRuntimeAssetDeliveryBytes(descriptor, 0)).toMatchObject({
			deliveredBytes: 0,
			sequence: 1
		});
	});

	it('records every actual delta before reporting an aggregate overflow', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(10);

		expect(consumeRuntimeAssetDeliveryBytes(descriptor, 4)).toMatchObject({
			deliveredBytes: 4,
			remainingBytes: 6,
			sequence: 1
		});
		expect(consumeRuntimeAssetDeliveryBytes(descriptor, 6)).toMatchObject({
			deliveredBytes: 10,
			remainingBytes: 0,
			sequence: 2
		});
		expect(() =>
			consumeRuntimeAssetDeliveryBytes(descriptor, 3, {
				runtimeId: 'rust',
				profileId: 'wasip1'
			})
		).toThrow(
			expect.objectContaining({
				name: 'AssetTooLargeError',
				code: 'asset-too-large',
				limit: 10,
				actual: 13,
				runtimeId: 'rust',
				profileId: 'wasip1'
			})
		);
		expect(readRuntimeAssetDeliveryBudget(descriptor)).toEqual({
			maxBytes: 10,
			expectedBytes: 0,
			deliveredBytes: 13,
			remainingBytes: 0,
			sequence: 3
		});
	});

	it('retains an over-limit delta when the exact shared total exceeds the safe-number range', () => {
		const descriptor = createRuntimeAssetDeliveryBudget(Number.MAX_SAFE_INTEGER);
		consumeRuntimeAssetDeliveryBytes(descriptor, Number.MAX_SAFE_INTEGER);

		expect(() => consumeRuntimeAssetDeliveryBytes(descriptor, 1)).toThrow(
			expect.objectContaining({
				name: 'AssetTooLargeError',
				limit: Number.MAX_SAFE_INTEGER,
				actual: Number.MAX_SAFE_INTEGER + 1
			})
		);
		expect(Atomics.load(new BigInt64Array(descriptor.state), 3)).toBe(
			BigInt(Number.MAX_SAFE_INTEGER) + 1n
		);
		expect(readRuntimeAssetDeliveryBudget(descriptor)).toMatchObject({
			deliveredBytes: Number.MAX_SAFE_INTEGER + 1,
			remainingBytes: 0,
			sequence: 2
		});
	});

	it('atomically records competing consumers through shared descriptor aliases', async () => {
		const descriptor = createRuntimeAssetDeliveryBudget(32);
		const aliases = Array.from({ length: 64 }, () => structuredClone(descriptor));
		const results = await Promise.allSettled(
			aliases.map(async (alias) => consumeRuntimeAssetDeliveryBytes(alias, 1))
		);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(32);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(32);
		expect(readRuntimeAssetDeliveryBudget(descriptor)).toMatchObject({
			deliveredBytes: 64,
			remainingBytes: 0,
			sequence: 64
		});
	});
});
