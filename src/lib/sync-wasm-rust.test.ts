import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	cp,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	rename,
	rm,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN,
	RUST_EXECUTABLE_GRAPH_FORMAT,
	RUST_EXECUTABLE_GRAPH_INERT_SUFFIX,
	RUST_EXECUTABLE_GRAPH_LOCK_FORMAT,
	RUST_EXECUTABLE_GRAPH_MANIFEST_PATH,
	computeRustExecutableGraphFingerprint,
	createRustExecutableGraphLockSource,
	extractRustExecutableModuleEdges,
	getRustSyncControlPaths,
	inspectRustExecutableGraph,
	parseRustExecutableGraphLock,
	syncWasmRustDist
} from '../../scripts/sync-wasm-rust.mjs';

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

async function writeGraphLockForSource(
	sourceDir: string,
	{ gzipModulePaths = [] }: { gzipModulePaths?: readonly string[] } = {}
) {
	const explicitDir = path.join(await makeTempDir(), 'explicit');
	await cp(sourceDir, explicitDir, { recursive: true });
	for (const modulePath of ['browser-execution.js', 'rustc-runtime.js']) {
		const filePath = path.join(explicitDir, modulePath);
		const source = await readFile(filePath, 'utf8').catch(() => null);
		if (source === null) continue;
		const rewritten = source
			.replaceAll('@bjorn3/browser_wasi_shim/dist/fd.js', './vendor/browser_wasi_shim/fd.js')
			.replaceAll(
				'@bjorn3/browser_wasi_shim/dist/fs_mem.js',
				'./vendor/browser_wasi_shim/fs_mem.js'
			)
			.replaceAll(
				'@bjorn3/browser_wasi_shim/dist/wasi.js',
				'./vendor/browser_wasi_shim/wasi.js'
			)
			.replaceAll(
				'@bjorn3/browser_wasi_shim/dist/wasi_defs.js',
				'./vendor/browser_wasi_shim/wasi_defs.js'
			)
			.replaceAll('@bjorn3/browser_wasi_shim', './vendor/browser_wasi_shim/index.js');
		await writeFile(filePath, rewritten, 'utf8');
	}
	const explicitProfile = await inspectRustExecutableGraph(explicitDir, 'explicit-dist');
	const publishedDir = path.join(await makeTempDir(), 'published');
	await cp(explicitDir, publishedDir, { recursive: true });
	const gzipModules = new Set(gzipModulePaths);
	for (const modulePath of Object.keys(explicitProfile.modules)) {
		const logicalPath = path.join(publishedDir, modulePath);
		const storagePath = gzipModules.has(modulePath)
			? `${logicalPath}.gz${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`
			: `${logicalPath}${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`;
		const logicalBytes = await readFile(logicalPath);
		await writeFile(
			storagePath,
			gzipModules.has(modulePath) ? gzipSync(logicalBytes, { level: 9 }) : logicalBytes
		);
		await unlink(logicalPath);
	}
	const publishedProfile = await inspectRustExecutableGraph(publishedDir, 'published-static');
	const graphLockPath = path.join(await makeTempDir(), 'wasm-rust-assets.lock.json');
	await writeFile(
		graphLockPath,
		createRustExecutableGraphLockSource({
			publishedStaticProfile: publishedProfile,
			explicitDistProfile: explicitProfile
		})
	);
	return graphLockPath;
}

