#!/usr/bin/env node
// Fixture/reference validation only: host GCC is x86-64, Clang is wasm32-wasi.
// A passing reference report never qualifies the experimental GCC Wasm backend.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, inspectWasm, runNodeWasi } from './gcc-wasi-artifact.mjs';
import { selectCases } from './gcc-wasi-fixtures.mjs';

const [clang, requestedOutput, selection] = process.argv.slice(2);
assert(
	clang && requestedOutput,
	'Usage: node scripts/verify-gcc-wasi-references.mjs /absolute/wasi-sdk/bin/clang NEW_OUTPUT [CASE_IDS]'
);
assert(path.isAbsolute(clang), 'Use an explicit WASI SDK compiler path');
const output = path.resolve(requestedOutput);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const run = (command, argv, extra = {}) => {
	const result = spawnSync(command, argv, {
		encoding: 'utf8',
		timeout: 60_000,
		maxBuffer: 1024 * 1024,
		...extra
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, `${command}: ${result.stderr}`);
	return result;
};
const report = {
	kind: 'gcc-wasi-fixture-references-only',
	note: 'GCC host-native and Clang/WASI references; this is not GCC WebAssembly output qualification.',
	host: {
		compiler: run('gcc', ['--version']).stdout.split('\n')[0],
		target: run('gcc', ['-dumpmachine']).stdout.trim()
	},
	wasi: { compiler: run(clang, ['--version']).stdout.split('\n')[0], target: 'wasm32-wasi' },
	cases: [],
	success: false
};
const wasiProvenance = {
	compiler: { family: 'clang', version: report.wasi.compiler },
	target: 'wasm32-wasi',
	host: 'native',
	referenceOnly: true,
	programs: {}
};
try {
	for (const fixture of selectCases(selection)) {
		const directory = path.join(output, fixture.id);
		await fs.mkdir(directory);
		const source = fixture.request.language === 'cpp' ? 'main.cpp' : 'main.c';
		await fs.writeFile(path.join(directory, source), fixture.request.code);
		for (const file of fixture.request.files || []) {
			await fs.mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
			await fs.writeFile(path.join(directory, file.path), file.contents);
		}
		const flags = [
			`-O${fixture.request.optimization}`,
			`-std=${fixture.request.standard}`,
			...(fixture.request.defines || []).map((definition) => `-D${definition}`)
		];
		if (fixture.request.language === 'cpp') flags.push('-fno-exceptions', '-fno-rtti');
		const inputs = [source, ...(fixture.request.sources || [])];
		const nativeArgv = [...flags, ...inputs, '-o', 'native.elf', '-lm'];
		run(fixture.request.language === 'cpp' ? 'g++' : 'gcc', nativeArgv, { cwd: directory });
		const native = run(path.join(directory, 'native.elf'), [], { input: fixture.stdin });
		const expected = fixture.id === 'c-wasm32-abi' ? '8 4 8 8 4 8 8 8 16 1\n' : fixture.stdout;
		assert.equal(native.stdout, expected, `${fixture.id}: native fixture oracle`);
		const entry = {
			id: fixture.id,
			fixtureSha256: digest(JSON.stringify(fixture)),
			native: { argv: nativeArgv, stdout: native.stdout, success: true }
		};
		report.cases.push(entry);
		if (fixture.clangReference === false) {
			entry.wasi = {
				status: 'not-applicable',
				reason: 'Fixture intentionally rejects __clang__ and requires GCC frontend identity.'
			};
			continue;
		}
		const wasmArgv = [...flags, ...inputs, '-o', 'reference.wasm', '-lm'];
		run(fixture.request.language === 'cpp' ? `${clang}++` : clang, wasmArgv, {
			cwd: directory
		});
		const wasm = path.join(directory, 'reference.wasm');
		const bytes = await fs.readFile(wasm);
		entry.wasi = {
			argv: wasmArgv,
			artifact: inspectWasm(bytes),
			execution: runNodeWasi(wasm, fixture),
			success: true
		};
		wasiProvenance.programs[fixture.id] = {
			path: `${fixture.id}/reference.wasm`,
			bytes: bytes.length,
			sha256: digest(bytes)
		};
	}
	report.success = true;
} catch (error) {
	report.error = String(error?.stack || error);
	process.exitCode = 1;
} finally {
	await fs.writeFile(
		path.join(output, 'clang-reference-provenance.json'),
		JSON.stringify(wasiProvenance, null, 2) + '\n'
	);
	await fs.writeFile(
		path.join(output, 'references.json'),
		JSON.stringify(report, null, 2) + '\n'
	);
	console.log(
		JSON.stringify({
			success: report.success,
			output,
			...(report.error ? { error: report.error } : {})
		})
	);
}
