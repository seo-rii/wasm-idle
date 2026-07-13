import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmJAssets } from '../../scripts/sync-wasm-j.mjs';

const tempDirs: string[] = [];
const originalWasmJSourceDir = process.env.WASM_J_SOURCE_DIR;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-j-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmJAssets', () => {
	afterEach(async () => {
		if (originalWasmJSourceDir === undefined) {
			delete process.env.WASM_J_SOURCE_DIR;
		} else {
			process.env.WASM_J_SOURCE_DIR = originalWasmJSourceDir;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies official J playground wasm assets and writes a version module', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		await writeFixtureFile(
			sourceDir,
			'jamalgam.js',
			'export default function createModule() {}; em_jdo; WebAssembly.instantiate;\n'
		);
		await writeFixtureFile(sourceDir, 'jamalgam.wasm', 'wasm');

		const result = await syncWasmJAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'jamalgam.js'), 'utf8')).resolves.toContain(
			'em_jdo'
		);
		await expect(readFile(path.join(targetDir, 'jamalgam.wasm'), 'utf8')).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-j-runtime-manifest-v1',
			runtime: 'jsoftware-j-playground',
			files: ['jamalgam.js', 'jamalgam.wasm']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_J_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('refreshes the worker and version module from an existing vendored target', async () => {
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		await writeFixtureFile(targetDir, 'jamalgam.js', 'em_jdo; WebAssembly.instantiate;\n');
		await writeFixtureFile(targetDir, 'jamalgam.wasm.gz', 'compressed-wasm');
		process.env.WASM_J_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmJAssets({ targetDir, workerSourcePath, versionModulePath });

		await expect(readFile(path.join(targetDir, 'jamalgam.wasm.gz'), 'utf8')).resolves.toBe(
			'compressed-wasm'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: string[] };
		expect(manifest.files).toEqual(['jamalgam.js', 'jamalgam.wasm.gz']);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});
});
