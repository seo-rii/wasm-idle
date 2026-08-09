import { describe, expect, it } from 'vitest';

import { BUNDLED_ELIXIR_ASSET_RECEIPTS, snapshotElixirRuntimeAssetReceipts } from '../src/index.js';

describe('Elixir language server asset receipts', () => {
	it('copies and deeply freezes the exact runtime asset set', () => {
		const source = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS);
		const snapshot = snapshotElixirRuntimeAssetReceipts(source);
		source['bundle.avm'].uncompressedBytes = 1;

		expect(snapshot['bundle.avm'].uncompressedBytes).toBe(
			BUNDLED_ELIXIR_ASSET_RECEIPTS['bundle.avm'].uncompressedBytes
		);
		expect(snapshot).not.toBe(source);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['AtomVM.mjs'])).toBe(true);
	});

	it('rejects missing, extra, and malformed receipts', () => {
		const missing = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS) as Record<string, unknown>;
		delete missing['AtomVM.wasm'];
		expect(() => snapshotElixirRuntimeAssetReceipts(missing as never)).toThrow(
			'exactly three asset receipts'
		);

		const extra = {
			...structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS),
			'unexpected.bin': BUNDLED_ELIXIR_ASSET_RECEIPTS['bundle.avm']
		};
		expect(() => snapshotElixirRuntimeAssetReceipts(extra as never)).toThrow(
			'exactly three asset receipts'
		);

		const malformed = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS);
		malformed['bundle.avm'].uncompressedSha256 = 'nope';
		expect(() => snapshotElixirRuntimeAssetReceipts(malformed)).toThrow(
			'invalid for bundle.avm'
		);
	});
});
