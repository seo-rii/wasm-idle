import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
	createRuntimeManifest,
	createRuntimeManifestV2,
	createRuntimeManifestV3
} from './helpers.js';
import {
	defaultRuntimeTargetTriples,
	defaultRustcMemoryInitialPages,
	distRoot as prepareRuntimeDistRoot,
	isReusablePrebuiltRuntimeBundle,
	llvmWasmRoot as prepareRuntimeLlvmWasmRoot,
	matchingNativeToolchainRoot as prepareRuntimeMatchingNativeToolchainRoot,
	projectRoot as prepareRuntimeProjectRoot,
	runtimeRoot as prepareRuntimeRuntimeRoot,
	wasmRustcRoot as prepareRuntimeWasmRustcRoot
} from '../scripts/prepare-runtime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');
const builtBrowserBundle =
	process.env.WASM_RUST_SKIP_DIST_TESTS === '1'
		? describe.skip
		: existsSync(distRoot)
			? describe
			: describe.skip;

async function listFiles(rootPath: string): Promise<string[]> {
	const entries = await fs.readdir(rootPath, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(fullPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files.sort();
}

async function measureTotalBytes(filePaths: string[]) {
	let total = 0;
	for (const filePath of filePaths) {
		total += (await fs.stat(filePath)).size;
	}
	return total;
}

async function pathExists(targetPath: string) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function collectNestedWasiSdkRoots(baseRoot: string): Promise<string[]> {
	if (!(await pathExists(baseRoot))) {
		return [];
	}
	const entries = await fs.readdir(baseRoot, { withFileTypes: true });
	const candidates: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const fullPath = path.join(baseRoot, entry.name);
		if (entry.name.startsWith('wasi-sdk-')) {
			candidates.push(fullPath);
			continue;
		}
		if (!entry.name.startsWith('wasm-rust')) {
			continue;
		}
		const nestedEntries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
		for (const nestedEntry of nestedEntries) {
			if (!nestedEntry.isDirectory() || !nestedEntry.name.startsWith('wasi-sdk-')) {
				continue;
			}
			candidates.push(path.join(fullPath, nestedEntry.name));
		}
	}
	return candidates;
}

async function hasCompatibleWasiSdk() {
	const configuredRoot = process.env.WASM_RUST_WASI_SDK_ROOT || process.env.WASI_SDK_PATH || '';
	if (configuredRoot) {
		return pathExists(path.join(configuredRoot, 'bin', 'wasm-component-ld'));
	}
	for (const candidate of [
		...(await collectNestedWasiSdkRoots(
			path.dirname(path.dirname(prepareRuntimeWasmRustcRoot))
		)),
		...(await collectNestedWasiSdkRoots(path.join(os.homedir(), '.cache')))
	]) {
		if (await pathExists(path.join(candidate, 'bin', 'wasm-component-ld'))) {
			return true;
		}
	}
	return false;
}

async function hasTargetSysroot(targetTriple: string) {
	return pathExists(
		path.join(prepareRuntimeWasmRustcRoot, 'lib', 'rustlib', targetTriple, 'lib')
	);
}

describe('prepare-runtime defaults', () => {
	it('derives toolchain cache defaults from the current home directory', () => {
		expect(prepareRuntimeWasmRustcRoot).toBe(
			process.env.WASM_RUST_RUSTC_ROOT ||
				path.join(
					os.homedir(),
					'.cache',
					'wasm-rust-real-rustc-20260317',
					'rust',
					'dist-emit-ir'
				)
		);
		expect(prepareRuntimeMatchingNativeToolchainRoot).toBe(
			process.env.WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT ||
				path.join(
					os.homedir(),
					'.cache',
					'wasm-rust-real-rustc-20260317',
					'rust',
					'build',
					'x86_64-unknown-linux-gnu',
					'stage2'
				)
		);
		expect(prepareRuntimeLlvmWasmRoot).toBe(
			process.env.WASM_RUST_LLVM_WASM_ROOT ||
				path.join(os.homedir(), '.cache', 'llvm-wasm-20260319')
		);
	});

	it('accepts a prebuilt runtime bundle only when supported manifest assets are present', async () => {
		for (const [manifestFileName, manifestContents, missingAssetRelativePath] of [
			['runtime-manifest.json', createRuntimeManifest(), 'link/alloc.o'],
			[
				'runtime-manifest.v2.json',
				createRuntimeManifestV2(),
				'sysroot/lib/rustlib/wasm32-wasip1/lib/libstd.rlib'
			],
			[
				'runtime-manifest.v3.json',
				createRuntimeManifestV3(),
				'packs/link/wasm32-wasip1.index.json.gz'
			]
		] as const) {
			const tempRoot = await fs.mkdtemp(
				path.join(os.tmpdir(), 'wasm-rust-runtime-fallback-')
			);
			const tempRuntimeRoot = path.join(tempRoot, 'runtime');
			await fs.mkdir(path.join(tempRuntimeRoot, 'rustc'), { recursive: true });
			await fs.mkdir(path.join(tempRuntimeRoot, 'llvm'), { recursive: true });
			await fs.mkdir(path.join(tempRuntimeRoot, 'link'), { recursive: true });
			await fs.mkdir(path.join(tempRuntimeRoot, 'packs', 'sysroot'), { recursive: true });
			await fs.mkdir(path.join(tempRuntimeRoot, 'packs', 'link'), { recursive: true });
			await fs.mkdir(
				path.join(tempRuntimeRoot, 'sysroot', 'lib', 'rustlib', 'wasm32-wasip1', 'lib'),
				{
					recursive: true
				}
			);
			await fs.mkdir(
				path.join(tempRuntimeRoot, 'sysroot', 'lib', 'rustlib', 'wasm32-wasip2', 'lib'),
				{
					recursive: true
				}
			);
			await fs.mkdir(
				path.join(tempRuntimeRoot, 'sysroot', 'lib', 'rustlib', 'wasm32-wasip3', 'lib'),
				{
					recursive: true
				}
			);
			await fs.writeFile(path.join(tempRuntimeRoot, 'rustc', 'rustc.wasm'), 'rustc');
			await fs.writeFile(path.join(tempRuntimeRoot, 'rustc', 'rustc.wasm.gz'), 'rustc');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'llc.js'), 'llc');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'llc.wasm'), 'llc wasm');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'llc.wasm.gz'), 'llc wasm');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'lld.js'), 'lld');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'lld.wasm'), 'lld wasm');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'lld.wasm.gz'), 'lld wasm');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'lld.data'), 'lld data');
			await fs.writeFile(path.join(tempRuntimeRoot, 'llvm', 'lld.data.gz'), 'lld data');
			await fs.writeFile(path.join(tempRuntimeRoot, 'link', 'alloc.o'), 'alloc');
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip1.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip1.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip2.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip2.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip3.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'sysroot', 'wasm32-wasip3.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip1.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip1.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip2.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip2.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip3.pack.gz'),
				'pack'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, 'packs', 'link', 'wasm32-wasip3.index.json.gz'),
				'index'
			);
			await fs.writeFile(
				path.join(
					tempRuntimeRoot,
					'sysroot',
					'lib',
					'rustlib',
					'wasm32-wasip1',
					'lib',
					'libstd.rlib'
				),
				'std'
			);
			await fs.writeFile(
				path.join(
					tempRuntimeRoot,
					'sysroot',
					'lib',
					'rustlib',
					'wasm32-wasip2',
					'lib',
					'libstd.rlib'
				),
				'std'
			);
			await fs.writeFile(
				path.join(
					tempRuntimeRoot,
					'sysroot',
					'lib',
					'rustlib',
					'wasm32-wasip3',
					'lib',
					'libstd.rlib'
				),
				'std'
			);
			await fs.writeFile(
				path.join(tempRuntimeRoot, manifestFileName),
				JSON.stringify(manifestContents, null, 2)
			);

			expect(await isReusablePrebuiltRuntimeBundle(tempRuntimeRoot)).toBe(true);
			await fs.rm(path.join(tempRuntimeRoot, missingAssetRelativePath));
			expect(await isReusablePrebuiltRuntimeBundle(tempRuntimeRoot)).toBe(false);
		}
	});

	it('keeps runtime default values documented in browser/compiler references', async () => {
		const browserCompilerDoc = await fs.readFile(
			path.join(projectRoot, 'docs', 'browser-compiler.md'),
			'utf8'
		);
		const environmentDoc = await fs.readFile(
			path.join(projectRoot, 'docs', 'environment-variables.md'),
			'utf8'
		);
		const targetTripleList = defaultRuntimeTargetTriples.join(',');

		expect(browserCompilerDoc).toContain(
			`initial pages: \`${defaultRustcMemoryInitialPages}\``
		);
		expect(browserCompilerDoc).toContain(`default is \`${targetTripleList}\``);
		expect(environmentDoc).toContain(`default: \`${targetTripleList}\``);
	});
});

