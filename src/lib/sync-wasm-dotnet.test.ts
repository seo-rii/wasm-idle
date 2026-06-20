import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmDotnetDist } from '../../scripts/sync-wasm-dotnet.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-dotnet-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
}

describe('syncWasmDotnetDist', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('copies the built wasm-dotnet bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDotnetVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default "dotnet";\n');
		await writeFixtureFile(sourceDir, 'compiler.js', 'export const compile = true;\n');
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');
		await writeFixtureFile(sourceDir, 'runtime/blazor.boot.json', '{"resources":{}}\n');
		await writeFixtureFile(sourceDir, 'runtime/dotnet.js', 'export const dotnet = {};\n');
		await writeFixtureFile(sourceDir, 'runtime/ref/manifest.json', '{"assemblies":[]}\n');
		await writeFixtureFile(sourceDir, 'runtime/ref/System.Runtime.dll', 'dll');
		await writeFixtureFile(sourceDir, 'runtime/WasmDotnet.Compiler.wasm', 'wasm');

		const result = await syncWasmDotnetDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain('dotnet');
		await expect(readFile(path.join(targetDir, 'compiler.js'), 'utf8')).resolves.toContain(
			'compile = true'
		);
		await expect(readFile(path.join(targetDir, 'runtime/blazor.boot.json'), 'utf8')).resolves.toContain(
			'"resources"'
		);
		await expect(readFile(path.join(targetDir, 'runtime/dotnet.js'), 'utf8')).resolves.toContain(
			'dotnet'
		);
		await expect(
			readFile(path.join(targetDir, 'runtime/ref/manifest.json'), 'utf8')
		).resolves.toContain('"assemblies"');
		await expect(
			readFile(path.join(targetDir, 'runtime/ref/System.Runtime.dll'), 'utf8')
		).resolves.toBe('dll');
		await expect(
			readFile(path.join(targetDir, 'runtime/WasmDotnet.Compiler.wasm'), 'utf8')
		).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'types.d.ts'), 'utf8')).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_DOTNET_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('fails before clearing the target when the runtime bundle is missing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDotnetVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default "dotnet";\n');
		await writeFixtureFile(targetDir, 'existing-runtime.txt', 'keep me');

		await expect(syncWasmDotnetDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'wasm-dotnet runtime directory was not found'
		);
		await expect(readFile(path.join(targetDir, 'existing-runtime.txt'), 'utf8')).resolves.toBe(
			'keep me'
		);
	});
});
