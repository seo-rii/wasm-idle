import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import {
	assertRuntimeAssetDeliveryBudgetAvailable,
	consumeRuntimeAssetDeliveryBytes,
	createRuntimeAssetDeliveryBudget,
	declareRuntimeAssetDeliveryExpectedBytes,
	readRuntimeAssetDeliveryBudget,
	resolveRuntimeAssetDeliveryBudget,
	snapshotRuntimeAssetDeliveryBudget,
	withRuntimeAssetDeliveryBudget
} from '../src/runtime-delivery-budget.js';

const MAGIC = 0x5741534d49444c45n;

describe('runtime asset delivery budget', () => {
	it('creates and snapshots the exact Core wire contract', () => {
		const budget = createRuntimeAssetDeliveryBudget(128);
		const state = new BigInt64Array(budget.state);

		expect(Object.keys(budget).sort()).toEqual(['maxBytes', 'schemaVersion', 'state']);
		expect(Object.isFrozen(budget)).toBe(true);
		expect(budget).toMatchObject({ schemaVersion: 1, maxBytes: 128 });
		expect(budget.state).toBeInstanceOf(SharedArrayBuffer);
		expect(budget.state.byteLength).toBe(40);
		expect(Array.from(state)).toEqual([MAGIC, 128n, 0n, 0n, 0n]);

		const snapshot = snapshotRuntimeAssetDeliveryBudget({ ...budget });
		expect(snapshot).not.toBe(budget);
		expect(snapshot.state).toBe(budget.state);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(readRuntimeAssetDeliveryBudget(snapshot)).toEqual({
			maxBytes: 128,
			expectedBytes: 0,
			deliveredBytes: 0,
			remainingBytes: 128,
			sequence: 0
		});
	});

	it('rejects malformed descriptors and shared state', () => {
		const budget = createRuntimeAssetDeliveryBudget(8);
		expect(() => snapshotRuntimeAssetDeliveryBudget({ ...budget, extra: true })).toThrow(
			/invalid/
		);
		expect(() =>
			snapshotRuntimeAssetDeliveryBudget({
				schemaVersion: 1,
				maxBytes: 8,
				state: new SharedArrayBuffer(32)
			})
		).toThrow(/invalid/);

		const wrongMagic = new SharedArrayBuffer(40);
		Atomics.store(new BigInt64Array(wrongMagic), 1, 8n);
		expect(() =>
			snapshotRuntimeAssetDeliveryBudget({
				schemaVersion: 1,
				maxBytes: 8,
				state: wrongMagic
			})
		).toThrow(/invalid/);

		const wrongMax = new BigInt64Array(budget.state);
		Atomics.store(wrongMax, 1, 9n);
		expect(() => snapshotRuntimeAssetDeliveryBudget(budget)).toThrow(/invalid/);

		const accessor = Object.defineProperties(
			{},
			{
				schemaVersion: { enumerable: true, get: () => 1 },
				maxBytes: { enumerable: true, value: 8 },
				state: { enumerable: true, value: createRuntimeAssetDeliveryBudget(8).state }
			}
		);
		expect(() => snapshotRuntimeAssetDeliveryBudget(accessor)).toThrow(/invalid/);
		expect(() =>
			snapshotRuntimeAssetDeliveryBudget(
				Object.assign(Object.create({}), createRuntimeAssetDeliveryBudget(8))
			)
		).toThrow(/invalid/);
	});

	it('accepts a cross-realm SharedArrayBuffer through its intrinsic brand', () => {
		const state = runInNewContext('new SharedArrayBuffer(40)') as SharedArrayBuffer;
		expect(state).not.toBeInstanceOf(SharedArrayBuffer);
		const slots = new BigInt64Array(state);
		Atomics.store(slots, 0, MAGIC);
		Atomics.store(slots, 1, 8n);

		expect(
			snapshotRuntimeAssetDeliveryBudget({ schemaVersion: 1, maxBytes: 8, state })
		).toMatchObject({ schemaVersion: 1, maxBytes: 8, state });
	});

	it('declares expected bytes once and accepts an identical declaration', () => {
		const budget = createRuntimeAssetDeliveryBudget(20);

		expect(declareRuntimeAssetDeliveryExpectedBytes(budget, 12)).toMatchObject({
			expectedBytes: 12,
			sequence: 1
		});
		expect(declareRuntimeAssetDeliveryExpectedBytes(budget, 12)).toMatchObject({
			expectedBytes: 12,
			sequence: 1
		});
		expect(() => declareRuntimeAssetDeliveryExpectedBytes(budget, 13)).toThrow(
			/already declared/
		);
	});

	it('treats zero declarations and consumption as an undeclared no-op', () => {
		const budget = createRuntimeAssetDeliveryBudget(20);

		expect(declareRuntimeAssetDeliveryExpectedBytes(budget, 0)).toMatchObject({
			expectedBytes: 0,
			sequence: 0
		});
		expect(declareRuntimeAssetDeliveryExpectedBytes(budget, 12)).toMatchObject({
			expectedBytes: 12,
			sequence: 1
		});
		expect(consumeRuntimeAssetDeliveryBytes(budget, 0)).toMatchObject({
			deliveredBytes: 0,
			sequence: 1
		});
	});

	it('records declarations over the ceiling before failing closed', () => {
		const budget = createRuntimeAssetDeliveryBudget(10);

		expect(() => declareRuntimeAssetDeliveryExpectedBytes(budget, 11)).toThrow(/10 byte limit/);
		expect(readRuntimeAssetDeliveryBudget(budget)).toMatchObject({
			expectedBytes: 11,
			sequence: 1
		});
	});

	it('records an over-limit received delta before throwing and never rolls it back', () => {
		const budget = createRuntimeAssetDeliveryBudget(10);
		consumeRuntimeAssetDeliveryBytes(budget, 6);

		expect(() => consumeRuntimeAssetDeliveryBytes(budget, 5)).toThrow(/aggregate limit/);
		expect(readRuntimeAssetDeliveryBudget(budget)).toEqual({
			maxBytes: 10,
			expectedBytes: 0,
			deliveredBytes: 11,
			remainingBytes: 0,
			sequence: 2
		});
	});

	it('fails closed before work for exhausted and expected-over-limit state', () => {
		const exhausted = createRuntimeAssetDeliveryBudget(4);
		consumeRuntimeAssetDeliveryBytes(exhausted, 4);
		expect(() => assertRuntimeAssetDeliveryBudgetAvailable(exhausted)).toThrow(/exhausted/);

		const invalidExpected = createRuntimeAssetDeliveryBudget(4);
		Atomics.store(new BigInt64Array(invalidExpected.state), 2, 5n);
		expect(() => assertRuntimeAssetDeliveryBudgetAvailable(invalidExpected)).toThrow(
			/expected bytes exceed/
		);
	});

	it('allows same-budget nesting and rejects a different overlapping scope', async () => {
		const first = createRuntimeAssetDeliveryBudget(8);
		const second = createRuntimeAssetDeliveryBudget(8);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const entered = vi.fn();
		const pending = withRuntimeAssetDeliveryBudget(first, async () => {
			entered();
			expect(resolveRuntimeAssetDeliveryBudget()?.state).toBe(first.state);
			await withRuntimeAssetDeliveryBudget(first, async () => {
				expect(resolveRuntimeAssetDeliveryBudget()?.state).toBe(first.state);
			});
			await blocked;
		});
		expect(entered).toHaveBeenCalledOnce();

		await expect(withRuntimeAssetDeliveryBudget(second, async () => undefined)).rejects.toThrow(
			/must not overlap/
		);
		release();
		await pending;
		expect(resolveRuntimeAssetDeliveryBudget()).toBeUndefined();
	});

	it('releases scope ownership after errors and runs an undefined scope directly', async () => {
		const budget = createRuntimeAssetDeliveryBudget(8);
		const failure = new Error('operation failed');

		await expect(
			withRuntimeAssetDeliveryBudget(budget, async () => {
				throw failure;
			})
		).rejects.toBe(failure);
		expect(resolveRuntimeAssetDeliveryBudget()).toBeUndefined();
		await expect(
			withRuntimeAssetDeliveryBudget(undefined, async () => 'complete')
		).resolves.toBe('complete');
	});
});
