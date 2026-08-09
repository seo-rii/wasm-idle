import { describe, expect, it } from 'vitest';
import {
	snapshotElixirRuntimeAssetReceipts,
	type ElixirRuntimeAssetReceipts
} from './elixirAssets';

const receipt = (seed: string) => ({
	bytes: 3,
	sha256: seed.repeat(64),
	uncompressedBytes: 5,
	uncompressedSha256: seed.repeat(64)
});

const fixture = () =>
	({
		'bundle.avm': receipt('a'),
		'AtomVM.mjs': receipt('b'),
		'AtomVM.wasm': receipt('c')
	}) satisfies ElixirRuntimeAssetReceipts;

describe('Elixir runtime asset receipts', () => {
	it('copies and deeply freezes the exact compiler asset set', () => {
		const source = fixture();
		const snapshot = snapshotElixirRuntimeAssetReceipts(source);
		(source['bundle.avm'] as { bytes: number }).bytes = 99;

		expect(snapshot['bundle.avm'].bytes).toBe(3);
		expect(snapshot).not.toBe(source);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['AtomVM.mjs'])).toBe(true);
	});

	it('rejects missing, extra, and malformed receipts', () => {
		const missing = fixture() as Record<string, unknown>;
		delete missing['AtomVM.wasm'];
		expect(() => snapshotElixirRuntimeAssetReceipts(missing as never)).toThrow(
			'exactly three asset receipts'
		);

		const extra = { ...fixture(), 'unexpected.bin': receipt('d') };
		expect(() => snapshotElixirRuntimeAssetReceipts(extra as never)).toThrow(
			'exactly three asset receipts'
		);

		const malformed = fixture();
		(malformed['bundle.avm'] as { uncompressedBytes: number }).uncompressedBytes = 0;
		expect(() => snapshotElixirRuntimeAssetReceipts(malformed)).toThrow(
			'invalid for bundle.avm'
		);
	});
});
