#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compareExperiments } from './runtime-experiments.mjs';

const phases = ['empty-cache', 'persistent-reload', 'warm'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => hash(JSON.stringify(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function number(value, label, integer = false) {
	if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value)))
		throw new Error(`Invalid ${label}`);
	return value;
}

/** Adapt a recorded compiler suite, never manufacture per-program transfer measurements. */
export function adaptClangReport(report, fixtures, context) {
	if (!report || !text(report.chromium) || !Number.isSafeInteger(report.runs) ||
		report.runs < 1 || report.runs > 1000 || !Array.isArray(report.samples))
		throw new Error('A recorded Chromium report with bounded repeat count is required');
	if (!context || !/^[0-9a-f]{40}$/.test(context.revision ?? '') || !text(context.device) ||
		!text(context.variant) || !Array.isArray(context.profiles) || !context.profiles.length ||
		context.profiles.some((name) => !['unconstrained', 'constrained'].includes(name)) ||
		new Set(context.profiles).size !== context.profiles.length)
		throw new Error('Explicit revision, device, compiler variant and unique planned profiles are required');
	const workloads = fixtures?.compiler?.[context.variant]?.workloads;
	if (!Array.isArray(workloads) || !workloads.length || workloads.length > 1000)
		throw new Error('Selected compiler fixture must contain its original workload definitions');
	const names = new Set();
	const identity = workloads.map((workload) => {
		if (!text(workload.name) || names.has(workload.name) || !['C', 'CPP'].includes(workload.language) ||
			typeof workload.source !== 'string' || typeof workload.expected !== 'string' ||
			(workload.args !== undefined && (!Array.isArray(workload.args) || workload.args.some((arg) => typeof arg !== 'string'))) ||
			(workload.standard !== undefined && typeof workload.standard !== 'string'))
			throw new Error('Invalid or duplicate compiler workload');
		names.add(workload.name);
		return [workload.name, workload.language, workload.source, workload.args ?? [], workload.standard ?? null, workload.expected];
	});
	const workloadKey = `clang-suite:${digest(identity)}`;
	const network = Object.fromEntries(context.profiles.map((profile) => {
		if (profile === 'unconstrained') return [profile, { aggregateBytesPerSecond: null, requestLatencyMs: 0 }];
		const shaping = report.shaping?.constrained;
		if (!shaping || !(number(shaping.aggregateBytesPerSecond, 'aggregate link rate') > 0))
			throw new Error('Constrained link metadata is required');
		return [profile, { aggregateBytesPerSecond: shaping.aggregateBytesPerSecond,
			requestLatencyMs: number(shaping.requestLatencyMs, 'request latency') }];
	}));
	const selected = report.samples.filter((sample) => sample?.family === 'compiler' && sample.name === context.variant);
	const observed = new Map();
	for (const sample of selected) {
		if (!context.profiles.includes(sample.profile) || !phases.includes(sample.phase) ||
			!Number.isSafeInteger(sample.run) || sample.run < 0 || sample.run >= report.runs)
			throw new Error('Observed sample falls outside the declared matrix');
		const key = JSON.stringify([sample.profile, sample.phase, sample.run]);
		if (observed.has(key)) throw new Error('Duplicate recorded compiler sample');
		observed.set(key, sample);
	}
	const samples = [];
	for (const profile of context.profiles) for (const phase of phases) for (let repeat = 0; repeat < report.runs; repeat++) {
		const recorded = observed.get(JSON.stringify([profile, phase, repeat]));
		const sample = { workload: workloadKey, profile: `${profile}:${digest(network[profile])}`, phase, repeat, ok: false };
		samples.push(sample);
		if (!recorded) {
			sample.failure = { kind: 'not-recorded', message: 'Planned observation missing; execution status unknown' };
			continue;
		}
		sample.transferredBytes = number(recorded.transferPayloadBytes, 'suite transfer bytes', true);
		const result = recorded.result;
		if (!result || typeof result !== 'object') throw new Error('Missing compiler result object');
		if (result.error !== undefined) {
			if (!text(result.error)) throw new Error('Invalid recorded error');
			sample.failure = { kind: 'recorded-error', message: result.error };
			continue;
		}
		if (!Array.isArray(result.results) || result.results.length !== workloads.length)
			throw new Error('Incomplete successful suite; workload coverage cannot be inferred');
		sample.preparationMs = number(result.preparationMs, 'preparation duration');
		sample.totalMs = number(result.totalMs, 'suite duration');
		sample.compileLinkMs = 0; sample.executeMs = 0; sample.emittedBytes = 0;
		const outputs = [], firstOutputs = [];
		let firstOutputIncomplete = false;
		for (let index = 0; index < workloads.length; index++) {
			const row = result.results[index], workload = workloads[index];
			if (!row || row.name !== workload.name || typeof row.stdout !== 'string')
				throw new Error('Recorded workload order/name/output differs from the original fixture');
			outputs.push([row.name, row.stdout]);
			sample.compileLinkMs += number(row.compileLinkMs, 'compile/link duration');
			sample.executeMs += number(row.executeMs, 'execution duration');
			sample.emittedBytes += number(row.emittedBytes, 'emitted bytes', true);
			if (row.firstOutputMs !== undefined) firstOutputs.push(number(row.firstOutputMs, 'first output duration'));
			else if (row.stdout !== '') firstOutputIncomplete = true;
			if (row.stdout !== workload.expected) sample.failure = { kind: 'output-mismatch', message: `Output mismatch for ${row.name}` };
		}
		for (const metric of ['compileLinkMs', 'executeMs', 'emittedBytes'])
			number(sample[metric], `aggregate ${metric}`, metric === 'emittedBytes');
		if (firstOutputs.length && !firstOutputIncomplete) sample.firstOutputMs = Math.min(...firstOutputs);
		sample.outputSha256 = digest(outputs);
		sample.ok = !sample.failure;
	}
	const normalized = {
		schemaVersion: 1, measurementKind: 'browser', browser: `Chromium ${report.chromium}`,
		revision: context.revision, device: context.device, samples,
		provenance: {
			adapter: 'clang-suite-v1', variant: context.variant,
			reportJsonSha256: digest(report), workloadSha256: digest(identity), network,
			selectedRecordedSamples: selected.length, excludedOtherSamples: report.samples.length - selected.length,
			binding: 'operator-supplied revision/device/fixtures; original runner did not record a cryptographic binding',
			measurementScope: 'ordered compiler suite; transferred bytes are aggregate payload bytes, not wire bytes or per-program bytes',
			limitations: ['No browser execution is performed by this adapter', 'Missing observations are not-recorded, not observed execution failures', 'No peak memory is inferred', 'clangd is excluded because its report lacks exact semantic completion payloads']
		}
	};
	compareExperiments(normalized, normalized);
	return normalized;
}

export async function main(args) {
	if (args.length !== 4) throw new Error('Usage: adapt-clang-report.mjs report.json fixtures.json context.json normalized.json');
	const [reportBytes, fixtureBytes, contextBytes] = await Promise.all(args.slice(0, 3).map((file) => readFile(file)));
	const normalized = adaptClangReport(JSON.parse(reportBytes), JSON.parse(fixtureBytes), JSON.parse(contextBytes));
	normalized.provenance.inputFileSha256 = [reportBytes, fixtureBytes, contextBytes].map(hash);
	await writeFile(args[3], JSON.stringify(normalized, null, 2) + '\n');
	return normalized.samples.every((sample) => sample.ok) ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
		console.error(error.message); process.exitCode = 1;
	});
}
