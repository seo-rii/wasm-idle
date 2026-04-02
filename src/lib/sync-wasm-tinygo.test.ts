import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmTinyGoDist } from '../../scripts/sync-wasm-tinygo.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-tinygo-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
}

describe('syncWasmTinyGoDist', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('copies the built wasm-tinygo bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.html', '<!doctype html>\n');
		await writeFixtureFile(sourceDir, 'runtime.js', 'export const runtime = true;\n');
		await writeFixtureFile(sourceDir, 'assets/index.js', 'console.log("tinygo");\n');
		await writeFixtureFile(sourceDir, 'tools/go-probe.wasm', 'wasm');
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');

		const result = await syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.html'), 'utf8')).resolves.toContain(
			'<!doctype html>'
		);
		await expect(readFile(path.join(targetDir, 'runtime.js'), 'utf8')).resolves.toContain(
			'runtime = true'
		);
		await expect(readFile(path.join(targetDir, 'assets/index.js'), 'utf8')).resolves.toContain(
			'tinygo'
		);
		await expect(readFile(path.join(targetDir, 'tools/go-probe.wasm'), 'utf8')).resolves.toBe(
			'wasm'
		);
		await expect(readFile(path.join(targetDir, 'types.d.ts'), 'utf8')).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_TINYGO_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('fails with a build hint when the wasm-tinygo dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await expect(syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-tinygo first'
		);
	});

	it('fails when the wasm-tinygo runtime module entry is missing from the dist bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.html', '<!doctype html>\n');

		await expect(syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'wasm-tinygo runtime module was not found'
		);
	});

	it('keeps the same fingerprint when bundle contents are unchanged but mtimes move', async () => {
		const sourceDir = await makeTempDir();
		const firstTargetDir = await makeTempDir();
		const secondTargetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.html', '<!doctype html>\n');
		await writeFixtureFile(sourceDir, 'runtime.js', 'export const runtime = true;\n');
		await writeFixtureFile(sourceDir, 'assets/index.js', 'console.log("tinygo");\n');
		await writeFixtureFile(sourceDir, 'tools/go-probe.wasm', 'wasm');

		const first = await syncWasmTinyGoDist({ sourceDir, targetDir: firstTargetDir, versionModulePath });
		const shiftedTime = new Date(Date.now() + 60_000);
		await utimes(path.join(sourceDir, 'runtime.js'), shiftedTime, shiftedTime);
		await utimes(path.join(sourceDir, 'assets/index.js'), shiftedTime, shiftedTime);
		const second = await syncWasmTinyGoDist({
			sourceDir,
			targetDir: secondTargetDir,
			versionModulePath
		});

		expect(second.fingerprint).toBe(first.fingerprint);
	});
});
