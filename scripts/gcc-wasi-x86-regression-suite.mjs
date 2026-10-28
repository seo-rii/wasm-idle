#!/usr/bin/env node
// Preserve the producer's real x86 suite, adding libc/libm and multiple source
// cases. Run the resulting suite with scripts/verify-x86-cross-gcc.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases as wasiCases } from './gcc-wasi-fixtures.mjs';

const [sourceDirectory, outputDirectory] = process.argv.slice(2);
assert(
	sourceDirectory && outputDirectory,
	'Usage: node scripts/gcc-wasi-x86-regression-suite.mjs PRODUCER_QUALIFICATION_DIR NEW_SUITE_DIR'
);
const source = await fs.realpath(sourceDirectory);
const output = path.resolve(outputDirectory);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
await fs.mkdir(path.join(output, 'fixtures'));
const { cases } = await import(pathToFileURL(path.join(source, 'cases.mjs')));
for (const fixture of new Set(cases.map((entry) => entry.fixture)))
	await fs.copyFile(
		path.join(source, 'fixtures', fixture),
		path.join(output, 'fixtures', fixture)
	);
await fs.copyFile(path.join(source, 'assertions.mjs'), path.join(output, 'assertions.mjs'));
const combined = [...cases];
for (const id of ['c-libm', 'c-multiple', 'cpp-stl-multiple']) {
	const selected = wasiCases.find((entry) => entry.id === id);
	const { code, ...request } = selected.request;
	const fixture = `regression-${id}.${request.language === 'cpp' ? 'cpp' : 'c'}`;
	await fs.writeFile(path.join(output, 'fixtures', fixture), code);
	combined.push({
		id: `regression-${id}`,
		fixture,
		request: { ...request, cpu: 'x86-64' },
		stdin: selected.stdin,
		stdout: selected.stdout
	});
}
await fs.writeFile(
	path.join(output, 'cases.mjs'),
	`export const cases = ${JSON.stringify(combined, null, 2)};\n`
);
console.log(JSON.stringify({ output, cases: combined.length, additionalCases: 3 }));
