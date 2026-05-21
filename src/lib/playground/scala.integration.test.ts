// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
const assetDir = path.join(projectRoot, 'static', 'wasm-scala');
const bridgeClassPath = [
	path.join(assetDir, 'wasm-idle-scala-bridge.jar'),
	path.join(assetDir, 'scala-library-2.13.18.jar'),
	path.join(assetDir, 'scala-reflect-2.13.18.jar'),
	path.join(assetDir, 'scala-compiler-2.13.18.jar')
].join(':');

function runBridge(args: string[]) {
	return spawnSync('java', ['-cp', bridgeClassPath, 'org.wasmidle.scala.Bridge', ...args], {
		encoding: 'utf8'
	});
}

describe('Scala bridge assets', () => {
	it('compile and run a Scala main class with stdin and args on the JVM bridge', () => {
		const workDir = path.join(projectRoot, '.tmp', 'scala-bridge-integration-ok');
		rmSync(workDir, { force: true, recursive: true });
		mkdirSync(path.join(workDir, 'classes'), { recursive: true });
		const sourcePath = path.join(workDir, 'Main.scala');
		writeFileSync(
			sourcePath,
			`object Main {
  val bonus = 3
  def factorial(n: Int): Int = if (n <= 1) 1 else n * factorial(n - 1)
  def main(args: Array[String]): Unit = {
    val n = scala.io.StdIn.readLine().trim.toInt
    println(s"label=\${args.headOption.getOrElse("none")}")
    println(s"factorial_plus_bonus=\${factorial(n) + bonus}")
  }
}`
		);

		const compile = runBridge([
			'compile',
			sourcePath,
			path.join(workDir, 'classes'),
			path.join(assetDir, 'scala-library-2.13.18.jar'),
			workDir
		]);
		expect(compile.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'compile.status.txt'), 'utf8')).toBe('0');
		expect(readFileSync(path.join(workDir, 'main-class.txt'), 'utf8').trim()).toBe('Main');

		const stdinPath = path.join(workDir, 'stdin.txt');
		writeFileSync(stdinPath, '5\n');
		const run = runBridge([
			'run',
			path.join(workDir, 'classes'),
			'Main',
			path.join(assetDir, 'scala-library-2.13.18.jar'),
			stdinPath,
			workDir,
			'browser'
		]);

		expect(run.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'run.status.txt'), 'utf8')).toBe('0');
		expect(readFileSync(path.join(workDir, 'run.stdout.txt'), 'utf8')).toBe(
			'label=browser\nfactorial_plus_bonus=123\n'
		);
	}, 20000);

	it('reports scalac failures through bridge output files', () => {
		const workDir = path.join(projectRoot, '.tmp', 'scala-bridge-integration-error');
		rmSync(workDir, { force: true, recursive: true });
		mkdirSync(path.join(workDir, 'classes'), { recursive: true });
		const sourcePath = path.join(workDir, 'Broken.scala');
		writeFileSync(sourcePath, 'object Broken { def main(args: Array[String]): Unit = nope }\n');

		const compile = runBridge([
			'compile',
			sourcePath,
			path.join(workDir, 'classes'),
			path.join(assetDir, 'scala-library-2.13.18.jar'),
			workDir
		]);

		expect(compile.status).toBe(0);
		expect(readFileSync(path.join(workDir, 'compile.status.txt'), 'utf8')).toBe('1');
		expect(readFileSync(path.join(workDir, 'compile.stderr.txt'), 'utf8')).toContain(
			'not found: value nope'
		);
	}, 20000);
});
