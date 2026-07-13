import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmForthAssets } from '../../scripts/sync-wasm-forth.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-forth-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmForthAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('wraps the WAForth CommonJS bundle for worker importScripts', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmForthVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const sourceFile = await writeFixtureFile(
			sourceDir,
			'index.js',
			'module.exports = { default: function WAForth() {}, isSuccess() { return true; } }; WebAssembly.instantiate;\n'
		);

		const result = await syncWasmForthAssets({
			sourceFile,
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'waforth.js'), 'utf8')).resolves.toContain(
			'self.WAForthPackage = module.exports;'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-forth-runtime-manifest-v1',
			runtime: 'waforth',
			files: ['waforth.js']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_FORTH_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('rejects bundles that do not look like WAForth', async () => {
		const sourceFile = await writeFixtureFile(await makeTempDir(), 'index.js', 'export {};\n');
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmForthVersion.ts');

		await expect(
			syncWasmForthAssets({ sourceFile, targetDir, versionModulePath })
		).rejects.toThrow('waforth bundle does not look like the expected WebAssembly runtime');
	});
});
