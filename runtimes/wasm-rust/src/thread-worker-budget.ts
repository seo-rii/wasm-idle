const THREAD_WORKER_BUDGET_MAGIC = 0x57525442;
const THREAD_WORKER_BUDGET_VERSION = 1;
const THREAD_WORKER_BUDGET_WORDS = 4;
const THREAD_WORKER_BUDGET_BYTES = Int32Array.BYTES_PER_ELEMENT * THREAD_WORKER_BUDGET_WORDS;
const THREAD_WORKER_BUDGET_MAGIC_INDEX = 0;
const THREAD_WORKER_BUDGET_VERSION_INDEX = 1;
const THREAD_WORKER_BUDGET_USED_INDEX = 2;
const THREAD_WORKER_BUDGET_LIMIT_INDEX = 3;
const MAX_ATOMIC_THREAD_WORKERS = 0x7fffffff;

function readThreadWorkerBudgetState(buffer: SharedArrayBuffer) {
	if (
		!(buffer instanceof SharedArrayBuffer) ||
		buffer.byteLength !== THREAD_WORKER_BUDGET_BYTES
	) {
		throw new Error('wasm-rust helper thread budget buffer is invalid');
	}
	const state = new Int32Array(buffer);
	if (
		Atomics.load(state, THREAD_WORKER_BUDGET_MAGIC_INDEX) !== THREAD_WORKER_BUDGET_MAGIC ||
		Atomics.load(state, THREAD_WORKER_BUDGET_VERSION_INDEX) !== THREAD_WORKER_BUDGET_VERSION
	) {
		throw new Error('wasm-rust helper thread budget descriptor is invalid');
	}
	const used = Atomics.load(state, THREAD_WORKER_BUDGET_USED_INDEX);
	const limit = Atomics.load(state, THREAD_WORKER_BUDGET_LIMIT_INDEX);
	if (limit <= 0 || used < 0 || used > limit) {
		throw new Error('wasm-rust helper thread budget state is invalid');
	}
	return state;
}

export function createThreadWorkerBudgetBuffer(maxThreads: number) {
	if (!Number.isSafeInteger(maxThreads) || maxThreads <= 0) {
		throw new Error('wasm-rust maxThreads must be a positive safe integer');
	}
	const buffer = new SharedArrayBuffer(THREAD_WORKER_BUDGET_BYTES);
	const state = new Int32Array(buffer);
	Atomics.store(state, THREAD_WORKER_BUDGET_MAGIC_INDEX, THREAD_WORKER_BUDGET_MAGIC);
	Atomics.store(state, THREAD_WORKER_BUDGET_VERSION_INDEX, THREAD_WORKER_BUDGET_VERSION);
	Atomics.store(
		state,
		THREAD_WORKER_BUDGET_LIMIT_INDEX,
		Math.min(maxThreads, MAX_ATOMIC_THREAD_WORKERS)
	);
	return buffer;
}

export function acquireThreadWorkerPermit(buffer: SharedArrayBuffer) {
	const state = readThreadWorkerBudgetState(buffer);
	const limit = Atomics.load(state, THREAD_WORKER_BUDGET_LIMIT_INDEX);
	while (true) {
		const used = Atomics.load(state, THREAD_WORKER_BUDGET_USED_INDEX);
		if (used >= limit) {
			throw new Error(`wasm-rust helper thread limit exhausted (maxThreads=${limit})`);
		}
		if (
			Atomics.compareExchange(state, THREAD_WORKER_BUDGET_USED_INDEX, used, used + 1) === used
		) {
			break;
		}
	}
	let released = false;
	return Object.freeze({
		release() {
			if (released) return;
			released = true;
			const previous = Atomics.sub(state, THREAD_WORKER_BUDGET_USED_INDEX, 1);
			if (previous <= 0) {
				Atomics.add(state, THREAD_WORKER_BUDGET_USED_INDEX, 1);
				throw new Error('wasm-rust helper thread budget permit underflow');
			}
		}
	});
}

export function createBudgetedThreadWorker<T>(
	buffer: SharedArrayBuffer | undefined,
	createWorker: () => T
) {
	const permit = buffer ? acquireThreadWorkerPermit(buffer) : undefined;
	try {
		const worker = createWorker();
		return Object.freeze({
			worker,
			rollback() {
				permit?.release();
			}
		});
	} catch (error) {
		permit?.release();
		throw error;
	}
}

export function inspectThreadWorkerBudget(buffer: SharedArrayBuffer) {
	const state = readThreadWorkerBudgetState(buffer);
	return Object.freeze({
		used: Atomics.load(state, THREAD_WORKER_BUDGET_USED_INDEX),
		limit: Atomics.load(state, THREAD_WORKER_BUDGET_LIMIT_INDEX)
	});
}
