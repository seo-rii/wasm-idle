import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { instrumentJavaDebugSource } from '../src/lib/playground/javaDebugSource.ts';
import { buildJavaDebugEvaluationProgram } from '../src/lib/playground/worker/javaDebugEvaluator.ts';
import { bundleJavaDebugHelpers } from './bundle-java-debug-helpers.mjs';

let directory, metafile, sourceHelper, evaluatorHelper;
before(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-java-debug-package-'));
	await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
	metafile = await bundleJavaDebugHelpers({ outdir: directory });
	sourceHelper = await import(pathToFileURL(path.join(directory, 'javaDebugSource.js')).href);
	evaluatorHelper = await import(
		pathToFileURL(path.join(directory, 'worker/javaDebugEvaluator.js')).href
	);
});
after(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

test('the standalone shared parser bundle preserves real source instrumentation', () => {
	for (const source of [
		'class Main { void run() { int value = 7; int[] a = {value}; for (int n : a) { value += n; } } }',
		'class Main { Main(int n) { this(); n++; } Main() {} int f(int x) { return switch(x) { case 1 -> 2; default -> x; }; } }',
		'interface Work { default int f(int x) { int value = x + 1; return value; } }',
		'class Main { void run() { int value = 0; java.util.function.IntUnaryOperator op = n -> { return n + 1; }; value++; } }',
		'record Point(int x, int y) {}'
	]) {
		assert.deepEqual(
			sourceHelper.instrumentJavaDebugSource(source, 'Main.java', 'debug.Bridge'),
			instrumentJavaDebugSource(source, 'Main.java', 'debug.Bridge')
		);
	}
	assert.throws(() =>
		sourceHelper.instrumentJavaDebugSource(
			String.raw`class Main { void f() { \u0078++; } }`,
			'Main.java',
			'debug.Bridge'
		)
	);
});

test('the standalone bundle preserves evaluation generation and rejects unsupported expressions', () => {
	const bindings = [
		{ name: 'number', type: 'int', value: '7' },
		{ name: 'text', type: 'java.lang.String', value: 'hello' },
		{ name: 'wide', type: 'long', value: '9007199254740993' }
	];
	const normalize = (program) => ({
		...program,
		code: program.code.replace(/WasmIdleEval_[a-f0-9]{32}/g, 'WasmIdleEval_fixed')
	});
	for (const expression of [
		'number + 5',
		'wide + 1L',
		'text.substring(1)',
		'java.lang.Math.max(number, 9)'
	]) {
		const request = { expression, bindings };
		assert.deepEqual(
			normalize(evaluatorHelper.buildJavaDebugEvaluationProgram(request)),
			normalize(buildJavaDebugEvaluationProgram(request))
		);
	}
	for (const expression of [
		'number++',
		'new String("x")',
		'text == "hello"',
		'number; System.exit(0)'
	]) {
		assert.throws(() =>
			evaluatorHelper.buildJavaDebugEvaluationProgram({ expression, bindings })
		);
	}
});

test('the distributable is self-contained and retains complete upstream license texts', async () => {
	assert.equal(
		Object.values(metafile.outputs).flatMap((output) =>
			output.imports.filter((item) => item.external)
		).length,
		0
	);
	const notices = await readFile(path.join(directory, 'java-debug-notices.txt'), 'utf8');
	const parserLicense = await readFile(
		new URL('../node_modules/java-parser/LICENSE', import.meta.url),
		'utf8'
	);
	assert.ok(notices.includes(parserLicense), 'retains the complete upstream Java parser LICENSE');
	assert.match(notices, /java-parser@3\.0\.1/);
	assert.match(notices, /chevrotain@11\.0\.3/);
	assert.match(notices, /lodash@4\.17\.21/);
	assert.match(notices, /Apache License/);
	assert.match(notices, /Permission is hereby granted/);
});
