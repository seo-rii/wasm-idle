export const THREAD_STARTUP_STATE_FAILED = -1;
export const THREAD_STARTUP_STATE_STARTING = 1;
export const THREAD_STARTUP_STATE_INSTANTIATED = 2;
export const THREAD_STARTUP_STATE_ENTERING = 3;
const THREAD_POOL_SLOT_LOCK_INDEX = 3;
const THREAD_POOL_SLOT_UNLOCKED = 0;
const THREAD_POOL_SLOT_LOCKED = 1;

export function reserveIdleThreadPoolSlot<T extends { slotState: Int32Array }>(slots: T[]) {
	for (const slot of slots) {
		if (
			Atomics.compareExchange(
				slot.slotState,
				THREAD_POOL_SLOT_LOCK_INDEX,
				THREAD_POOL_SLOT_UNLOCKED,
				THREAD_POOL_SLOT_LOCKED
			) !== THREAD_POOL_SLOT_UNLOCKED
		) {
			continue;
		}
		if (Atomics.load(slot.slotState, 0) === 0) {
			return slot;
		}
		Atomics.store(slot.slotState, THREAD_POOL_SLOT_LOCK_INDEX, THREAD_POOL_SLOT_UNLOCKED);
	}
	return null;
}

export function dispatchThreadPoolSlotAndWait(
	state: Int32Array,
	threadId: number,
	startArg: number,
	minimumState: number,
	timeoutMs: number,
	failureMessage: string,
	timeoutMessage: string
) {
	Atomics.store(state, 1, threadId);
	Atomics.store(state, 2, startArg);
	Atomics.store(state, 0, THREAD_STARTUP_STATE_STARTING);
	Atomics.store(state, THREAD_POOL_SLOT_LOCK_INDEX, THREAD_POOL_SLOT_UNLOCKED);
	Atomics.notify(state, 0);
	return waitForThreadStartupState(
		state,
		minimumState,
		timeoutMs,
		failureMessage,
		timeoutMessage
	);
}

export function waitForThreadStartupState(
	state: Int32Array,
	minimumState: number,
	timeoutMs: number,
	failureMessage: string,
	timeoutMessage: string
) {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const currentState = Atomics.load(state, 0);
		if (currentState >= minimumState) {
			return currentState;
		}
		if (currentState <= THREAD_STARTUP_STATE_FAILED) {
			throw new Error(failureMessage);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(timeoutMessage);
		}
		Atomics.wait(state, 0, currentState, Math.min(remaining, 1_000));
	}
}