builtBrowserBundle('built browser bundle', () => {
	it('derives runtime build paths from the current checkout instead of a machine-local absolute path', () => {
		expect(prepareRuntimeProjectRoot).toBe(projectRoot);
		expect(prepareRuntimeDistRoot).toBe(distRoot);
		expect(prepareRuntimeRuntimeRoot).toBe(path.join(distRoot, 'runtime'));
	});

	it('does not leave bare package imports in shipped browser entrypoints', async () => {
		const files = (await listFiles(distRoot)).filter((filePath) => filePath.endsWith('.js'));
		for (const filePath of files) {
			const contents = await fs.readFile(filePath, 'utf8');
			expect(contents).not.toContain('@bjorn3/browser_wasi_shim');
			expect(contents).not.toMatch(/(?:^|\n)\s*import\s+[^'"\n]*['"]@/);
			expect(contents).not.toMatch(/(?:^|\n)\s*export\s+[^'"\n]*from\s+['"]@/);
		}
		await expect(
			fs.access(path.join(distRoot, 'vendor', 'browser_wasi_shim', 'index.js'))
		).resolves.toBeUndefined();
		await expect(
			fs.access(path.join(distRoot, 'vendor', 'preview2-shim', 'lib', 'browser', 'index.js'))
		).resolves.toBeUndefined();
		await expect(
			fs.access(path.join(distRoot, 'vendor', 'jco', 'src', 'browser.js'))
		).resolves.toBeUndefined();
	});

	it('keeps edition 2024 enabled for the rebuilt rustc.wasm toolchain', async () => {
		const contents = await fs.readFile(path.join(distRoot, 'compiler-worker.js'), 'utf8');
		expect(contents).toContain('-Zunstable-options');
	});

	it('keeps preview2 browser imports off the full preview2 browser index in the shipped runtime', async () => {
		const contents = await fs.readFile(
			path.join(distRoot, 'browser-component-tools.js'),
			'utf8'
		);
		expect(contents).not.toContain('lib/common/instantiation.js');
		expect(contents).not.toContain('lib/browser/index.js');
		expect(contents).toContain('lib/browser/cli.js');
		expect(contents).toContain('lib/browser/filesystem.js');
		expect(contents).toContain('lib/browser/io.js');
	});

	it('keeps preview1 browser imports off the full browser_wasi_shim entrypoint in the shipped runtime', async () => {
		const contents = await fs.readFile(path.join(distRoot, 'browser-execution.js'), 'utf8');
		expect(contents).not.toContain('./vendor/browser_wasi_shim/index.js');
		expect(contents).not.toContain('./vendor/browser_wasi_shim/fs_opfs.js');
		expect(contents).not.toContain('./vendor/browser_wasi_shim/strace.js');
		expect(contents).toContain('./vendor/browser_wasi_shim/fd.js');
		expect(contents).toContain('./vendor/browser_wasi_shim/fs_mem.js');
		expect(contents).toContain('./vendor/browser_wasi_shim/wasi.js');
		expect(contents).toContain('./vendor/browser_wasi_shim/wasi_defs.js');
	});

	it('publishes a pack-aware v3 runtime manifest without exploded sysroot or link trees', async () => {
		const runtimeRoot = path.join(distRoot, 'runtime');
		const v3Manifest = JSON.parse(
			await fs.readFile(path.join(runtimeRoot, 'runtime-manifest.v3.json'), 'utf8')
		) as {
			manifestVersion: number;
			defaultTargetTriple: string;
			compiler: {
				compileTimeoutMs: number;
				rustcWasm: string;
			};
			targets: Record<
				string,
				{
					artifactFormat: string;
					sysrootPack: {
						asset: string;
						index: string;
						fileCount: number;
						totalBytes: number;
					};
					execution: {
						kind: string;
					};
					compile: {
						llvm: {
							llc: string;
							llcWasm: string;
							lld: string;
							lldWasm: string;
							lldData: string;
						};
						link: {
							args: string[];
							pack: {
								asset: string;
								index: string;
								fileCount: number;
								totalBytes: number;
							};
						};
					};
				}
			>;
		};

		expect(v3Manifest.manifestVersion).toBe(3);
		expect(v3Manifest.defaultTargetTriple).toBe('wasm32-wasip1');
		expect(v3Manifest.compiler.compileTimeoutMs).toBe(120_000);
		expect(v3Manifest.compiler.rustcWasm).toBe('rustc/rustc.wasm.gz');
		expect(v3Manifest.targets['wasm32-wasip1']?.artifactFormat).toBe('core-wasm');
		if (await hasCompatibleWasiSdk()) {
			expect(v3Manifest.targets['wasm32-wasip2']?.artifactFormat).toBe('component');
			expect(v3Manifest.targets['wasm32-wasip2']?.execution.kind).toBe('preview2-component');
		}
		if ((await hasCompatibleWasiSdk()) && (await hasTargetSysroot('wasm32-wasip3'))) {
			expect(v3Manifest.targets['wasm32-wasip3']?.artifactFormat).toBe('component');
			expect(v3Manifest.targets['wasm32-wasip3']?.execution.kind).toBe('preview2-component');
		}
		if (v3Manifest.targets['wasm32-wasip3']) {
			expect(v3Manifest.targets['wasm32-wasip3'].artifactFormat).toBe('component');
			expect(v3Manifest.targets['wasm32-wasip3'].execution.kind).toBe('preview2-component');
		}
		await expect(
			fs.access(path.join(runtimeRoot, 'runtime-manifest.v2.json'))
		).rejects.toThrow();
		await expect(fs.access(path.join(runtimeRoot, 'runtime-manifest.json'))).rejects.toThrow();
		for (const [targetTriple, targetConfig] of Object.entries(v3Manifest.targets)) {
			expect(targetConfig.compile.link.args.some((entry) => entry.startsWith('/tmp/'))).toBe(
				false
			);
			expect(targetConfig.compile.llvm.llc).toBe('llvm/llc.js');
			expect(targetConfig.compile.llvm.llcWasm).toBe('llvm/llc.wasm.gz');
			expect(targetConfig.compile.llvm.lld).toBe('llvm/lld.js');
			expect(targetConfig.compile.llvm.lldWasm).toBe('llvm/lld.wasm.gz');
			expect(targetConfig.compile.llvm.lldData).toBe('llvm/lld.data.gz');
			expect(targetConfig.sysrootPack.asset).toBe(`packs/sysroot/${targetTriple}.pack.gz`);
			expect(targetConfig.sysrootPack.index).toBe(
				`packs/sysroot/${targetTriple}.index.json.gz`
			);
			expect(targetConfig.compile.link.pack.asset).toBe(`packs/link/${targetTriple}.pack.gz`);
			expect(targetConfig.compile.link.pack.index).toBe(
				`packs/link/${targetTriple}.index.json.gz`
			);
			for (const assetPath of [
				targetConfig.sysrootPack.asset,
				targetConfig.sysrootPack.index,
				targetConfig.compile.link.pack.asset,
				targetConfig.compile.link.pack.index
			]) {
				await expect(fs.access(path.join(runtimeRoot, assetPath))).resolves.toBeUndefined();
			}
			await expect(
				fs.access(path.join(runtimeRoot, `packs/sysroot/${targetTriple}.pack`))
			).rejects.toThrow();
			await expect(
				fs.access(path.join(runtimeRoot, `packs/sysroot/${targetTriple}.index.json`))
			).rejects.toThrow();
			await expect(
				fs.access(path.join(runtimeRoot, `packs/link/${targetTriple}.pack`))
			).rejects.toThrow();
			await expect(
				fs.access(path.join(runtimeRoot, `packs/link/${targetTriple}.index.json`))
			).rejects.toThrow();
			const sysrootIndex = JSON.parse(
				gunzipSync(
					await fs.readFile(path.join(runtimeRoot, targetConfig.sysrootPack.index))
				).toString('utf8')
			) as {
				fileCount: number;
				totalBytes: number;
				entries: Array<{
					runtimePath: string;
				}>;
			};
			expect(sysrootIndex.fileCount).toBe(targetConfig.sysrootPack.fileCount);
			expect(sysrootIndex.totalBytes).toBe(targetConfig.sysrootPack.totalBytes);
			expect(
				sysrootIndex.entries.every(
					(entry) =>
						entry.runtimePath.includes(`/rustlib/${targetTriple}/`) &&
						!entry.runtimePath.endsWith('.old')
				)
			).toBe(true);
		}
		for (const assetPath of ['llvm/llc.wasm.gz', 'llvm/lld.wasm.gz', 'llvm/lld.data.gz']) {
			await expect(fs.access(path.join(runtimeRoot, assetPath))).resolves.toBeUndefined();
		}
		for (const assetPath of ['llvm/llc.wasm', 'llvm/lld.wasm', 'llvm/lld.data']) {
			await expect(fs.access(path.join(runtimeRoot, assetPath))).rejects.toThrow();
		}
		const runtimeFiles = await listFiles(runtimeRoot);
		expect(
			runtimeFiles.some((filePath) => filePath.includes('/x86_64-unknown-linux-gnu/'))
		).toBe(false);
		expect(runtimeFiles.some((filePath) => filePath.endsWith('.old'))).toBe(false);
		expect(runtimeFiles.some((filePath) => filePath.includes('/sysroot/lib/rustlib/'))).toBe(
			false
		);
		expect(runtimeFiles.some((filePath) => filePath.includes('/runtime/link/'))).toBe(false);
		await expect(
			fs.access(path.join(runtimeRoot, 'rustc', 'rustc.wasm.gz'))
		).resolves.toBeUndefined();
		await expect(fs.access(path.join(runtimeRoot, 'rustc', 'rustc.wasm'))).rejects.toThrow();
	});

	it('ships rustc as a gzip precompressed asset under the GitHub file-size limit', async () => {
		const runtimeRoot = path.join(distRoot, 'runtime');
		const compressedRustcPath = path.join(runtimeRoot, 'rustc', 'rustc.wasm.gz');
		const compressedRustcBytes = await fs.readFile(compressedRustcPath);
		const decompressedRustcBytes = gunzipSync(compressedRustcBytes);

		expect(compressedRustcBytes.byteLength).toBeLessThan(100_000_000);
		expect(decompressedRustcBytes.byteLength).toBeGreaterThan(compressedRustcBytes.byteLength);
		expect(Array.from(decompressedRustcBytes.slice(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);
	});

	it('stays within runtime byte and request budgets for each packaged target', async () => {
		const runtimeRoot = path.join(distRoot, 'runtime');
		const manifest = JSON.parse(
			await fs.readFile(path.join(runtimeRoot, 'runtime-manifest.v3.json'), 'utf8')
		) as {
			targets: Record<
				string,
				{
					sysrootPack: {
						asset: string;
						index: string;
						fileCount: number;
						totalBytes: number;
					};
					compile: {
						link: {
							pack: {
								asset: string;
								index: string;
								fileCount: number;
								totalBytes: number;
							};
						};
					};
				}
			>;
		};
		const targetTriples = Object.keys(manifest.targets);
		const runtimeFiles = await listFiles(runtimeRoot);
		const runtimeBytes = await measureTotalBytes(runtimeFiles);

		expect(runtimeFiles.length).toBeLessThanOrEqual(8 + targetTriples.length * 4);
		expect(runtimeBytes).toBeLessThanOrEqual(340_000_000 + targetTriples.length * 120_000_000);

		for (const [targetTriple, targetConfig] of Object.entries(manifest.targets)) {
			const assetBytes =
				targetConfig.sysrootPack.totalBytes + targetConfig.compile.link.pack.totalBytes;
			const requestAssets = new Set([
				targetConfig.sysrootPack.asset,
				targetConfig.sysrootPack.index,
				targetConfig.compile.link.pack.asset,
				targetConfig.compile.link.pack.index
			]);

			expect(
				targetConfig.sysrootPack.fileCount + targetConfig.compile.link.pack.fileCount,
				`${targetTriple} packed file budget`
			).toBeLessThanOrEqual(2_500);
			expect(requestAssets.size, `${targetTriple} request budget`).toBeLessThanOrEqual(4);
			expect(assetBytes, `${targetTriple} byte budget`).toBeLessThanOrEqual(130_000_000);
		}
	});
});
