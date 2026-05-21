import { describe, expect, it } from 'vitest';

import {
	dispatchThreadPoolSlotAndWait,
	THREAD_STARTUP_STATE_INSTANTIATED,
	reserveIdleThreadPoolSlot,
	THREAD_STARTUP_STATE_ENTERING,
	THREAD_STARTUP_STATE_FAILED,
	THREAD_STARTUP_STATE_STARTING,
	waitForThreadStartupState
} from '../src/thread-startup.js';

describe('thread startup handshake', () => {
	it('returns immediately when the worker has already reached the entering state', () => {
		const state = new Int32Array(new SharedArrayBuffer(4));
		Atomics.store(state, 0, THREAD_STARTUP_STATE_ENTERING);

		expect(
			waitForThreadStartupState(
				state,
				THREAD_STARTUP_STATE_ENTERING,
				1_000,
				'failed',
				'timed out'
			)
		).toBe(THREAD_STARTUP_STATE_ENTERING);
	});

	it('throws the provided failure message when the worker reports startup failure', () => {
		const state = new Int32Array(new SharedArrayBuffer(4));
		Atomics.store(state, 0, THREAD_STARTUP_STATE_FAILED);

		expect(() =>
			waitForThreadStartupState(
				state,
				THREAD_STARTUP_STATE_ENTERING,
				1_000,
				'failed to initialize',
				'timed out'
			)
		).toThrow('failed to initialize');
	});

	it('throws the provided timeout message when the worker never reaches the entering state', () => {
		const state = new Int32Array(new SharedArrayBuffer(4));

		expect(() =>
			waitForThreadStartupState(
				state,
				THREAD_STARTUP_STATE_ENTERING,
				0,
				'failed',
				'timed out before entering'
			)
		).toThrow('timed out before entering');
	});

	it('primes a pooled slot with thread metadata before waiting for the worker to enter', () => {
		const state = new Int32Array(new SharedArrayBuffer(16));

		expect(() =>
			dispatchThreadPoolSlotAndWait(
				state,
				7,
				1234,
				THREAD_STARTUP_STATE_INSTANTIATED,
				0,
				'failed',
				'timed out before entering'
			)
		).toThrow('timed out before entering');
		expect(Atomics.load(state, 0)).toBe(THREAD_STARTUP_STATE_STARTING);
		expect(Atomics.load(state, 1)).toBe(7);
		expect(Atomics.load(state, 2)).toBe(1234);
		expect(Atomics.load(state, 3)).toBe(0);
	});

	it('reserves an idle pooled slot only once until it is dispatched', () => {
		const slot = {
			slotIndex: 0,
			slotState: new Int32Array(new SharedArrayBuffer(16))
		};

		expect(reserveIdleThreadPoolSlot([slot])).toBe(slot);
		expect(Atomics.load(slot.slotState, 3)).toBe(1);
		expect(reserveIdleThreadPoolSlot([slot])).toBeNull();
	});

	it('skips busy pooled slots when reserving an idle slot', () => {
		const busySlot = {
			slotIndex: 0,
			slotState: new Int32Array(new SharedArrayBuffer(16))
		};
		const idleSlot = {
			slotIndex: 1,
			slotState: new Int32Array(new SharedArrayBuffer(16))
		};
		Atomics.store(busySlot.slotState, 0, THREAD_STARTUP_STATE_STARTING);

		expect(reserveIdleThreadPoolSlot([busySlot, idleSlot])).toBe(idleSlot);
		expect(Atomics.load(busySlot.slotState, 3)).toBe(0);
		expect(Atomics.load(idleSlot.slotState, 3)).toBe(1);
	});
});
