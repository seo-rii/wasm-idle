import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptClangReport } from './adapt-clang-report.mjs';

test('does not substitute a later output timestamp for an unmeasured earlier output', () => {
	const workloads = ['first', 'second'].map((name) => ({ name, language: 'C', source: 'int main(){}', expected: name }));
	const report = { chromium: 'synthetic fixture', runs: 1, samples: ['empty-cache', 'persistent-reload', 'warm'].map((phase) => ({
		family: 'compiler', name: 'baseline', profile: 'unconstrained', phase, run: 0,
		transferPayloadBytes: 100, result: { preparationMs: 1, totalMs: 10,
			results: workloads.map((w, i) => ({ name: w.name, stdout: w.expected, compileLinkMs: 1,
				executeMs: 1, emittedBytes: 8, ...(i ? { firstOutputMs: 7 } : {}) })) }
	})) };
	const result = adaptClangReport(report, { compiler: { baseline: { workloads } } }, {
		revision: 'a'.repeat(40), device: 'fixture', variant: 'baseline', profiles: ['unconstrained']
	});
	assert.ok(result.samples.every((sample) => sample.ok && sample.firstOutputMs === undefined));
});
