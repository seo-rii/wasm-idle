import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmJanetAssets } from '../../scripts/sync-wasm-janet.mjs';

const tempDirs: string[] = [];
const originalWasmJanetSourceDir = process.env.WASM_JANET_SOURCE_DIR;
const originalWasmJanetLicenseFile = process.env.WASM_JANET_LICENSE_FILE;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-janet-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmJanetAssets', () => {
	afterEach(async () => {
		if (originalWasmJanetSourceDir === undefined) {
			delete process.env.WASM_JANET_SOURCE_DIR;
		} else {
			process.env.WASM_JANET_SOURCE_DIR = originalWasmJanetSourceDir;
		}
		if (originalWasmJanetLicenseFile === undefined) {
			delete process.env.WASM_JANET_LICENSE_FILE;
		} else {
			process.env.WASM_JANET_LICENSE_FILE = originalWasmJanetLicenseFile;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies upstream Janet Emscripten wasm assets and writes a version module', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJanetVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const licenseFile = await writeFixtureFile(await makeTempDir(), 'LICENSE', 'MIT License\n');
		await writeFixtureFile(
			sourceDir,
			'janet.js',
			'export default Module; callMain; FS.init;\n'
		);
		await writeFixtureFile(sourceDir, 'janet.wasm', 'wasm');

		const result = await syncWasmJanetAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath,
			licenseFile
		});

		await expect(readFile(path.join(targetDir, 'janet.js'), 'utf8')).resolves.toContain(
			'callMain'
		);
		await expect(readFile(path.join(targetDir, 'janet.wasm'), 'utf8')).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		await expect(readFile(path.join(targetDir, 'LICENSE.txt'), 'utf8')).resolves.toContain(
			'MIT License'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-janet-runtime-manifest-v1',
			runtime: 'janet-lang-janet',
			files: ['LICENSE.txt', 'janet.js', 'janet.wasm']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_JANET_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('refreshes the worker and version module from an existing vendored target', async () => {
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJanetVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		await writeFixtureFile(
			targetDir,
			'janet.js',
			'export default Module; callMain; FS.init;\n'
		);
		await writeFixtureFile(targetDir, 'janet.wasm', 'wasm');
		process.env.WASM_JANET_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmJanetAssets({
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'janet.wasm'), 'utf8')).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: string[] };
		expect(manifest.files).toEqual(['janet.js', 'janet.wasm']);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});
});
