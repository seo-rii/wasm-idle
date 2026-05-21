// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const assetDir = path.join(projectRoot, 'static', 'wasm-kotlin');
const kotlinVersion = '2.3.21';
const bridgeClassPath = [
	path.join(assetDir, 'wasm-idle-kotlin-bridge.jar'),
	path.join(assetDir, `kotlin-compiler-embeddable-${kotlinVersion}.jar`),
	path.join(assetDir, `kotlin-stdlib-${kotlinVersion}.jar`),
	path.join(assetDir, `kotlin-script-runtime-${kotlinVersion}.jar`),
	path.join(assetDir, 'kotlin-reflect-1.6.10.jar'),
	path.join(assetDir, `kotlin-daemon-embeddable-${kotlinVersion}.jar`),
	path.join(assetDir, 'kotlinx-coroutines-core-jvm-1.8.0.jar'),
	path.join(assetDir, 'annotations-13.0.jar')
].join(':');

function runBridge(args: string[]) {
	return spawnSync('java', ['-cp', bridgeClassPath, 'org.wasmidle.kotlin.Bridge', ...args], {
		encoding: 'utf8'
	});
}

describe('Kotlin bridge assets', () => {
	it('compile and run a Kotlin main function with stdin and args on the JVM bridge', () => {
		const workDir = path.join(projectRoot, '.tmp', 'kotlin-bridge-integration-ok');
		rmSync(workDir, { force: true, recursive: true });
		mkdirSync(path.join(workDir, 'classes'), { recursive: true });
		const sourcePath = path.join(workDir, 'Main.kt');
		writeFileSync(
			sourcePath,
			`const val BONUS = 3

fun factorial(n: Int): Int = if (n <= 1) 1 else n * factorial(n - 1)

fun main(args: Array<String>) {
    val n = readln().trim().toInt()
    println("label=\${args.firstOrNull() ?: "none"}")
    println("factorial_plus_bonus=\${factorial(n) + BONUS}")
}
`
		);

		const compile = runBridge([
			'compile',
			sourcePath,
			path.join(workDir, 'classes'),
			path.join(assetDir, `kotlin-stdlib-${kotlinVersion}.jar`),
			workDir
		]);
		expect(compile.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'compile.status.txt'), 'utf8')).toBe('0');
		expect(readFileSync(path.join(workDir, 'main-class.txt'), 'utf8').trim()).toBe('MainKt');

		const stdinPath = path.join(workDir, 'stdin.txt');
		writeFileSync(stdinPath, '5\n');
		const run = runBridge([
			'run',
			path.join(workDir, 'classes'),
			'MainKt',
			path.join(assetDir, `kotlin-stdlib-${kotlinVersion}.jar`),
			stdinPath,
			workDir,
			'browser'
		]);

		expect(run.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'run.status.txt'), 'utf8')).toBe('0');
		expect(readFileSync(path.join(workDir, 'run.stdout.txt'), 'utf8')).toBe(
			'label=browser\nfactorial_plus_bonus=123\n'
		);
	}, 30000);

	it('reports kotlinc failures through bridge output files', () => {
		const workDir = path.join(projectRoot, '.tmp', 'kotlin-bridge-integration-error');
		rmSync(workDir, { force: true, recursive: true });
		mkdirSync(path.join(workDir, 'classes'), { recursive: true });
		const sourcePath = path.join(workDir, 'Broken.kt');
		writeFileSync(sourcePath, 'fun main() { println(nope) }\n');

		const compile = runBridge([
			'compile',
			sourcePath,
			path.join(workDir, 'classes'),
			path.join(assetDir, `kotlin-stdlib-${kotlinVersion}.jar`),
			workDir
		]);

		expect(compile.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'compile.status.txt'), 'utf8')).toBe('1');
		expect(readFileSync(path.join(workDir, 'compile.stderr.txt'), 'utf8')).toMatch(
			/[Uu]nresolved reference/
		);
	}, 30000);
});
