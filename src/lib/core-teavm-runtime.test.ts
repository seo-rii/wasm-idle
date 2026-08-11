import {
	TEAVM_RUNTIME_ASSET_NAMES,
	TEAVM_RUNTIME_ASSET_RECEIPTS,
	snapshotTeaVmRuntimeAssetReceipts
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

describe('Core TeaVM runtime receipts', () => {
	it('publishes an exact detached and deeply immutable four-asset snapshot', () => {
		const input = Object.fromEntries(
			TEAVM_RUNTIME_ASSET_NAMES.map((asset) => [
				asset,
				{ ...TEAVM_RUNTIME_ASSET_RECEIPTS[asset] }
			])
		);
		const snapshot = snapshotTeaVmRuntimeAssetReceipts(input);
		(input['compiler.wasm'] as { bytes: number }).bytes = 1;

		expect(snapshot).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(snapshot).not.toBe(input);
		expect(snapshot['compiler.wasm']).not.toBe(input['compiler.wasm']);
		expect(Object.isFrozen(snapshot)).toBe(true);
		for (const asset of TEAVM_RUNTIME_ASSET_NAMES) {
			expect(Object.isFrozen(snapshot[asset])).toBe(true);
		}
	});

	it('captures every caller-owned receipt and field exactly once', () => {
		const receiptGetters = new Map<string, ReturnType<typeof vi.fn>>();
		const fieldGetters = new Map<string, ReturnType<typeof vi.fn>>();
		const input = Object.create(null) as Record<string, unknown>;
		for (const asset of TEAVM_RUNTIME_ASSET_NAMES) {
			const expected = TEAVM_RUNTIME_ASSET_RECEIPTS[asset];
			const bytes = vi.fn(() => expected.bytes);
			const sha256 = vi.fn(() => expected.sha256);
			const receipt = Object.defineProperties(
				{},
				{
					bytes: { enumerable: true, get: bytes },
					sha256: { enumerable: true, get: sha256 }
				}
			);
			const getter = vi.fn(() => receipt);
			Object.defineProperty(input, asset, { enumerable: true, get: getter });
			receiptGetters.set(asset, getter);
			fieldGetters.set(`${asset}:bytes`, bytes);
			fieldGetters.set(`${asset}:sha256`, sha256);
		}

		expect(snapshotTeaVmRuntimeAssetReceipts(input)).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		for (const getter of receiptGetters.values()) expect(getter).toHaveBeenCalledOnce();
		for (const getter of fieldGetters.values()) expect(getter).toHaveBeenCalledOnce();
	});

	it.each([
		null,
		{},
		{ ...TEAVM_RUNTIME_ASSET_RECEIPTS, unexpected: { bytes: 1, sha256: 'a'.repeat(64) } },
		{
			...TEAVM_RUNTIME_ASSET_RECEIPTS,
			'compiler.wasm': { bytes: 0, sha256: 'a'.repeat(64) }
		},
		{
			...TEAVM_RUNTIME_ASSET_RECEIPTS,
			'compiler.wasm-runtime.js': { bytes: 1, sha256: 'A'.repeat(64) }
		}
	])('rejects malformed or widened receipt sets', (value) => {
		expect(() => snapshotTeaVmRuntimeAssetReceipts(value)).toThrow('TeaVM runtime');
	});
});
