import { describe, expect, it } from 'vitest';

import {
	markWorkerFailure,
	readWorkerFailure,
	recordWorkerFailureContext,
	WORKER_STATUS_BUFFER_BYTES
} from '../src/worker-status.js';

describe('worker failure status', () => {
	it('returns null before any helper-thread failure was recorded', () => {
		expect(readWorkerFailure(new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES))).toBeNull();
	});

	it('includes the last recorded thread context in the helper-thread failure message', () => {
		const sharedStatusBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		recordWorkerFailureContext(sharedStatusBuffer, 'pool-enter', 1234, [11, 22, 33, 44]);
		markWorkerFailure(sharedStatusBuffer, 'memory access out of bounds');

		expect(readWorkerFailure(sharedStatusBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds (pool-enter startArg=1234 words=11,22,33,44)'
		);
	});

	it('classifies generic, unaligned, and unreachable failures', () => {
		const genericBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		markWorkerFailure(genericBuffer, 'random helper panic');
		expect(readWorkerFailure(genericBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode'
		);

		const unalignedBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		markWorkerFailure(unalignedBuffer, 'operation does not support unaligned accesses');
		expect(readWorkerFailure(unalignedBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode: operation does not support unaligned accesses'
		);

		const unreachableBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		markWorkerFailure(unreachableBuffer, 'unreachable');
		expect(readWorkerFailure(unreachableBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode: unreachable'
		);
	});

	it('keeps the first failure classification even if later failures are recorded', () => {
		const sharedStatusBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		markWorkerFailure(sharedStatusBuffer, 'memory access out of bounds');
		markWorkerFailure(sharedStatusBuffer, 'operation does not support unaligned accesses');

		expect(readWorkerFailure(sharedStatusBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds'
		);
	});

	it('overwrites context before failure but preserves the captured context after failure', () => {
		const sharedStatusBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
		recordWorkerFailureContext(sharedStatusBuffer, 'thread-enter', 10, [1, 2, 3, 4]);
		recordWorkerFailureContext(sharedStatusBuffer, 'pool-enter', 20, [5, 6, 7, 8]);
		markWorkerFailure(sharedStatusBuffer, 'memory access out of bounds');
		recordWorkerFailureContext(sharedStatusBuffer, 'thread-enter', 30, [9, 10, 11, 12]);

		expect(readWorkerFailure(sharedStatusBuffer)).toBe(
			'browser rustc helper thread failed before producing LLVM bitcode: memory access out of bounds (pool-enter startArg=20 words=5,6,7,8)'
		);
	});
});
