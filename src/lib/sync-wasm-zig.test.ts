import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmZigAssets } from '../../scripts/sync-wasm-zig.mjs';

const tempDirs: string[] = [];

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

	it('copies wasm-zig compiler assets into the static directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');

		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([0, 97, 115, 109, 1]));
		await writeFixtureFile(sourceDir, 'std.zip', new Uint8Array([0x50, 0x4b, 3, 4, 1]));

		const result = await syncWasmZigAssets({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'zig_small.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109, 1])
		);
		await expect(readFile(path.join(targetDir, 'std.zip'))).resolves.toEqual(
			Buffer.from([0x50, 0x4b, 3, 4, 1])
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_ZIG_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
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
		await writeFixtureFile(sourceDir, 'std.zip', new Uint8Array([0x50, 0x4b, 3, 4, 1]));

		await expect(
			syncWasmZigAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('zig compiler asset');
	});
});
