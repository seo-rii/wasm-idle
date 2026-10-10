import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { compareExperiments, inspectArtifacts } from './runtime-experiments.mjs';
const sample = (repeat, value, extra = {}) => ({ workload: 'cpp', profile: 'desktop', phase: 'warm', repeat, ok: true, outputSha256: 'a'.repeat(64), compileLinkMs: value, ...extra });
const run = (samples) => ({ measurementKind: 'browser', browser: 'Chromium test-fixture', revision: '1'.repeat(40), device: 'fixture-only', samples });

test('computes median and nearest-rank p95 without promoting the candidate', () => {
	const report = compareExperiments(run([sample(0, 10), sample(1, 30)]), run([sample(0, 5), sample(1, 15)]));
	const metric = report.comparisons[0].metrics.compileLinkMs;
	assert.equal(metric.baseline.median, 20); assert.equal(metric.baseline.p95, 30);
	assert.equal(metric.percentChange, -50);
	assert.equal(report.promotionDecision, 'manual-review-required');
});
test('cache phases are never combined', () => {
	const samples = [sample(0, 10), sample(0, 1000, { phase: 'empty-cache' })];
	assert.equal(compareExperiments(run(samples), run(samples)).comparisons.length, 2);
});
test('missing metrics stay null rather than becoming zero', () => {
	const report = compareExperiments(run([sample(0, 10)]), run([sample(0, 9)]));
	assert.deepEqual(report.comparisons[0].metrics.peakMemoryBytes.baseline, { count: 0, median: null, p95: null });
	assert.equal(report.comparisons[0].metrics.peakMemoryBytes.comparable, false);
});
test('failures are retained and disqualify relative speed claims', () => {
	const report = compareExperiments(run([sample(0, 10)]), run([sample(0, 1, { ok: false })]));
	assert.equal(report.comparable, false);
	assert.equal(report.comparisons[0].candidateFailures, 1);
	assert.equal(report.comparisons[0].metrics.compileLinkMs.percentChange, null);
});
test('different outputs disqualify a fast but incorrect candidate', () => {
	const report = compareExperiments(run([sample(0, 10)]), run([sample(0, 1, { outputSha256: 'b'.repeat(64) })]));
	assert.equal(report.comparable, false);
	assert.deepEqual(report.comparisons[0].issues, ['output-mismatch:0']);
});
test('unmatched repeats and missing workloads cannot be hidden', () => {
	const report = compareExperiments(run([sample(0, 10), sample(1, 10)]), run([sample(0, 1)]));
	assert.equal(report.comparable, false);
	assert.ok(report.comparisons[0].issues.includes('unmatched-repeats'));
});
test('rejects duplicate samples, invalid durations and missing correctness receipts', () => {
	for (const samples of [[sample(0, 1), sample(0, 2)], [sample(0, -1)], [sample(0, NaN)], [sample(0, 1, { outputSha256: null })]]) {
		assert.throws(() => compareExperiments(run(samples), run([sample(0, 1)])));
	}
});
test('rejects native or mismatched browser/device evidence', () => {
	const base = run([sample(0, 1)]);
	for (const patch of [{ measurementKind: 'node' }, { browser: 'other' }, { device: 'other' }, { revision: 'main' }, { samples: [] }]) {
		assert.throws(() => compareExperiments(base, { ...base, ...patch }));
	}
});
test('zero baseline metrics avoid infinite percentages', () => {
	const result = compareExperiments(run([sample(0, 0)]), run([sample(0, 0)]));
	assert.equal(result.comparisons[0].metrics.compileLinkMs.percentChange, null);
});
test('inventory measures actual compressed/raw bytes and hashes', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'wasm-idle-inventory-'));
	try {
		const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
		const raw = path.join(dir, 'raw.wasm'), gz = path.join(dir, 'compressed.bin');
		await writeFile(raw, bytes); await writeFile(gz, gzipSync(bytes));
		const result = await inspectArtifacts([{ name: 'raw', path: raw }, { name: 'gzip', path: gz }]);
		assert.equal(result[0].bytes, 8); assert.equal(result[1].encoding, 'gzip');
		assert.equal(result[0].sha256, result[1].uncompressedSha256);
		assert.equal(result[1].uncompressedBytes, 8); assert.equal(result[1].wasmMagic, true);
		await assert.rejects(inspectArtifacts([{ name: 'big', path: gz }], 4));
		await assert.rejects(inspectArtifacts([{ name: 'same', path: raw }, { name: 'same', path: gz }]));
		await assert.rejects(inspectArtifacts([{ name: 'missing', path: path.join(dir, 'missing') }]));
	} finally { await rm(dir, { recursive: true, force: true }); }
});
