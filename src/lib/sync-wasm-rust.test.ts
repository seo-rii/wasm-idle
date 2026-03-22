import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmRustDist } from '../../scripts/sync-wasm-rust.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-rust-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
}

describe('syncWasmRustDist', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('copies the built wasm-rust browser bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default "compiler";\n');
		await writeFixtureFile(sourceDir, 'runtime/runtime-manifest.v3.json', '{"manifestVersion":3}\n');
		await writeFixtureFile(sourceDir, 'runtime/rustc/rustc.wasm.gz', 'gzip-rustc');
		await writeFixtureFile(
			sourceDir,
			'runtime/packs/sysroot/wasm32-wasip1.index.json.gz',
			'gzip-sysroot-index'
		);
		await writeFixtureFile(
			sourceDir,
			'runtime/packs/link/wasm32-wasip1.pack.gz',
			'gzip-link-pack'
		);
		await writeFixtureFile(sourceDir, 'runtime/llvm/llc.wasm', 'llc');
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');
		await writeFixtureFile(sourceDir, 'vendor/browser_wasi_shim/tsconfig.tsbuildinfo', 'ignored');

		const result = await syncWasmRustDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'compiler'
		);
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-manifest.v3.json'), 'utf8')
		).resolves.toContain('"manifestVersion":3');
		await expect(
			readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm.gz'), 'utf8')
		).resolves.toBe('gzip-rustc');
		await expect(readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(
				path.join(targetDir, 'runtime/packs/sysroot/wasm32-wasip1.index.json.gz'),
				'utf8'
			)
		).resolves.toBe('gzip-sysroot-index');
		await expect(
			readFile(path.join(targetDir, 'runtime/packs/sysroot/wasm32-wasip1.index.json'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/packs/link/wasm32-wasip1.pack.gz'), 'utf8')
		).resolves.toBe('gzip-link-pack');
		await expect(
			readFile(path.join(targetDir, 'runtime/packs/link/wasm32-wasip1.pack'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/llvm/llc.wasm'), 'utf8')).resolves.toBe(
			'llc'
		);
		await expect(readFile(path.join(targetDir, 'types.d.ts'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'vendor/browser_wasi_shim/tsconfig.tsbuildinfo'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_RUST_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('clears stale files from the previous synced bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');

		await syncWasmRustDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'export default 1'
		);
		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).rejects.toThrow();
	});

	it('fails with a build hint when the wasm-rust dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await expect(syncWasmRustDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-rust first'
		);
	});
});
