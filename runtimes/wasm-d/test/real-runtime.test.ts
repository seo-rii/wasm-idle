import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileD, executeBrowserDArtifact } from '../src/index.js';

const runtimeDir = path.resolve('dist/runtime');
const hasRuntimeAssets =
	existsSync(path.join(runtimeDir, 'runtime-manifest.v1.json')) &&
	existsSync(path.join(runtimeDir, 'bin', 'ldc2.wasm')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.js')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.wasm')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.data')) &&
	existsSync(path.join(runtimeDir, 'toolchain', 'toolchain.tar'));

describe.runIf(hasRuntimeAssets)('real LDC runtime assets', () => {
	it('compiles, links, and runs a stdin/stdout D program', async () => {
		let supplied = false;
		const progress: number[] = [];
		const result = await compileD(
			{
				code: `import std.stdio;
import std.string;

void main()
{
    auto line = readln();
    writeln("echo:", line.chomp());
}`,
				onProgress(event) {
					progress.push(event.percent);
				}
			},
			{
				runtimeBaseUrl: pathToFileURL(`${runtimeDir}/`)
			}
		);

		expect(result.success, result.stderr || result.stdout).toBe(true);
		expect(result.artifact).toBeDefined();
		const run = await executeBrowserDArtifact(result.artifact!, {
			stdin: () => {
				if (supplied) return null;
				supplied = true;
				return 'hancomac\n';
			}
		});

		expect(run.exitCode).toBe(0);
		expect(run.stdout).toBe('echo:hancomac\n');
		expect(progress.at(-1)).toBe(100);
	}, 120_000);
});
