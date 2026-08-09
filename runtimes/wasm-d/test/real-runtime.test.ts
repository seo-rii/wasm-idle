import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileD, executeBrowserDArtifact } from '../src/index.js';

const runtimeDir = path.resolve('dist/runtime');
const hasRuntimeAssets =
	existsSync(path.join(runtimeDir, 'runtime-manifest.v1.json')) &&
	existsSync(path.join(runtimeDir, 'bin', 'ldc2.wasm.gz')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.js')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.wasm.gz')) &&
	existsSync(path.join(runtimeDir, 'bin', 'lld.data.gz')) &&
	existsSync(path.join(runtimeDir, 'toolchain', 'toolchain.tar.gz'));

async function verifyRuntimeAssetIntegrity({
	bytes,
	expected,
	stage
}: {
	bytes: Uint8Array;
	expected: {
		bytes: number;
		sha256: string;
		uncompressedBytes: number;
		uncompressedSha256: string;
	};
	stage: 'compressed' | 'uncompressed';
}) {
	const expectedBytes = stage === 'compressed' ? expected.bytes : expected.uncompressedBytes;
	const expectedSha256 = stage === 'compressed' ? expected.sha256 : expected.uncompressedSha256;
	expect(bytes.byteLength).toBe(expectedBytes);
	expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256);
}

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
				runtimeBaseUrl: pathToFileURL(`${runtimeDir}/`),
				verifyRuntimeAssetIntegrity
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
