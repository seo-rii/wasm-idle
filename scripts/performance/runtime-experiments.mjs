#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const phases = new Set(['empty-cache', 'persistent-reload', 'warm', 'input-only']);
const metrics = ['preparationMs', 'compileLinkMs', 'executeMs', 'firstOutputMs', 'totalMs', 'emittedBytes', 'transferredBytes', 'peakMemoryBytes'];

/** Inspect actual producer outputs, never infer gzip/network size from raw Wasm size. */
export async function inspectArtifacts(files, maxDecodedBytes = 256 * 1024 * 1024) {
	if (!Array.isArray(files) || files.length === 0) throw new Error('At least one artifact is required');
	if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 1) throw new Error('Invalid decoded artifact limit');
	const names = new Set();
	const results = [];
	for (const file of files) {
		if (!file || typeof file.name !== 'string' || !file.name || names.has(file.name) || typeof file.path !== 'string') throw new Error('Invalid or duplicate artifact');
		names.add(file.name);
		const bytes = await readFile(file.path);
		const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
		const decoded = gzip ? gunzipSync(bytes, { maxOutputLength: maxDecodedBytes }) : bytes;
		if (decoded.length > maxDecodedBytes) throw new Error('Decoded artifact exceeds limit');
		results.push({ name: file.name, path: file.path, encoding: gzip ? 'gzip' : 'identity',
			bytes: bytes.length, sha256: sha256(bytes), uncompressedBytes: decoded.length,
			uncompressedSha256: sha256(decoded),
			wasmMagic: decoded.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])) });
	}
	return results;
}

function validateRun(run) {
	if (!run || run.measurementKind !== 'browser' || typeof run.browser !== 'string' || !run.browser ||
		typeof run.revision !== 'string' || !/^[a-f0-9]{40}$/.test(run.revision) ||
		typeof run.device !== 'string' || !run.device || !Array.isArray(run.samples) || !run.samples.length) {
		throw new Error('Browser/version/revision/device and nonempty samples are required');
	}
	const seen = new Set();
	for (const sample of run.samples) {
		if (!sample || typeof sample.workload !== 'string' || !sample.workload ||
			typeof sample.profile !== 'string' || !sample.profile || !phases.has(sample.phase) ||
			!Number.isInteger(sample.repeat) || sample.repeat < 0 || typeof sample.ok !== 'boolean') throw new Error('Invalid browser sample');
		const key = JSON.stringify([sample.workload, sample.profile, sample.phase, sample.repeat]);
		if (seen.has(key)) throw new Error('Duplicate browser sample');
		seen.add(key);
		if (sample.ok && (typeof sample.outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sample.outputSha256))) throw new Error('Successful samples require verified output hashes');
		for (const name of metrics) if (sample[name] !== undefined && (!Number.isFinite(sample[name]) || sample[name] < 0)) throw new Error(`Invalid metric: ${name}`);
	}
}
const percentile = (values, p) => {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) return null;
	if (p === 0.5) {
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};
function summarize(samples, metric) {
	const values = samples.filter((s) => s.ok && s[metric] !== undefined).map((s) => s[metric]);
	return { count: values.length, median: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

/** Separate cache phases/workloads, retain failures/missing metrics, and require matched repeats. */
export function compareExperiments(baseline, candidate) {
	validateRun(baseline); validateRun(candidate);
	if (baseline.browser !== candidate.browser || baseline.device !== candidate.device) throw new Error('Browser and device must match');
	const group = (sample) => JSON.stringify([sample.workload, sample.profile, sample.phase]);
	const groups = new Set([...baseline.samples, ...candidate.samples].map(group));
	const comparisons = [];
	let comparable = true;
	for (const key of [...groups].sort()) {
		const a = baseline.samples.filter((s) => group(s) === key);
		const b = candidate.samples.filter((s) => group(s) === key);
		const [workload, profile, phase] = JSON.parse(key);
		const issues = [];
		const indices = (items) => items.map((s) => s.repeat).sort((x, y) => x - y);
		if (JSON.stringify(indices(a)) !== JSON.stringify(indices(b))) issues.push('unmatched-repeats');
		if (a.some((s) => !s.ok) || b.some((s) => !s.ok)) issues.push('execution-failure');
		for (const left of a) {
			const right = b.find((s) => s.repeat === left.repeat);
			if (left.ok && right?.ok && left.outputSha256 !== right.outputSha256) issues.push(`output-mismatch:${left.repeat}`);
		}
		const values = {};
		for (const metric of metrics) {
			const left = summarize(a, metric), right = summarize(b, metric);
			if (left.count !== a.length || right.count !== b.length) {
				values[metric] = { baseline: left, candidate: right, percentChange: null, comparable: false };
				continue;
			}
			values[metric] = { baseline: left, candidate: right,
				percentChange: !issues.length && left.median !== null && right.median !== null && left.median > 0
					? (right.median / left.median - 1) * 100 : null,
				comparable: issues.length === 0 && a.length > 0 && b.length > 0 };
		}
		comparable &&= issues.length === 0;
		comparisons.push({ workload, profile, phase, baselineSamples: a.length, candidateSamples: b.length,
			baselineFailures: a.filter((s) => !s.ok).length, candidateFailures: b.filter((s) => !s.ok).length,
			issues, metrics: values });
	}
	return { schemaVersion: 1, measurementKind: 'browser', browser: baseline.browser, device: baseline.device,
		baselineRevision: baseline.revision, candidateRevision: candidate.revision, comparable, comparisons,
		promotionDecision: 'manual-review-required' };
}

export async function main(args) {
	const [command, first, second, output] = args;
	if (command === 'inventory' && first && second && !output) {
		await writeFile(second, JSON.stringify({ schemaVersion: 1, artifacts: await inspectArtifacts(JSON.parse(await readFile(first, 'utf8'))) }, null, 2) + '\n');
		return;
	}
	if (command === 'compare' && first && second && output) {
		const report = compareExperiments(JSON.parse(await readFile(first, 'utf8')), JSON.parse(await readFile(second, 'utf8')));
		await writeFile(output, JSON.stringify(report, null, 2) + '\n');
		if (!report.comparable) process.exitCode = 2;
		return;
	}
	throw new Error('Usage: runtime-experiments.mjs inventory files.json output.json | compare baseline.json candidate.json output.json');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
