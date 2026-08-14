import {
	HASKELL_RUNTIME_ASSET_NAMES,
	HASKELL_RUNTIME_ASSET_RECEIPTS,
	snapshotHaskellRuntimeAssetReceipts
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

describe('Core Haskell runtime receipts', () => {
	it('publishes an exact detached and deeply immutable three-asset snapshot', () => {
		const input = Object.fromEntries(
			HASKELL_RUNTIME_ASSET_NAMES.map((asset) => [
				asset,
				{ ...HASKELL_RUNTIME_ASSET_RECEIPTS[asset] }
			])
		);

		const snapshot = snapshotHaskellRuntimeAssetReceipts(input);
		(input['dyld.mjs'] as { bytes: number }).bytes = 1;

		expect(snapshot).toEqual(HASKELL_RUNTIME_ASSET_RECEIPTS);
		expect(Object.isFrozen(HASKELL_RUNTIME_ASSET_RECEIPTS)).toBe(true);
		expect(snapshot).not.toBe(input);
		expect(Object.isFrozen(snapshot)).toBe(true);
		for (const asset of HASKELL_RUNTIME_ASSET_NAMES) {
			expect(Object.isFrozen(HASKELL_RUNTIME_ASSET_RECEIPTS[asset])).toBe(true);
			expect(Object.isFrozen(snapshot[asset])).toBe(true);
		}
	});

	it('captures every untrusted receipt and field exactly once', () => {
		const receiptGetters: ReturnType<typeof vi.fn>[] = [];
		const fieldGetters: ReturnType<typeof vi.fn>[] = [];
		const input = Object.defineProperties(
			{},
			Object.fromEntries(
				HASKELL_RUNTIME_ASSET_NAMES.map((asset) => {
					const bytes = vi.fn(() => HASKELL_RUNTIME_ASSET_RECEIPTS[asset].bytes);
					const sha256 = vi.fn(() => HASKELL_RUNTIME_ASSET_RECEIPTS[asset].sha256);
					const receipt = Object.defineProperties(
						{},
						{
							bytes: { enumerable: true, get: bytes },
							sha256: { enumerable: true, get: sha256 }
						}
					);
					const getter = vi.fn(() => receipt);
					receiptGetters.push(getter);
					fieldGetters.push(bytes, sha256);
					return [asset, { enumerable: true, get: getter }];
				})
			)
		);

		expect(snapshotHaskellRuntimeAssetReceipts(input)).toEqual(HASKELL_RUNTIME_ASSET_RECEIPTS);
		expect(receiptGetters.map((getter) => getter.mock.calls.length)).toEqual([1, 1, 1]);
		expect(fieldGetters.map((getter) => getter.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
	});

	it.each([
		null,
		{},
		{ ...HASKELL_RUNTIME_ASSET_RECEIPTS, extra: { bytes: 1, sha256: 'a'.repeat(64) } },
		{
			...HASKELL_RUNTIME_ASSET_RECEIPTS,
			'dyld.mjs': { bytes: 0, sha256: 'a'.repeat(64) }
		},
		{
			...HASKELL_RUNTIME_ASSET_RECEIPTS,
			'bsdtar.wasm': { bytes: 1, sha256: 'A'.repeat(64) }
		}
	])('rejects malformed or widened receipt sets', (value) => {
		expect(() => snapshotHaskellRuntimeAssetReceipts(value)).toThrow('Haskell runtime');
	});
});
