import { describe, expect, it } from 'vitest';

import {
	RUST_NON_DEBUG_RESOURCE_REQUIREMENTS,
	resolveRustNonDebugResourceLimits,
	snapshotRustNonDebugResourceLimits
} from './rustWorkerLimits';

describe('Rust non-debug resource limits', () => {
	it('keeps the page resource profile at one compiler worker and four helper threads', () => {
		expect(RUST_NON_DEBUG_RESOURCE_REQUIREMENTS).toEqual({
			maxWorkers: 1,
			maxThreads: 4
		});
	});

	it('forwards the resolved Core worker and thread ceilings without widening them', () => {
		expect(resolveRustNonDebugResourceLimits({ maxWorkers: 3, maxThreads: 7 })).toEqual({
			maxWorkers: 3,
			maxThreads: 7,
			compilerLimits: { maxWorkers: 3, maxThreads: 7 }
		});
	});

	it.each([
		undefined,
		null,
		{},
		{ maxWorkers: 1 },
		{ maxWorkers: 0, maxThreads: 1 },
		{ maxWorkers: 1.5, maxThreads: 1 },
		{ maxWorkers: 1, maxThreads: Number.NaN },
		{ maxWorkers: 1, maxThreads: Number.MAX_SAFE_INTEGER + 1 }
	])('rejects a missing or malformed worker boundary snapshot %#', (value) => {
		expect(() => snapshotRustNonDebugResourceLimits(value)).toThrow(
			/Rust non-debug execution limit/u
		);
	});
});
