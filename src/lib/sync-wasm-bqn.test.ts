import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmBqnAssets } from '../../scripts/sync-wasm-bqn.mjs';

const tempDirs: string[] = [];
const originalWasmBqnSourceDir = process.env.WASM_BQN_SOURCE_DIR;
const originalWasmBqnLicenseFile = process.env.WASM_BQN_LICENSE_FILE;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-bqn-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmBqnAssets', () => {
	afterEach(async () => {
		if (originalWasmBqnSourceDir === undefined) {
			delete process.env.WASM_BQN_SOURCE_DIR;
		} else {
			process.env.WASM_BQN_SOURCE_DIR = originalWasmBqnSourceDir;
		}
		if (originalWasmBqnLicenseFile === undefined) {
			delete process.env.WASM_BQN_LICENSE_FILE;
		} else {
			process.env.WASM_BQN_LICENSE_FILE = originalWasmBqnLicenseFile;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies CBQN Emscripten wasm assets and writes a version module', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const licenseFile = await writeFixtureFile(
			await makeTempDir(),
			'LICENSE-GPLv3',
			'GNU GENERAL PUBLIC LICENSE\n'
		);
		await writeFixtureFile(
			sourceDir,
			'BQN.js',
			'export default Module; cbqn_runLine; FS.init;\n'
		);
		await writeFixtureFile(sourceDir, 'BQN.wasm', 'wasm');

		const result = await syncWasmBqnAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath,
			licenseFile
		});

		await expect(readFile(path.join(targetDir, 'BQN.js'), 'utf8')).resolves.toContain(
			'cbqn_runLine'
		);
		await expect(readFile(path.join(targetDir, 'BQN.wasm'), 'utf8')).resolves.toBe('wasm');
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		await expect(
			readFile(path.join(targetDir, 'LICENSE-GPLv3.txt'), 'utf8')
		).resolves.toContain('GNU GENERAL PUBLIC LICENSE');
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-bqn-runtime-manifest-v1',
			runtime: 'dzaima-cbqn',
			files: ['BQN.js', 'BQN.wasm', 'LICENSE-GPLv3.txt']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_BQN_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('refreshes the worker and version module from an existing vendored target', async () => {
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		await writeFixtureFile(
			targetDir,
			'BQN.js',
			'export default Module; cbqn_runLine; FS.init;\n'
		);
		await writeFixtureFile(targetDir, 'BQN.wasm.gz', 'compressed-wasm');
		process.env.WASM_BQN_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmBqnAssets({ targetDir, workerSourcePath, versionModulePath });

		await expect(readFile(path.join(targetDir, 'BQN.wasm.gz'), 'utf8')).resolves.toBe(
			'compressed-wasm'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: string[] };
		expect(manifest.files).toEqual(['BQN.js', 'BQN.wasm.gz']);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});
});
