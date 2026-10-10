import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adaptClangReport, main } from './adapt-clang-report.mjs';
import { compareExperiments } from './runtime-experiments.mjs';
function fixture() {
	const workloads = ['c', 'cpp'].map((name) => ({ name, language: name === 'c' ? 'C' : 'CPP', source: 'int main(){}', expected: `${name}\n` }));
	const fixtures = { compiler: { baseline: { workloads } } };
	const context = { revision: 'a'.repeat(40), device: 'fixture-only', variant: 'baseline', profiles: ['unconstrained'] };
	const report = { chromium: 'test-fixture', runs: 1, samples: ['empty-cache', 'persistent-reload', 'warm'].map((phase) => ({
		family: 'compiler', name: 'baseline', profile: 'unconstrained', run: 0, phase, transferPayloadBytes: 100,
		result: { preparationMs: 5, totalMs: 30, results: workloads.map((workload, index) => ({ name: workload.name, stdout: workload.expected,
			compileLinkMs: 10, executeMs: 2, firstOutputMs: 16 + index * 12, emittedBytes: 8 })) }
	})) };
	return { report, fixtures, context };
}
const convert = ({ report, fixtures, context }) => adaptClangReport(report, fixtures, context);

test('aggregates one compiler suite without assigning its transfer bytes twice', () => {
	const result = convert(fixture());
	assert.equal(result.samples.length, 3);
	assert.deepEqual(result.samples.map((s) => [s.compileLinkMs, s.executeMs, s.emittedBytes, s.transferredBytes, s.firstOutputMs]), [[20,4,16,100,16],[20,4,16,100,16],[20,4,16,100,16]]);
	assert.equal(result.samples[0].peakMemoryBytes, undefined);
	assert.equal(compareExperiments(result, result).comparable, true);
});
test('keeps a missing matrix observation instead of dropping it', () => {
	const f = fixture(); f.report.samples.pop(); const result = convert(f);
	assert.equal(result.samples[2].failure.kind, 'not-recorded');
	assert.equal(result.samples[2].totalMs, undefined);
	assert.equal(compareExperiments(result, result).comparable, false);
});
test('entirely missing selected variant retains the planned matrix as not recorded', () => {
	const f = fixture(); f.report.samples = []; const result = convert(f);
	assert.equal(result.samples.length, 3); assert.ok(result.samples.every((s) => !s.ok));
});
test('retains observed errors and wrong output without apparent speedup', () => {
	for (const fail of ['error', 'output']) {
		const f = fixture();
		if (fail === 'error') f.report.samples[0].result = { error: 'compile failed' };
		else f.report.samples[0].result.results[0].stdout = 'wrong';
		const report = compareExperiments(convert(fixture()), convert(f));
		assert.equal(report.comparable, false);
		assert.equal(report.comparisons.find((c) => c.phase === 'empty-cache').metrics.totalMs.percentChange, null);
	}
});
test('rejects duplicate, out-of-matrix and unbounded repeats', () => {
	for (const change of [(f) => f.report.samples.push(f.report.samples[0]), (f) => f.report.samples[0].run = 1,
		(f) => f.report.samples[0].phase = 'other', (f) => f.report.runs = 1001]) {
		const f = fixture(); change(f); assert.throws(() => convert(f));
	}
});
test('requires complete ordered work and nonnegative finite measured values', () => {
	for (const change of [(f) => f.report.samples[0].result.results.pop(), (f) => f.report.samples[0].result.results.reverse(),
		(f) => f.report.samples[0].transferPayloadBytes = -1, (f) => f.report.samples[0].result.totalMs = NaN,
		(f) => f.report.samples[0].result.results[0].emittedBytes = 1.5]) {
		const f = fixture(); change(f); assert.throws(() => convert(f));
	}
});
test('source identity and shaping settings cannot silently match different workloads', () => {
	const a = fixture(), b = fixture(); b.fixtures.compiler.baseline.workloads[0].source = 'different source';
	assert.equal(compareExperiments(convert(a), convert(b)).comparable, false);
	for (const f of [a,b]) {
		f.context.profiles = ['constrained'];
		f.report.samples.forEach((s) => s.profile = 'constrained');
		f.report.shaping = { constrained: { aggregateBytesPerSecond: 1000, requestLatencyMs: 50 } };
	}
	b.fixtures = structuredClone(a.fixtures); b.report.shaping.constrained.requestLatencyMs = 100;
	assert.equal(compareExperiments(convert(a), convert(b)).comparable, false);
});
test('missing first output stays missing and excluded clangd data is reported', () => {
	const f = fixture(); f.report.samples.forEach((s) => s.result.results.forEach((r) => delete r.firstOutputMs));
	f.report.samples.push({ family: 'clangd', name: 'baseline' });
	const result = convert(f); assert.equal(result.samples[0].firstOutputMs, undefined);
	assert.equal(result.provenance.excludedOtherSamples, 1);
});
test('requires explicit operator provenance and rejects malformed fixture metadata', () => {
	for (const change of [(f) => delete f.context.device, (f) => f.context.revision = 'main',
		(f) => f.context.profiles.push('unconstrained'), (f) => f.context.variant = 'unknown',
		(f) => f.fixtures.compiler.baseline.workloads[0].args = '@response']) {
		const f = fixture(); change(f); assert.throws(() => convert(f));
	}
});
test('CLI records hashes of actual input files and returns incomplete status without inventing measurements', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'clang-adapter-'));
	try {
		const f = fixture(); f.report.samples.pop();
		const inputs = ['report','fixtures','context'].map((name) => path.join(dir, `${name}.json`));
		await Promise.all(inputs.map((file,index) => writeFile(file, JSON.stringify([f.report,f.fixtures,f.context][index]))));
		const output = path.join(dir,'normalized.json');
		assert.equal(await main([...inputs,output]), 2);
		const result = JSON.parse(await readFile(output, 'utf8'));
		assert.equal(result.provenance.inputFileSha256.length, 3);
		assert.ok(result.provenance.inputFileSha256.every((sha) => /^[0-9a-f]{64}$/.test(sha)));
	} finally { await rm(dir,{recursive:true,force:true}); }
});
