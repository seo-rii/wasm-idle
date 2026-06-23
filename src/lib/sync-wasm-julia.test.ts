import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmJuliaAssets } from '../../scripts/sync-wasm-julia.mjs';

const tempDirs: string[] = [];
const originalWasmJuliaSourceDir = process.env.WASM_JULIA_SOURCE_DIR;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-julia-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmJuliaAssets', () => {
	afterEach(async () => {
		if (originalWasmJuliaSourceDir === undefined) {
			delete process.env.WASM_JULIA_SOURCE_DIR;
		} else {
			process.env.WASM_JULIA_SOURCE_DIR = originalWasmJuliaSourceDir;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies Julia wasm assets and writes a version module', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJuliaVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		await writeFixtureFile(sourceDir, 'julia.js', '_jl_eval_string; WebAssembly.instantiate;\n');
		await writeFixtureFile(sourceDir, 'julia.wasm', 'wasm');
		await writeFixtureFile(sourceDir, 'julia.data', 'data');
		await writeFixtureFile(sourceDir, 'LICENSE.md', 'MIT License\n');

		const result = await syncWasmJuliaAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'julia.js'), 'utf8')).resolves.toContain(
			'_jl_eval_string'
		);
		await expect(readFile(path.join(targetDir, 'julia.wasm'), 'utf8')).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'julia.data'), 'utf8')).resolves.toBe('data');
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-julia-runtime-manifest-v1',
			runtime: 'chriskoch-julia-wasm',
			files: ['LICENSE.md', 'julia.data', 'julia.js', 'julia.wasm']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_JULIA_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('refreshes the worker and version module from an existing vendored target', async () => {
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmJuliaVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		await writeFixtureFile(targetDir, 'julia.js', '_jl_eval_string; WebAssembly.instantiate;\n');
		await writeFixtureFile(targetDir, 'julia.wasm.gz', 'compressed-wasm');
		await writeFixtureFile(targetDir, 'julia.data.gz', 'compressed-data');
		process.env.WASM_JULIA_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmJuliaAssets({ targetDir, workerSourcePath, versionModulePath });

		await expect(readFile(path.join(targetDir, 'julia.wasm.gz'), 'utf8')).resolves.toBe(
			'compressed-wasm'
		);
		await expect(readFile(path.join(targetDir, 'julia.data.gz'), 'utf8')).resolves.toBe(
			'compressed-data'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: string[] };
		expect(manifest.files).toEqual(['julia.data.gz', 'julia.js', 'julia.wasm.gz']);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});
});
