import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmZigAssets } from '../../scripts/sync-wasm-zig.mjs';

const tempDirs: string[] = [];
const stdlibZip = zipSync({ 'std/std.zig': strToU8('pub const std = true;') });

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-zig-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: Uint8Array) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

describe('syncWasmZigAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies the compiler and repackages the standard library as deterministic tar.gz', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');

		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([0, 97, 115, 109, 1]));
		await writeFixtureFile(sourceDir, 'std.zip', stdlibZip);

		const result = await syncWasmZigAssets({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'zig_small.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109, 1])
		);
		const compressedStdlib = await readFile(path.join(targetDir, 'std.tar.gz'));
		const stdlibTar = gunzipSync(compressedStdlib);
		expect(stdlibTar.subarray(0, 100).toString('utf8').replaceAll('\0', '')).toBe(
			'std/std.zig'
		);
		expect(stdlibTar.subarray(257, 262).toString('ascii')).toBe('ustar');
		await expect(readFile(path.join(targetDir, 'std.zip'))).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_ZIG_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('fails when a local source directory is present but incomplete', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');

		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([0, 97, 115, 109, 1]));

		await expect(
			syncWasmZigAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('zig standard library asset was not found');
	});

	it('rejects invalid compiler and stdlib bundle files', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');

		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([1, 2, 3, 4]));
		await writeFixtureFile(sourceDir, 'std.zip', stdlibZip);

		await expect(
			syncWasmZigAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('zig compiler asset');
	});

	it('rejects a malformed standard library ZIP before replacing the target', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');

		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([0, 97, 115, 109, 1]));
		await writeFixtureFile(sourceDir, 'std.zip', new Uint8Array([0x50, 0x4b, 3, 4, 1]));
		await writeFixtureFile(targetDir, 'existing.txt', new TextEncoder().encode('existing'));

		await expect(
			syncWasmZigAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('could not be repackaged');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});
});
