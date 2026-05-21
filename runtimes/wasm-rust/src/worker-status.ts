const WORKER_STATUS_STATE_INDEX = 0;
const WORKER_STATUS_CODE_INDEX = 1;
const WORKER_STATUS_PHASE_INDEX = 2;
const WORKER_STATUS_START_ARG_INDEX = 3;
const WORKER_STATUS_WORD0_INDEX = 4;
const WORKER_STATUS_WORD1_INDEX = 5;
const WORKER_STATUS_WORD2_INDEX = 6;
const WORKER_STATUS_WORD3_INDEX = 7;

const WORKER_STATUS_IDLE = 0;
const WORKER_STATUS_FAILED = 1;

const WORKER_STATUS_GENERIC = 0;
const WORKER_STATUS_MEMORY_OOB = 1;
const WORKER_STATUS_UNALIGNED = 2;
const WORKER_STATUS_UNREACHABLE = 3;

const WORKER_STATUS_PHASE_UNKNOWN = 0;
const WORKER_STATUS_PHASE_THREAD_ENTER = 1;
const WORKER_STATUS_PHASE_POOL_ENTER = 2;

export const WORKER_STATUS_BUFFER_BYTES = 32;

function classifyFailureCode(detail: string) {
	if (detail.includes('memory access out of bounds')) {
		return WORKER_STATUS_MEMORY_OOB;
	}
	if (detail.includes('operation does not support unaligned accesses')) {
		return WORKER_STATUS_UNALIGNED;
	}
	if (detail.includes('unreachable')) {
		return WORKER_STATUS_UNREACHABLE;
	}
	return WORKER_STATUS_GENERIC;
}

export function markWorkerFailure(sharedStatusBuffer: SharedArrayBuffer, detail: string) {
	const state = new Int32Array(sharedStatusBuffer);
	if (
		Atomics.compareExchange(
			state,
			WORKER_STATUS_STATE_INDEX,
			WORKER_STATUS_IDLE,
			WORKER_STATUS_FAILED
		) !== WORKER_STATUS_IDLE
	) {
		return;
	}
	Atomics.store(state, WORKER_STATUS_CODE_INDEX, classifyFailureCode(detail));
	Atomics.notify(state, WORKER_STATUS_STATE_INDEX);
}

export function recordWorkerFailureContext(
	sharedStatusBuffer: SharedArrayBuffer,
	phase: 'thread-enter' | 'pool-enter',
	startArg: number,
	words: readonly number[]
) {
	const state = new Int32Array(sharedStatusBuffer);
	if (Atomics.load(state, WORKER_STATUS_STATE_INDEX) === WORKER_STATUS_FAILED) {
		return;
	}
	Atomics.store(
		state,
		WORKER_STATUS_PHASE_INDEX,
		phase === 'pool-enter' ? WORKER_STATUS_PHASE_POOL_ENTER : WORKER_STATUS_PHASE_THREAD_ENTER
	);
	Atomics.store(state, WORKER_STATUS_START_ARG_INDEX, startArg);
	Atomics.store(state, WORKER_STATUS_WORD0_INDEX, words[0] || 0);
	Atomics.store(state, WORKER_STATUS_WORD1_INDEX, words[1] || 0);
	Atomics.store(state, WORKER_STATUS_WORD2_INDEX, words[2] || 0);
	Atomics.store(state, WORKER_STATUS_WORD3_INDEX, words[3] || 0);
}

function readWorkerFailureContext(state: Int32Array) {
	const phase = Atomics.load(state, WORKER_STATUS_PHASE_INDEX);
	if (phase === WORKER_STATUS_PHASE_UNKNOWN) {
		return '';
	}
	const phaseLabel = phase === WORKER_STATUS_PHASE_POOL_ENTER ? 'pool-enter' : 'thread-enter';
	const startArg = Atomics.load(state, WORKER_STATUS_START_ARG_INDEX);
	const words = [
		Atomics.load(state, WORKER_STATUS_WORD0_INDEX),
		Atomics.load(state, WORKER_STATUS_WORD1_INDEX),
		Atomics.load(state, WORKER_STATUS_WORD2_INDEX),
		Atomics.load(state, WORKER_STATUS_WORD3_INDEX)
	];
	return ` (${phaseLabel} startArg=${startArg} words=${words.join(',')})`;
}

export function readWorkerFailure(sharedStatusBuffer: SharedArrayBuffer) {
	const state = new Int32Array(sharedStatusBuffer);
	if (Atomics.load(state, WORKER_STATUS_STATE_INDEX) !== WORKER_STATUS_FAILED) {
		return null;
	}
	const code = Atomics.load(state, WORKER_STATUS_CODE_INDEX);
	const context = readWorkerFailureContext(state);
	if (code === WORKER_STATUS_MEMORY_OOB) {
		return `browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds${context}`;
	}
	if (code === WORKER_STATUS_UNALIGNED) {
		return `browser rustc helper thread failed before producing LLVM bitcode: operation does not support unaligned accesses${context}`;
	}
	if (code === WORKER_STATUS_UNREACHABLE) {
		return `browser rustc helper thread failed before producing LLVM bitcode: unreachable${context}`;
	}
	return `browser rustc helper thread failed before producing LLVM bitcode${context}`;
}
