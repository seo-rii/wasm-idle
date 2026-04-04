import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmGoDist } from '../../scripts/sync-wasm-go.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-go-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
}

describe('syncWasmGoDist', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('copies the built wasm-go bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default "go";\n');
		await writeFixtureFile(sourceDir, 'index.js.map', '{"version":3}\n');
		await writeFixtureFile(
			sourceDir,
			'browser-execution.js',
			"import { WASI } from './vendor/browser_wasi_shim/index.js';\nexport { WASI };\n"
		);
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/index.js',
			'export const WASI = class WASI {};\n'
		);
		await writeFixtureFile(sourceDir, 'runtime/runtime-manifest.v1.json', '{"manifestVersion":1}\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-build.json', '{"goVersion":"1.26.1"}\n');
		await writeFixtureFile(sourceDir, 'runtime/tools/compile.wasm.gz', 'gzip-compile');
		await writeFixtureFile(sourceDir, 'runtime/sysroot/wasip1.index.json.gz', 'gzip-index');
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');
		await writeFixtureFile(sourceDir, 'vendor/tsconfig.tsbuildinfo', 'ignored');

		const result = await syncWasmGoDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain('go');
		await expect(readFile(path.join(targetDir, 'index.js.map'), 'utf8')).resolves.toContain(
			'"version":3'
		);
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js'), 'utf8')
		).resolves.toContain("./vendor/browser_wasi_shim/index.js");
		await expect(
			readFile(path.join(targetDir, 'vendor/browser_wasi_shim/index.js'), 'utf8')
		).resolves.toContain('export const WASI');
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-manifest.v1.json'), 'utf8')
		).resolves.toContain('"manifestVersion":1');
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-build.json'), 'utf8')
		).resolves.toContain('"goVersion":"1.26.1"');
		await expect(
			readFile(path.join(targetDir, 'runtime/tools/compile.wasm.gz'), 'utf8')
		).resolves.toBe('gzip-compile');
		await expect(
			readFile(path.join(targetDir, 'runtime/sysroot/wasip1.index.json.gz'), 'utf8')
		).resolves.toBe('gzip-index');
		await expect(readFile(path.join(targetDir, 'types.d.ts'), 'utf8')).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'vendor/tsconfig.tsbuildinfo'), 'utf8')).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_GO_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('clears stale files from the previous synced bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/index.js',
			'export const WASI = class WASI {};\n'
		);
		await writeFixtureFile(sourceDir, 'runtime/runtime-manifest.v1.json', '{"manifestVersion":1}\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-build.json', '{"goVersion":"1.26.1"}\n');
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');

		await syncWasmGoDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'export default 1'
		);
		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).rejects.toThrow();
	});

	it('fails with a build hint when the wasm-go dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmGoVersion.ts');

		await expect(syncWasmGoDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-go first'
		);
	});

	it('fails when the wasm-go runtime manifest is missing from the dist bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-build.json', '{"goVersion":"1.26.1"}\n');
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/index.js',
			'export const WASI = class WASI {};\n'
		);

		await expect(syncWasmGoDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'wasm-go runtime manifest was not found'
		);
	});

	it('fails when the vendored browser_wasi_shim runtime is missing from the dist bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmGoVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-manifest.v1.json', '{"manifestVersion":1}\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-build.json', '{"goVersion":"1.26.1"}\n');

		await expect(syncWasmGoDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'vendored browser_wasi_shim'
		);
	});
});
