import type { CompileWorkerFailureKind } from './worker-protocol.js';

export function classifyRetryableFailureKind(
	detail: string | null | undefined
): CompileWorkerFailureKind | null {
	if (!detail) {
		return null;
	}
	const normalized = detail.toLowerCase();
	if (
		normalized.includes('worker script error') ||
		normalized.includes('failed to fetch dynamically imported module') ||
		normalized.includes('importing a module script failed')
	) {
		return 'worker-bootstrap';
	}
	if (normalized.includes('browser rustc timed out before producing llvm bitcode')) {
		return 'compile-timeout';
	}
	if (normalized.includes('browser rustc helper thread failed before producing llvm bitcode')) {
		return 'helper-thread';
	}
	if (normalized.includes('rustc browser thread pool exhausted')) {
		return 'thread-pool-exhausted';
	}
	if (
		normalized.includes('memory access out of bounds') ||
		normalized.includes('operation does not support unaligned accesses') ||
		normalized.includes('unreachable')
	) {
		return 'runtime-trap';
	}
	if (
		normalized.includes('invalid enum variant tag while decoding') ||
		normalized.includes('found invalid metadata files for crate') ||
		normalized.includes('failed to parse rlib') ||
		normalized.includes("can't find crate for `std`")
	) {
		return 'stale-runtime-metadata';
	}
	if (normalized.includes('the compiler unexpectedly panicked')) {
		return 'compiler-panicked';
	}
	return null;
}
