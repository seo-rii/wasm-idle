import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmDDist } from '../../scripts/sync-wasm-d.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-d-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents = relativePath) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

describe('syncWasmDDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('uses the canonical shared Emscripten LLD assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const sharedLldDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		for (const file of [
			'index.js',
			'runtime/runtime-build.json',
			'runtime/bin/ldc2.wasm.gz',
			'runtime/bin/lld.js',
			'runtime/toolchain/toolchain.tar.gz'
		]) {
			await writeFixtureFile(sourceDir, file);
		}
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.data.gz', 'shared-data');
		await writeFixtureFile(sharedLldDir, 'lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(sharedLldDir, 'lld.data.gz', 'shared-data');
		await writeFixtureFile(
			sourceDir,
			'runtime/runtime-manifest.v1.json',
			'{"manifestVersion":1,"compiler":{"linker":{"wasm":{"asset":"bin/lld.wasm.gz"},"data":{"asset":"bin/lld.data.gz"}}}}\n'
		);

		await syncWasmDDist({ sourceDir, targetDir, versionModulePath, sharedLldDir });

		const manifest = await readFile(
			path.join(targetDir, 'runtime/runtime-manifest.v1.json'),
			'utf8'
		);
		expect(manifest).toContain('../../shared/emscripten-lld/lld.wasm.gz');
		expect(manifest).toContain('../../shared/emscripten-lld/lld.data.gz');
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.wasm.gz'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.data.gz'))).rejects.toThrow();
	});

	it('rejects a linker that differs from the canonical shared asset', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const sharedLldDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		for (const file of [
			'index.js',
			'runtime/runtime-manifest.v1.json',
			'runtime/runtime-build.json',
			'runtime/bin/ldc2.wasm.gz',
			'runtime/bin/lld.js',
			'runtime/toolchain/toolchain.tar.gz'
		]) {
			await writeFixtureFile(sourceDir, file);
		}
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.wasm.gz', 'different');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.data.gz', 'shared-data');
		await writeFixtureFile(sharedLldDir, 'lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(sharedLldDir, 'lld.data.gz', 'shared-data');

		await expect(
			syncWasmDDist({ sourceDir, targetDir, versionModulePath, sharedLldDir })
		).rejects.toThrow('differs from the canonical asset');
	});
});