async function syncFixture(
	options: Parameters<typeof syncWasmRustDist>[0] & { sourceDir: string }
) {
	return syncWasmRustDist({
		...options,
		graphLockPath: options.graphLockPath || (await writeGraphLockForSource(options.sourceDir))
	});
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

async function writeIntegratedRuntimeFixture(
	sourceDir: string,
	entrySource = 'export default 1;\n'
) {
	await writeFixtureFile(sourceDir, 'index.js', entrySource);
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
	await writeFixtureFile(sourceDir, 'runtime/packs/sysroot/wasm32-wasip1.index.json.gz', 'index');
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
				'const entryUrl = URL.createObjectURL(new Blob([]));',
				'export const loadEntry = () => import(entryUrl);',
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
		await writeIntegratedRuntimeFixture(
			sourceDir,
			[
				"import './browser-execution.js';",
				"import './rustc-runtime.js';",
				'export default "compiler";',
				''
			].join('\n')
		);
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
			'tmp-public-api-types-123-456.js',
			'export const Transient = true;\n'
		);
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

		const result = await syncFixture({
			sourceDir,
			targetDir,
			versionModulePath,
			sharedLldDir
		});
		await expect(readFile(path.join(sharedLldDir, 'lld.data.gz'), 'utf8')).resolves.toBe(
			'gzip-lld-data'
		);

		await expect(readFile(path.join(targetDir, 'index.js.bin'), 'utf8')).resolves.toContain(
			'compiler'
		);
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js.bin'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/fd.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js.bin'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/fs_mem.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js.bin'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/wasi.js');
		await expect(
			readFile(path.join(targetDir, 'browser-execution.js.bin'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/wasi_defs.js');
		await expect(
			readFile(path.join(targetDir, 'rustc-runtime.js.bin'), 'utf8')
		).resolves.toContain('./vendor/browser_wasi_shim/index.js');
		for (const modulePath of Object.keys(result.executableGraphProfile.modules)) {
			expect(result.executableGraphProfile.modules[modulePath].delivery.storagePath).toMatch(
				/\.bin$/u
			);
			await expect(readFile(path.join(targetDir, modulePath))).rejects.toThrow();
			await expect(readFile(path.join(targetDir, `${modulePath}.gz`))).rejects.toThrow();
		}
		await expect(
			readFile(path.join(targetDir, 'runtime/runtime-manifest.v3.json'), 'utf8')
		).resolves.not.toContain('../../shared/emscripten-lld/');
		await expect(
			readFile(path.join(targetDir, 'runtime/llvm/lld.js'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'runtime/rustc/rustc.wasm.gz'), 'utf8')
		).resolves.toBe('rustc');
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
		).rejects.toThrow();
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
			readFile(path.join(targetDir, 'tmp-public-api-types-123-456.js'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'vendor/browser_wasi_shim/tsconfig.tsbuildinfo'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			'export const WASM_RUST_RUNTIME_PROFILE = Object.freeze('
		);
		expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			'export const WASM_RUST_ASSET_VERSION = WASM_RUST_RUNTIME_PROFILE.manifestFingerprint;'
		);
		const syncedManifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime/runtime-manifest.v3.json'), 'utf8')
		);
		expect(Object.keys(syncedManifest.assetReceipts).sort()).toEqual([
			'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.index.json.gz',
			'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.pack.gz',
			'wasm-rust/runtime/rustc/rustc.wasm.gz'
		]);
	});

	it('clears stale files from the previous synced bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		const sharedLldDir = await makeTempDir();

		await writeIntegratedRuntimeFixture(sourceDir);
		await writeFixtureFile(sharedLldDir, 'lld.js', 'lld-js');
		await writeFixtureFile(sharedLldDir, 'lld.wasm.gz', 'gzip-lld-wasm');
		await writeFixtureFile(sharedLldDir, 'lld.data.gz', 'gzip-lld-data');
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');

		await syncFixture({ sourceDir, targetDir, versionModulePath, sharedLldDir });

		await expect(readFile(path.join(targetDir, 'index.js.bin'), 'utf8')).resolves.toContain(
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

		await syncFixture({
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

	it('rejects non-canonical runtime asset paths without replacing the installed bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

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
							asset: '../escaped.pack',
							index: 'packs/sysroot/wasm32-wasip1.index.json.gz'
						},
						compile: { kind: 'integrated-rustc' }
					}
				}
			})
		);
		await writeFixtureFile(sourceDir, 'runtime/rustc/rustc.wasm.gz', 'rustc');
		await writeFixtureFile(
			sourceDir,
			'runtime/packs/sysroot/wasm32-wasip1.index.json.gz',
			'index'
		);
		await writeFixtureFile(targetDir, 'keep.txt', 'existing-runtime');
		await writeFile(versionModulePath, 'old-version');

		await expect(syncFixture({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'non-canonical path'
		);
		await expect(readFile(path.join(targetDir, 'keep.txt'), 'utf8')).resolves.toBe(
			'existing-runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old-version');
	});

	it('fails with a build hint when the wasm-rust dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');

		await expect(syncWasmRustDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-rust first'
		);
	});

	it('fails closed for a legacy split-LLVM explicit dist', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeFixtureFile(sourceDir, 'index.js', 'export default "legacy";\n');
		await writeRustLlvmProfileFixture(sourceDir, true);
		await writeFixtureFile(targetDir, 'keep.txt', 'existing-runtime');
		await writeFile(versionModulePath, 'old-version');

		await expect(syncFixture({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'explicit dist executable graph requires the integrated Rust producer'
		);
		await expect(readFile(path.join(targetDir, 'keep.txt'), 'utf8')).resolves.toBe(
			'existing-runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old-version');
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
		await writeIntegratedRuntimeFixture(sourceDir);
		await writeFixtureFile(targetDir, 'keep.txt', 'existing-runtime');
		await writeFixtureFile(
			path.dirname(versionModulePath),
			path.basename(versionModulePath),
			'old-version'
		);

		await expect(syncFixture({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'vendored browser_wasi_shim'
		);
		await expect(readFile(path.join(targetDir, 'keep.txt'), 'utf8')).resolves.toBe(
			'existing-runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old-version');
	});
});

describe('Rust executable graph producer', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('pins worker URL construction and exact thread-worker pass-through semantics', () => {
		const compilerSource = [
			"const workerUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './compiler-worker.js');",
			'const worker = (dependencies.createWorker || ((url) => createModuleWorker(url)))(workerUrl);'
		].join('\n');
		expect(
			extractRustExecutableModuleEdges(compilerSource, 'compiler.js').imports
		).toContainEqual({
			kind: 'worker',
			specifier: './compiler-worker.js',
			target: 'compiler-worker.js'
		});
		expect(() =>
			extractRustExecutableModuleEdges(
				compilerSource.replace(')(workerUrl)', ')(evilWorkerUrl)'),
				'compiler.js'
			)
		).toThrow('worker edge');
		expect(() =>
			extractRustExecutableModuleEdges(
				compilerSource.replace(
					'const worker =',
					'const worker = (() => { const workerUrl = evilWorkerUrl; return'
				) + ' })();',
				'compiler.js'
			)
		).toThrow('worker edge');

		expect(
			extractRustExecutableModuleEdges(
				[
					"const threadWorkerUrl = resolveVersionedAssetUrl(import.meta.url, './rustc-thread-worker.js');",
					'const worker = createModuleWorker(threadWorkerUrl);',
					'const request = { rustcThreadWorkerUrl: threadWorkerUrl.toString() };'
				].join('\n'),
				'compiler-worker.js'
			).imports
		).toContainEqual({
			kind: 'worker',
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js'
		});
		expect(() =>
			extractRustExecutableModuleEdges(
				[
					"const threadWorkerUrl = resolveVersionedAssetUrl(import.meta.url, './rustc-thread-worker.js');",
					'{ const threadWorkerUrl = evilWorkerUrl; createModuleWorker(threadWorkerUrl); }',
					'const request = { rustcThreadWorkerUrl: threadWorkerUrl.toString() };'
				].join('\n'),
				'compiler-worker.js'
			)
		).toThrow('worker edge');

		expect(
			extractRustExecutableModuleEdges(
				[
					'const nestedThreadWorkerUrl = new URL(request.rustcThreadWorkerUrl);',
					'createModuleWorker(nestedThreadWorkerUrl);',
					'const nestedRequest = { rustcThreadWorkerUrl: request.rustcThreadWorkerUrl };'
				].join('\n'),
				'rustc-thread-worker.js'
			).imports
		).toContainEqual({
			kind: 'worker',
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js'
		});

		expect(() =>
			extractRustExecutableModuleEdges(
				'const nestedThreadWorkerUrl = new URL(import.meta.url); createModuleWorker(nestedThreadWorkerUrl);',
				'rustc-thread-worker.js'
			)
		).toThrow('worker URL pass-through');
		expect(
			extractRustExecutableModuleEdges(
				"export function createModuleWorker(moduleUrl) { return new Worker(moduleUrl, { type: 'module' }); }",
				'module-worker.js'
			).imports
		).toEqual([]);
		expect(() =>
			extractRustExecutableModuleEdges(
				'export function createModuleWorker(moduleUrl) { return new Worker(moduleUrl); }',
				'module-worker.js'
			)
		).toThrow('Worker boundary');
	});

	it('pins manifest-driven llc/lld imports for both dynamic import boundaries', async () => {
		const rootDir = await makeTempDir();
		await writeFixtureFile(
			rootDir,
			'index.js',
			"import './browser-linker.js';\nimport './compiler-preload.js';\n"
		);
		await writeFixtureFile(
			rootDir,
			'browser-linker.js',
			'export const loadRuntimeModule = (assetUrl) => import(assetUrl);\n'
		);
		await writeFixtureFile(
			rootDir,
			'compiler-preload.js',
			[
				'const defaultImportRuntimeModule = (assetUrl) => import(assetUrl);',
				'const PREVIEW2_COMPONENT_RUNTIME_ASSETS = [];',
				'for (const assetPath of PREVIEW2_COMPONENT_RUNTIME_ASSETS) void assetPath;',
				'export { defaultImportRuntimeModule };'
			].join('\n')
		);
		await writeFixtureFile(
			rootDir,
			'runtime/runtime-manifest.v3.json',
			JSON.stringify({
				targets: {
					'wasm32-wasip1': {
						compile: { llvm: { llc: 'llvm/llc.js', lld: 'llvm/lld.js' } }
					}
				}
			})
		);
		await writeFixtureFile(rootDir, 'runtime/llvm/llc.js', 'export default class Llc {}\n');
		await writeFixtureFile(rootDir, 'runtime/llvm/lld.js', 'export default class Lld {}\n');
		for (const modulePath of [
			'vendor/jco/src/browser.js',
			'vendor/preview2-shim/lib/browser/cli.js',
			'vendor/preview2-shim/lib/browser/clocks.js',
			'vendor/preview2-shim/lib/browser/filesystem.js',
			'vendor/preview2-shim/lib/browser/http.js',
			'vendor/preview2-shim/lib/browser/io.js',
			'vendor/preview2-shim/lib/browser/random.js',
			'vendor/preview2-shim/lib/browser/sockets.js'
		]) {
			await writeFixtureFile(rootDir, modulePath, 'export default {};\n');
		}
		await writeFixtureFile(
			rootDir,
			'vendor/jco/obj/wasm-tools.js',
			[
				"const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;",
				'async function fetchCompile(url) {',
				"  if (isNode) return import('node:fs/promises');",
				'  const assetUrl = new URL(url);',
				"  if (assetUrl.pathname.endsWith('.core.wasm')) assetUrl.pathname += '.gz';",
				"  return fetchRuntimeAssetBytes(assetUrl, 'core');",
				'}',
				"const core = fetchCompile(new URL('./wasm-tools.core.wasm', import.meta.url));",
				"const core2 = fetchCompile(new URL('./wasm-tools.core2.wasm', import.meta.url));",
				'export { core, core2 };'
			].join('\n')
		);
		await writeFixtureFile(rootDir, 'vendor/jco/obj/wasm-tools.core.wasm.gz', 'core');
		await writeFixtureFile(rootDir, 'vendor/jco/obj/wasm-tools.core2.wasm', 'core2');

		const profile = await inspectRustExecutableGraph(rootDir, 'explicit-dist');
		for (const importer of ['browser-linker.js', 'compiler-preload.js']) {
			expect(profile.modules[importer].imports).toEqual(
				expect.arrayContaining([
					{
						kind: 'dynamic',
						specifier: 'llvm/llc.js',
						target: 'runtime/llvm/llc.js'
					},
					{
						kind: 'dynamic',
						specifier: 'llvm/lld.js',
						target: 'runtime/llvm/lld.js'
					}
				])
			);
		}
		expect(() =>
			extractRustExecutableModuleEdges(
				[
					'const loadRuntimeModule = (assetUrl) => {',
					'  const nested = () => { const assetUrl = evilUrl; return import(assetUrl); };',
					'  return nested();',
					'};'
				].join('\n'),
				'browser-linker.js'
			)
		).toThrow('dynamic import dataflow');
		expect(() =>
			extractRustExecutableModuleEdges(
				'const entryUrl = evilUrl; export const run = async () => import(entryUrl);',
				'browser-execution.js'
			)
		).toThrow('dynamic import dataflow');
		expect(Object.keys(profile.modules)).toHaveLength(14);
		const wasmToolsSource = await readFile(
			path.join(rootDir, 'vendor/jco/obj/wasm-tools.js'),
			'utf8'
		);
		const unconditionalNodeImport = wasmToolsSource.replace(
			"if (isNode) return import('node:fs/promises')",
			"return import('node:fs/promises')"
		);
		expect(() =>
			extractRustExecutableModuleEdges(
				unconditionalNodeImport,
				'vendor/jco/obj/wasm-tools.js'
			)
		).toThrow('node-only import');
		const shadowedNodeGuard = wasmToolsSource.replace(
			"if (isNode) return import('node:fs/promises')",
			"function isNode() {} if (isNode) return import('node:fs/promises')"
		);
		expect(() =>
			extractRustExecutableModuleEdges(shadowedNodeGuard, 'vendor/jco/obj/wasm-tools.js')
		).toThrow('node-only import');
		const disconnectedCoreDelivery = wasmToolsSource.replace(
			"if (assetUrl.pathname.endsWith('.core.wasm')) assetUrl.pathname += '.gz';",
			"const decoyAssetUrl = new URL(url); if (decoyAssetUrl.pathname.endsWith('.core.wasm')) decoyAssetUrl.pathname += '.gz';"
		);
		expect(() =>
			extractRustExecutableModuleEdges(
				disconnectedCoreDelivery,
				'vendor/jco/obj/wasm-tools.js'
			)
		).toThrow('core asset dataflow');
	});

	it('records gzip storage and logical receipts and fingerprints deterministically', async () => {
		const rootDir = await makeTempDir();
		const source = Buffer.from('export default 1;\n');
		await writeFile(path.join(rootDir, 'index.js.gz.bin'), gzipSync(source));

		const first = await inspectRustExecutableGraph(rootDir, 'published-static');
		const second = await inspectRustExecutableGraph(rootDir, 'published-static');
		expect(first).toEqual(second);
		expect(first.modules['index.js']).toMatchObject({
			delivery: { storagePath: 'index.js.gz.bin', encoding: 'gzip' },
			logical: {
				bytes: source.byteLength,
				sha256: createHash('sha256').update(source).digest('hex')
			}
		});
		expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(RUST_EXECUTABLE_GRAPH_FORMAT).toBe('wasm-idle-rust-executable-graph-v1');
		expect(RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN).toBe(
			'wasm-idle:rust-executable-graph:v1\n'
		);
		expect(RUST_EXECUTABLE_GRAPH_INERT_SUFFIX).toBe('.bin');
		await writeFile(path.join(rootDir, 'index.js'), source);
		await expect(inspectRustExecutableGraph(rootDir, 'published-static')).rejects.toThrow(
			'retains executable storage'
		);
		await unlink(path.join(rootDir, 'index.js'));
		await expect(inspectRustExecutableGraph(rootDir, 'explicit-dist')).rejects.toThrow(
			'explicit dist must contain only logical JavaScript'
		);
	});

	it('rejects duplicate, unknown, corrupt, and unsafe graph lock entries', async () => {
		const sourceDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'index.js', 'export default 1;\n');
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		const bytes = await readFile(graphLockPath);
		const parsedLock = parseRustExecutableGraphLock(bytes);
		expect(parsedLock.authorities['explicit-dist'].entryPath).toBe('index.js');
		expect(
			createRustExecutableGraphLockSource({
				publishedStaticProfile: parsedLock.authorities['published-static'],
				explicitDistProfile: parsedLock.authorities['explicit-dist']
			})
		).toBe(bytes.toString('utf8'));
		expect(bytes.toString('utf8')).toContain(
			`"format": "${RUST_EXECUTABLE_GRAPH_LOCK_FORMAT}"`
		);
		expect(bytes.toString('utf8').endsWith('\n')).toBe(true);

		const unknown = JSON.parse(bytes.toString('utf8'));
		unknown.authorities['explicit-dist'].modules[0].imports = [
			{ kind: 'static', specifier: './missing.js', target: 'missing.js' }
		];
		expect(() => parseRustExecutableGraphLock(Buffer.from(JSON.stringify(unknown)))).toThrow(
			'unknown edge'
		);

		const duplicate = JSON.parse(bytes.toString('utf8'));
		duplicate.authorities['published-static'].modules.push({
			...duplicate.authorities['published-static'].modules[0]
		});
		expect(() => parseRustExecutableGraphLock(Buffer.from(JSON.stringify(duplicate)))).toThrow(
			'repeats module'
		);

		const unsafe = JSON.parse(bytes.toString('utf8'));
		unsafe.authorities['published-static'].modules[0].path = '../index.js';
		expect(() => parseRustExecutableGraphLock(Buffer.from(JSON.stringify(unsafe)))).toThrow(
			'safe canonical relative path'
		);

		const executablePublishedPath = JSON.parse(bytes.toString('utf8'));
		executablePublishedPath.authorities['published-static'].modules[0].delivery.storagePath =
			'index.js';
		expect(() =>
			parseRustExecutableGraphLock(Buffer.from(JSON.stringify(executablePublishedPath)))
		).toThrow('delivery is invalid for published-static');
	});

	it('publishes the staged graph, runtime profile, and generated module together', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir);
		await writeFixtureFile(
			sourceDir,
			'vendor/preview2-shim/lib/browser/index.js',
			"export * from './missing-child.js';\n"
		);
		await writeFixtureFile(
			sourceDir,
			'debug-instrumenter.js',
			'export const debugOnly = true;\n'
		);
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		const result = await syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			graphLockPath
		});

		expect(result.sourceMode).toBe('explicit-dist');
		expect(result.executableGraphProfile.authority).toBe('published-static');
		expect(result.executableGraphProfile.modules['index.js'].delivery).toEqual({
			storagePath: 'index.js.bin',
			encoding: 'identity'
		});
		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'index.js.gz'), 'utf8')).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'index.js.bin'), 'utf8')).resolves.toContain(
			'export default 1'
		);
		await expect(
			readFile(path.join(targetDir, 'vendor/preview2-shim/lib/browser/index.js'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'debug-instrumenter.js'), 'utf8')).resolves.toBe(
			'export const debugOnly = true;\n'
		);
		expect(result.graphManifestPath).toBe(
			path.join(targetDir, RUST_EXECUTABLE_GRAPH_MANIFEST_PATH)
		);
		expect(JSON.parse(await readFile(result.graphManifestPath, 'utf8')).fingerprint).toBe(
			result.executableGraphProfile.fingerprint
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			'export const WASM_RUST_EXECUTABLE_GRAPH_PROFILE = Object.freeze('
		);
		expect((await lstat(versionModulePath)).mode & 0o777).toBe(0o644);

		await writeFixtureFile(targetDir, 'stale-unverified-entry.js', 'export default 1;\n');
		await writeFixtureFile(targetDir, 'stale-unverified-entry.js.gz', 'compressed executable');
		const refreshed = await syncWasmRustDist({
			targetDir,
			versionModulePath,
			graphLockPath
		});
		expect(refreshed.sourceMode).toBe('published-static');
		expect(refreshed.executableGraphProfile.authority).toBe('published-static');
		await expect(readFile(path.join(targetDir, 'stale-unverified-entry.js'))).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'stale-unverified-entry.js.gz'))
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'debug-instrumenter.js'), 'utf8')).resolves.toBe(
			'export const debugOnly = true;\n'
		);
		await expect(
			syncWasmRustDist({
				sourceDir: targetDir,
				targetDir,
				versionModulePath,
				graphLockPath
			})
		).rejects.toThrow('explicit dist source must be distinct');
	});

	it('reproduces lock-selected gzip bytes under an inert storage path', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir, 'export default "compressed";\n');
		const graphLockPath = await writeGraphLockForSource(sourceDir, {
			gzipModulePaths: ['index.js']
		});

		const result = await syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			graphLockPath
		});

		const logicalBytes = await readFile(path.join(sourceDir, 'index.js'));
		const expectedStorage = gzipSync(logicalBytes, { level: 9 });
		await expect(readFile(path.join(targetDir, 'index.js.gz.bin'))).resolves.toEqual(
			expectedStorage
		);
		expect(result.executableGraphProfile.modules['index.js']).toMatchObject({
			delivery: { storagePath: 'index.js.gz.bin', encoding: 'gzip' },
			storage: {
				bytes: expectedStorage.byteLength,
				sha256: createHash('sha256').update(expectedStorage).digest('hex')
			}
		});
		await expect(readFile(path.join(targetDir, 'index.js'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'index.js.gz'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'index.js.bin'))).rejects.toThrow();
	});

	it('derives the publication profile only from the isolated staging snapshot', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir, 'export default "snapshot";\n');
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		let mutated = false;
		const result = await syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			graphLockPath,
			renamePath: async (from, to) => {
				if (!mutated) {
					mutated = true;
					await writeFile(
						path.join(sourceDir, 'index.js'),
						'export default "mutated";\n'
					);
				}
				await rename(from, to);
			}
		});
		await expect(readFile(path.join(targetDir, 'index.js.bin'), 'utf8')).resolves.toContain(
			'"snapshot"'
		);
		await expect(readFile(path.join(sourceDir, 'index.js'), 'utf8')).resolves.toContain(
			'"mutated"'
		);
		const targetBytes = await readFile(path.join(targetDir, 'index.js.bin'));
		expect(result.executableGraphProfile.modules['index.js'].logical.sha256).toBe(
			createHash('sha256').update(targetBytes).digest('hex')
		);
	});

	it('rolls back both publications after an interrupted prepared transaction', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir, 'export default "new";\n');
		await writeFixtureFile(targetDir, 'keep.txt', 'old-runtime');
		await writeFile(versionModulePath, 'old-version');
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		let renameCount = 0;
		await expect(
			syncWasmRustDist({
				sourceDir,
				targetDir,
				versionModulePath,
				graphLockPath,
				renamePath: async (from, to) => {
					renameCount += 1;
					if (renameCount === 3) throw new Error('injected publication interruption');
					await rename(from, to);
				}
			})
		).rejects.toThrow('injected publication interruption');
		await expect(readFile(path.join(targetDir, 'keep.txt'), 'utf8')).resolves.toBe(
			'old-runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old-version');
		const controls = getRustSyncControlPaths(targetDir);
		await expect(lstat(controls.transactionMarkerPath)).rejects.toThrow();
	});

	it('fails closed on a live lock and serializes concurrent publishers', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir);
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		const controls = getRustSyncControlPaths(targetDir);
		await writeFile(controls.syncLockPath, 'stale-but-fail-closed');
		await expect(
			syncWasmRustDist({ sourceDir, targetDir, versionModulePath, graphLockPath })
		).rejects.toThrow('sync lock already exists');
		await expect(readFile(controls.syncLockPath, 'utf8')).resolves.toBe(
			'stale-but-fail-closed'
		);
		await unlink(controls.syncLockPath);

		let releaseRename!: () => void;
		let signalRename!: () => void;
		const renameGate = new Promise<void>((resolve) => {
			releaseRename = resolve;
		});
		const renameEntered = new Promise<void>((resolve) => {
			signalRename = resolve;
		});
		let paused = false;
		const first = syncWasmRustDist({
			sourceDir,
			targetDir,
			versionModulePath,
			graphLockPath,
			renamePath: async (from, to) => {
				if (!paused) {
					paused = true;
					signalRename();
					await renameGate;
				}
				await rename(from, to);
			}
		});
		await renameEntered;
		await expect(
			syncWasmRustDist({ sourceDir, targetDir, versionModulePath, graphLockPath })
		).rejects.toThrow('sync lock already exists');
		releaseRename();
		await expect(first).resolves.toMatchObject({ sourceMode: 'explicit-dist' });
	});

	it('serializes distinct runtime targets that share one generated version output', async () => {
		const firstSourceDir = await makeTempDir();
		const secondSourceDir = await makeTempDir();
		const firstTargetDir = await makeTempDir();
		const secondTargetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'sharedWasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(firstSourceDir);
		await writeIntegratedRuntimeFixture(secondSourceDir);
		const firstGraphLockPath = await writeGraphLockForSource(firstSourceDir);
		const secondGraphLockPath = await writeGraphLockForSource(secondSourceDir);
		let releaseRename!: () => void;
		let signalRename!: () => void;
		const renameGate = new Promise<void>((resolve) => {
			releaseRename = resolve;
		});
		const renameEntered = new Promise<void>((resolve) => {
			signalRename = resolve;
		});
		let paused = false;
		const first = syncWasmRustDist({
			sourceDir: firstSourceDir,
			targetDir: firstTargetDir,
			versionModulePath,
			graphLockPath: firstGraphLockPath,
			renamePath: async (from, to) => {
				if (!paused) {
					paused = true;
					signalRename();
					await renameGate;
				}
				await rename(from, to);
			}
		});
		await renameEntered;
		await expect(
			syncWasmRustDist({
				sourceDir: secondSourceDir,
				targetDir: secondTargetDir,
				versionModulePath,
				graphLockPath: secondGraphLockPath
			})
		).rejects.toThrow('sync lock already exists');
		releaseRename();
		await expect(first).resolves.toMatchObject({ targetDir: firstTargetDir });
	});

	it('rejects symlinks and control-path collisions without deleting inputs', async () => {
		const inspectorRoot = await makeTempDir();
		const escapedDirectory = await makeTempDir();
		await writeFixtureFile(inspectorRoot, 'index.js', "import './nested/module.js';\n");
		await writeFixtureFile(escapedDirectory, 'module.js', 'export default "escaped";\n');
		await symlink(escapedDirectory, path.join(inspectorRoot, 'nested'));
		await expect(inspectRustExecutableGraph(inspectorRoot, 'explicit-dist')).rejects.toThrow(
			'symbolic-link boundary'
		);

		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmRustVersion.ts');
		await writeIntegratedRuntimeFixture(sourceDir);
		const graphLockPath = await writeGraphLockForSource(sourceDir);
		const outside = path.join(await makeTempDir(), 'outside.js');
		await writeFile(outside, 'export default "outside";\n');
		await unlink(path.join(sourceDir, 'index.js'));
		await symlink(outside, path.join(sourceDir, 'index.js'));
		await writeFixtureFile(targetDir, 'keep.txt', 'keep');
		await writeFile(versionModulePath, 'old-version');

		await expect(
			syncWasmRustDist({ sourceDir, targetDir, versionModulePath, graphLockPath })
		).rejects.toThrow('non-regular path');
		await expect(readFile(path.join(targetDir, 'keep.txt'), 'utf8')).resolves.toBe('keep');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old-version');

		const lockBytes = await readFile(graphLockPath);
		await expect(
			syncWasmRustDist({
				sourceDir,
				targetDir,
				versionModulePath,
				graphLockPath,
				syncLockPath: graphLockPath
			})
		).rejects.toThrow('custom sync control paths are not supported');
		await expect(readFile(graphLockPath)).resolves.toEqual(lockBytes);

		const markerPath = path.join(await makeTempDir(), 'marker');
		const markerTemporaryLock = `${markerPath}.next`;
		await writeFile(markerTemporaryLock, lockBytes);
		await expect(
			syncWasmRustDist({
				sourceDir,
				targetDir,
				versionModulePath,
				graphLockPath: markerTemporaryLock,
				transactionMarkerPath: markerPath
			})
		).rejects.toThrow('custom sync control paths are not supported');
		await expect(readFile(markerTemporaryLock)).resolves.toEqual(lockBytes);
	});
});
