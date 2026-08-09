import { describe, expect, it } from 'vitest';
import {
	snapshotFortranExecutionAssetReceipts,
	type FortranExecutionAssetReceipts
} from './fortranAssets';

const receipt = (seed: string) => ({
	bytes: 3,
	sha256: seed.repeat(64)
});

const fixture = () =>
	({
		'f2c.wasm': receipt('a'),
		'libf2c.a': receipt('b'),
		'f2c.h': receipt('c')
	}) satisfies FortranExecutionAssetReceipts;

describe('Fortran execution asset receipts', () => {
	it('copies and deeply freezes the exact execution asset set', () => {
		const source = fixture();
		const snapshot = snapshotFortranExecutionAssetReceipts(source);
		(source['f2c.wasm'] as { bytes: number }).bytes = 99;

		expect(snapshot['f2c.wasm'].bytes).toBe(3);
		expect(snapshot).not.toBe(source);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['libf2c.a'])).toBe(true);
	});

	it('rejects missing, extra, and malformed receipts', () => {
		const missing = fixture() as Record<string, unknown>;
		delete missing['f2c.h'];
		expect(() => snapshotFortranExecutionAssetReceipts(missing as never)).toThrow(
			'exactly three asset receipts'
		);

		const extra = { ...fixture(), 'unexpected.bin': receipt('d') };
		expect(() => snapshotFortranExecutionAssetReceipts(extra as never)).toThrow(
			'exactly three asset receipts'
		);

		const malformed = fixture();
		(malformed['libf2c.a'] as { bytes: number }).bytes = 0;
		expect(() => snapshotFortranExecutionAssetReceipts(malformed)).toThrow(
			'invalid for libf2c.a'
		);
	});
});
