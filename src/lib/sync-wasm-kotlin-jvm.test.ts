import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncWasmKotlinJvmAssets } from '../../scripts/sync-wasm-kotlin-jvm.mjs';

const tempDirs: string[] = [];
const jarHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-kotlin-jvm-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(
	baseDir: string,
	relativePath: string,
	contents: string | Uint8Array
) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

async function writeKotlinCompilerLib(kotlinLibDir: string) {
	for (const jarName of [
		'kotlin-compiler.jar',
		'kotlin-stdlib.jar',
		'kotlin-reflect.jar',
		'kotlin-script-runtime.jar',
		'kotlinx-coroutines-core-jvm.jar',
		'annotations-13.0.jar',
		'trove4j-1.0.20200330.jar'
	]) {
		await writeFixtureFile(kotlinLibDir, jarName, jarHeader);
	}
}

describe('syncWasmKotlinJvmAssets', () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies Kotlin compiler jars, normalizes trove4j, and uses a provided patch jar', async () => {
		const kotlinLibDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const patchJarPath = path.join(await makeTempDir(), 'kotlinc-browser-patch.jar');
		await writeKotlinCompilerLib(kotlinLibDir);
		await writeFile(patchJarPath, jarHeader);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await syncWasmKotlinJvmAssets({ kotlinLibDir, targetDir, patchJarPath });

		await expect(readFile(path.join(targetDir, 'lib', 'kotlin-compiler.jar'))).resolves.toEqual(
			Buffer.from(jarHeader)
		);
		await expect(readFile(path.join(targetDir, 'lib', 'trove4j.jar'))).resolves.toEqual(
			Buffer.from(jarHeader)
		);
		await expect(
			readFile(path.join(targetDir, 'lib', 'kotlinc-browser-patch.jar'))
		).resolves.toEqual(Buffer.from(jarHeader));
		expect(result.copiedCheerpj).toBe(false);
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped CheerpJ'));
	});

	it('copies a provided licensed CheerpJ runtime directory separately', async () => {
		const kotlinLibDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const cheerpjDir = await makeTempDir();
		const cheerpjTargetDir = await makeTempDir();
		const patchJarPath = path.join(await makeTempDir(), 'kotlinc-browser-patch.jar');
		await writeKotlinCompilerLib(kotlinLibDir);
		await writeFile(patchJarPath, jarHeader);
		await writeFixtureFile(cheerpjDir, 'loader.js', 'export const cheerpj = true;\n');
		await writeFixtureFile(cheerpjDir, 'nested/cj3.wasm', new Uint8Array([0, 97, 115, 109]));

		const result = await syncWasmKotlinJvmAssets({
			kotlinLibDir,
			targetDir,
			cheerpjDir,
			cheerpjTargetDir,
			patchJarPath
		});

		await expect(readFile(path.join(cheerpjTargetDir, 'loader.js'), 'utf8')).resolves.toContain(
			'cheerpj = true'
		);
		await expect(readFile(path.join(cheerpjTargetDir, 'nested', 'cj3.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109])
		);
		expect(result.copiedCheerpj).toBe(true);
	});

	it('fails with an actionable hint when trove4j is missing', async () => {
		const kotlinLibDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const patchJarPath = path.join(await makeTempDir(), 'kotlinc-browser-patch.jar');
		await writeKotlinCompilerLib(kotlinLibDir);
		await rm(path.join(kotlinLibDir, 'trove4j-1.0.20200330.jar'));
		await writeFile(patchJarPath, jarHeader);

		await expect(
			syncWasmKotlinJvmAssets({ kotlinLibDir, targetDir, patchJarPath })
		).rejects.toThrow('trove4j jar was not found');
	});
});
