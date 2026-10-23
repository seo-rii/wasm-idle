import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, brotliDecompressSync } from 'node:zlib';
import { prepareAsset, summarize } from './brotli-q5.mjs';

const raw = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const gzip = gzipSync(raw);
const sha = (x) => createHash('sha256').update(x).digest('hex');
const receipt = {
	encoding: 'gzip',
	bytes: gzip.length,
	sha256: sha(gzip),
	uncompressedBytes: raw.length,
	uncompressedSha256: sha(raw)
};
test('compares the pinned gzip representation and verifies Brotli round trip', () => {
	const result = prepareAsset('fixture', gzip, receipt);
	assert.equal(result.gzip, gzip);
	assert.deepEqual(brotliDecompressSync(result.brotli), raw);
	assert.equal(result.metadata.wasm, true);
});
test('fails closed for stale bytes, corrupt decoded identity and unbounded size', () => {
	assert.throws(() => prepareAsset('fixture', Buffer.alloc(gzip.length), receipt), /Encoded SHA/);
	assert.throws(
		() => prepareAsset('fixture', gzip, { ...receipt, uncompressedSha256: '0'.repeat(64) }),
		/Decoded SHA/
	);
	assert.throws(
		() => prepareAsset('fixture', gzip, { ...receipt, uncompressedBytes: 1024 ** 3 }),
		/Invalid decoded/
	);
});
test('summary keeps failures, skips and warm/cold phases separate without zero-fill', () => {
	const base = {
		asset: 'x',
		network: 'loopback',
		transport: 'http',
		encoding: 'brotli',
		phase: 'cold-fetch'
	};
	const groups = summarize([
		{ ...base, ok: true, totalMs: 8, decodeMs: null },
		{ ...base, ok: true, totalMs: 12 },
		{ ...base, ok: false, error: 'failure' },
		{ ...base, ok: false, skipped: 'unsupported' },
		{ ...base, phase: 'warm-buffer', ok: true, totalMs: 2 }
	]);
	assert.equal(groups[0].metrics.totalMs.median, 10);
	assert.equal(groups[0].metrics.decodeMs.median, null);
	assert.equal(groups[0].failures, 1);
	assert.equal(groups[0].skipped, 1);
	assert.equal(groups[1].metrics.totalMs.median, 2);
});
