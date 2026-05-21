import { describe, expect, it } from 'vitest';

import { classifyRetryableFailureKind } from '../src/retryable-failure-kind.js';

describe('classifyRetryableFailureKind', () => {
	it('classifies stale runtime metadata panics into a structured retry kind', () => {
		expect(
			classifyRetryableFailureKind(
				[
					'error[E0786]: found invalid metadata files for crate `core` which `std` depends on',
					"thread 'main' panicked at invalid enum variant tag while decoding `TargetTriple`",
					'error: the compiler unexpectedly panicked. this is a bug.'
				].join('\n')
			)
		).toBe('stale-runtime-metadata');
	});

	it('classifies wasm runtime traps into a structured retry kind', () => {
		expect(classifyRetryableFailureKind('memory access out of bounds')).toBe('runtime-trap');
		expect(classifyRetryableFailureKind('operation does not support unaligned accesses')).toBe(
			'runtime-trap'
		);
	});
});
