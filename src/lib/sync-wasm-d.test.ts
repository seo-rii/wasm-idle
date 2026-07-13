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
		const canonicalLldDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		for (const file of [
			'index.js',
			'runtime/bin/ldc2.wasm.gz',
			'runtime/toolchain/toolchain.tar.gz'
		]) {
			await writeFixtureFile(sourceDir, file);
		}
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.js', 'shared-js');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.data.gz', 'shared-data');
		await writeFixtureFile(canonicalLldDir, 'lld.js', 'shared-js');
		await writeFixtureFile(canonicalLldDir, 'lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(canonicalLldDir, 'lld.data.gz', 'shared-data');
		await writeFixtureFile(
			sourceDir,
			'runtime/runtime-build.json',
			'{"assets":[{"asset":"bin/lld.js"},{"asset":"bin/lld.wasm.gz"},{"asset":"bin/lld.data.gz"},{"asset":"bin/ldc2.wasm.gz"}]}\n'
		);
		await writeFixtureFile(
			sourceDir,
			'runtime/runtime-manifest.v1.json',
			'{"manifestVersion":1,"compiler":{"linker":{"js":{"asset":"bin/lld.js"},"wasm":{"asset":"bin/lld.wasm.gz"},"data":{"asset":"bin/lld.data.gz"}}}}\n'
		);

		await syncWasmDDist({
			sourceDir,
			targetDir,
			versionModulePath,
			sharedLldDir,
			canonicalLldDir
		});
		await expect(readFile(path.join(sharedLldDir, 'lld.wasm.gz'), 'utf8')).resolves.toBe(
			'shared-wasm'
		);
		await expect(readFile(path.join(sharedLldDir, 'lld.js'), 'utf8')).resolves.toBe(
			'shared-js'
		);

		const manifest = await readFile(
			path.join(targetDir, 'runtime/runtime-manifest.v1.json'),
			'utf8'
		);
		expect(manifest).toContain('../../shared/emscripten-lld/lld.wasm.gz');
		expect(manifest).toContain('../../shared/emscripten-lld/lld.data.gz');
		expect(manifest).toContain('../../shared/emscripten-lld/lld.js');
		const runtimeBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime/runtime-build.json'), 'utf8')
		) as { assets: Array<{ asset: string }>; sharedLlvmProfiles: Array<{ id: string }> };
		expect(runtimeBuild.assets).toEqual([{ asset: 'bin/ldc2.wasm.gz' }]);
		expect(runtimeBuild.sharedLlvmProfiles).toEqual([
			expect.objectContaining({ id: 'emscripten-lld' })
		]);
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.js'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.wasm.gz'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.data.gz'))).rejects.toThrow();
	});

	it('rejects a linker that differs from the canonical shared asset', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const sharedLldDir = await makeTempDir();
		const canonicalLldDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		for (const file of [
			'index.js',
			'runtime/runtime-manifest.v1.json',
			'runtime/bin/ldc2.wasm.gz',
			'runtime/toolchain/toolchain.tar.gz'
		]) {
			await writeFixtureFile(sourceDir, file);
		}
		await writeFixtureFile(sourceDir, 'runtime/runtime-build.json', '{}\n');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.js', 'shared-js');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.wasm.gz', 'different');
		await writeFixtureFile(sourceDir, 'runtime/bin/lld.data.gz', 'shared-data');
		await writeFixtureFile(canonicalLldDir, 'lld.js', 'shared-js');
		await writeFixtureFile(canonicalLldDir, 'lld.wasm.gz', 'shared-wasm');
		await writeFixtureFile(canonicalLldDir, 'lld.data.gz', 'shared-data');

		await expect(
			syncWasmDDist({
				sourceDir,
				targetDir,
				versionModulePath,
				sharedLldDir,
				canonicalLldDir
			})
		).rejects.toThrow('differs from the canonical asset');
	});
});
