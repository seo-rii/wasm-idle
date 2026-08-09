import { describe, expect, it } from 'vitest';
import { snapshotZigExecutionAssetReceipts, type ZigExecutionAssetReceipts } from './zigAssets';

const RECEIPTS = {
	'zig_small.wasm': {
		bytes: 4,
		sha256: 'a'.repeat(64)
	},
	'std.tar.gz': {
		bytes: 5,
		sha256: 'b'.repeat(64),
		uncompressedBytes: 10,
		uncompressedSha256: 'c'.repeat(64)
	}
} satisfies ZigExecutionAssetReceipts;

describe('Zig execution asset receipts', () => {
	it('copies and deeply freezes the exact receipt set', () => {
		const source = structuredClone(RECEIPTS);
		const snapshot = snapshotZigExecutionAssetReceipts(source);

		source['zig_small.wasm'].sha256 = 'd'.repeat(64);
		expect(snapshot['zig_small.wasm'].sha256).toBe('a'.repeat(64));
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['std.tar.gz'])).toBe(true);
	});

	it('rejects missing, extra, and malformed receipts', () => {
		const missing = { 'zig_small.wasm': RECEIPTS['zig_small.wasm'] };
		const extra = { ...RECEIPTS, unexpected: RECEIPTS['zig_small.wasm'] };
		const malformed = structuredClone(RECEIPTS);
		malformed['std.tar.gz'].uncompressedSha256 = 'invalid';

		expect(() => snapshotZigExecutionAssetReceipts(missing as never)).toThrow(
			'exactly two asset receipts'
		);
		expect(() => snapshotZigExecutionAssetReceipts(extra as never)).toThrow(
			'exactly two asset receipts'
		);
		expect(() => snapshotZigExecutionAssetReceipts(malformed)).toThrow(
			'std.tar.gz uncompressed bytes'
		);
	});

	it('rejects an uncompressed stage on the compiler receipt', () => {
		const malformed = structuredClone(RECEIPTS) as Record<string, Record<string, unknown>>;
		malformed['zig_small.wasm'].uncompressedBytes = 4;
		malformed['zig_small.wasm'].uncompressedSha256 = 'a'.repeat(64);

		expect(() => snapshotZigExecutionAssetReceipts(malformed as never)).toThrow(
			'must not declare an uncompressed compiler stage'
		);
	});
});
