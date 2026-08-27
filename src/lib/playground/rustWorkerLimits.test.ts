import { describe, expect, it } from 'vitest';

import {
	RUST_NON_DEBUG_MAX_ASSET_DELIVERY_BYTES,
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

	it('forwards worker ceilings and derives a bounded aggregate asset-delivery limit', () => {
		expect(
			resolveRustNonDebugResourceLimits({
				maxWorkers: 3,
				maxThreads: 7,
				maxAssetBytes: 128 * 1024 * 1024
			})
		).toEqual({
			maxWorkers: 3,
			maxThreads: 7,
			maxAssetDeliveryBytes: RUST_NON_DEBUG_MAX_ASSET_DELIVERY_BYTES,
			compilerLimits: { maxWorkers: 3, maxThreads: 7 }
		});
		expect(
			resolveRustNonDebugResourceLimits({ maxAssetBytes: 32 * 1024 * 1024 })
				.maxAssetDeliveryBytes
		).toBe(64 * 1024 * 1024);
		expect(
			resolveRustNonDebugResourceLimits({ maxAssetBytes: Number.MAX_SAFE_INTEGER })
				.maxAssetDeliveryBytes
		).toBe(RUST_NON_DEBUG_MAX_ASSET_DELIVERY_BYTES);
	});

	it.each([
		undefined,
		null,
		{},
		{ maxWorkers: 1 },
		{ maxWorkers: 0, maxThreads: 1, maxAssetBytes: 1 },
		{ maxWorkers: 1.5, maxThreads: 1, maxAssetBytes: 1 },
		{ maxWorkers: 1, maxThreads: Number.NaN, maxAssetBytes: 1 },
		{ maxWorkers: 1, maxThreads: 1, maxAssetBytes: Number.NaN },
		{ maxWorkers: 1, maxThreads: Number.MAX_SAFE_INTEGER + 1, maxAssetBytes: 1 }
	])('rejects a missing or malformed worker boundary snapshot %#', (value) => {
		expect(() => snapshotRustNonDebugResourceLimits(value)).toThrow(
			/Rust non-debug execution limit/u
		);
	});
});
