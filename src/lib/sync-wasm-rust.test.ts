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

async function writeRustLlvmProfileFixture(sourceDir: string, includeLld = false) {
	await writeFixtureFile(
		sourceDir,
		'runtime/runtime-manifest.v3.json',
		JSON.stringify({
			manifestVersion: 3,
			version: 'rust-1.79.0-dev-browser-split-v3',
			compiler: { rustcWasm: 'rustc/rustc.wasm.gz' },
			targets: {
				'wasm32-wasip1': {
					compile: {
						llvm: {
							llc: 'llvm/llc.js',
							llcWasm: 'llvm/llc.wasm.gz',
							lld: 'llvm/lld.js',
							lldWasm: 'llvm/lld.wasm.gz',
							lldData: 'llvm/lld.data.gz'
						}
					}
				}
			}
		})
	);
	await writeFixtureFile(sourceDir, 'runtime/rustc/rustc.wasm.gz', 'gzip-rustc');
	await writeFixtureFile(sourceDir, 'runtime/llvm/llc.js', 'llc-js');
	await writeFixtureFile(sourceDir, 'runtime/llvm/llc.wasm.gz', 'gzip-llc');
	await writeFixtureFile(sourceDir, 'runtime/llvm/lld.js', 'lld-js');
	if (includeLld) {
		await writeFixtureFile(sourceDir, 'runtime/llvm/lld.wasm.gz', 'gzip-lld-wasm');
		await writeFixtureFile(sourceDir, 'runtime/llvm/lld.data.gz', 'gzip-lld-data');
	}
}

describe('syncWasmRustDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('loads Rust and Emscripten LLD contracts from wasm-idle', async () => {
		const source = await readFile(path.resolve('scripts', 'sync-wasm-rust.mjs'), 'utf8');

		expect(source).toContain("from './llvm-contracts/emscripten-lld.mjs'");
		expect(source).toContain("from './llvm-contracts/rust.mjs'");
		expect(source).not.toMatch(/from\s+['"]@seo-rii\/wasm-llvm/u);
	});

	it('copies the built wasm-rust browser bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		const sharedLldDir = await makeTempDir();

		await writeFixtureFile(sourceDir, 'index.js', 'export default "compiler";\n');
		await writeFixtureFile(
			sourceDir,
			'browser-execution.js',
			[
				"import { Fd, Inode } from '@bjorn3/browser_wasi_shim/dist/fd.js';",
				"import { PreopenDirectory } from '@bjorn3/browser_wasi_shim/dist/fs_mem.js';",
				"import WASI from '@bjorn3/browser_wasi_shim/dist/wasi.js';",
				"import * as wasi from '@bjorn3/browser_wasi_shim/dist/wasi_defs.js';",
				'export { Fd, Inode, PreopenDirectory, WASI, wasi };',
				''
			].join('\n')
		);
		await writeFixtureFile(
			sourceDir,
			'rustc-runtime.js',
			[
				"import { Directory, WASI } from '@bjorn3/browser_wasi_shim';",
				'export { Directory, WASI };',
				''
			].join('\n')
		);
		await writeRustLlvmProfileFixture(sourceDir, true);
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
		await writeFixtureFile(sharedLldDir, 'lld.js', 'lld-js');
		await writeFixtureFile(sharedLldDir, 'lld.wasm.gz', 'gzip-lld-wasm');
		await writeFixtureFile(sharedLldDir, 'lld.data.gz', 'gzip-lld-data');
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/index.js',
			'export const WASI = class WASI {};\nexport const Directory = class Directory {};\n'
		);
		await writeFixtureFile(sourceDir, 'vendor/browser_wasi_shim/fd.js', 'export class Fd {}\n');
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/fs_mem.js',
			'export class PreopenDirectory {}\n'
		);
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/wasi.js',
			'export default class WASI {}\n'
		);
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/wasi_defs.js',
			'export const ERRNO_SUCCESS = 0;\n'
		);
		await writeFixtureFile(
			sourceDir,
			'vendor/browser_wasi_shim/tsconfig.tsbuildinfo',
			'ignored'
		);

		const result = await syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			sharedLldDir
		});
		await expect(readFile(path.join(sharedLldDir, 'lld.data.gz'), 'utf8')).resolves.toBe(
			'gzip-lld-data'
		);

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'compiler'
		);
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/fd.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/fs_mem.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/wasi.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/wasi_defs.js');
		await expect(readFile(path.join(targetDir, 'rustc-runtime.js'), 'utf8')).resolves.toContain(
			'./vendor/browser_wasi_shim/index.js'
		);
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-manifest.v3.json'), 'utf8')
		).resolves.toContain('../../shared/emscripten-lld/lld.wasm.gz');
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-manifest.v3.json'), 'utf8')
		).resolves.toContain('../../shared/emscripten-lld/lld.js');
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.js'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm.gz'), 'utf8')
		).resolves.toBe('gzip-rustc');
		await expect(
			readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm'), 'utf8')
		).rejects.toThrow();
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
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/llc.wasm.gz'), 'utf8')
		).resolves.toBe('gzip-llc');
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/llc.wasm'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.wasm.gz'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.wasm'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.data.gz'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.data'), 'utf8')
		).rejects.toThrow();
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
		await writeRustLlvmProfileFixture(sourceDir);
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');

		await syncWasmRustDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'export default 1'
		);
		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).rejects.toThrow();
	});

	it('syncs an integrated producer runtime without shared LLVM assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		const sharedLldDir = await makeTempDir();

		await writeFixtureFile(sourceDir, 'index.js', 'export default "integrated";\n');
		await writeFixtureFile(
			sourceDir,
			'runtime/runtime-manifest.v3.json',
			JSON.stringify({
				manifestVersion: 3,
				version: 'rust-1.99.0-browser-integrated-v1',
				producer: {
					id: '@seo-rii/wasm-llvm/rust-browser',
					manifestSha256: 'a'.repeat(64),
					runner: 'container'
				},
				compiler: { rustcWasm: 'rustc/rustc.wasm.gz' },
				targets: {
					'wasm32-wasip1': {
						sysrootPack: {
							asset: 'packs/sysroot/wasm32-wasip1.pack.gz',
							index: 'packs/sysroot/wasm32-wasip1.index.json.gz'
						},
						compile: { kind: 'integrated-rustc' }
					}
				}
			})
		);
		await writeFixtureFile(sourceDir, 'runtime/rustc/rustc.wasm.gz', 'rustc');
		await writeFixtureFile(sourceDir, 'runtime/packs/sysroot/wasm32-wasip1.pack.gz', 'pack');
		await writeFixtureFile(
			sourceDir,
			'runtime/packs/sysroot/wasm32-wasip1.index.json.gz',
			'index'
		);

		await syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			sharedLldDir
		});

		await expect(
			readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm.gz'), 'utf8')
		).resolves.toBe('rustc');
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/llc.js'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(sharedLldDir, 'lld.js'), 'utf8')).rejects.toThrow();
	});

	it('fails with a build hint when the wasm-rust dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await expect(syncWasmRustDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-rust first'
		);
	});

	it('fails when a bare browser_wasi_shim import cannot be rewritten to a vendored runtime file', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await writeFixtureFile(
			sourceDir,
			'browser-execution.js',
			"import { Fd } from '@bjorn3/browser_wasi_shim/dist/fd.js';\nexport { Fd };\n"
		);
		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		await writeRustLlvmProfileFixture(sourceDir);

		await expect(syncWasmRustDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'vendored browser_wasi_shim'
		);
	});
});
