import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmClangDist } from '../../scripts/sync-wasm-clang.mjs';

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
const syncScript = path.resolve('scripts/sync-wasm-clang.mjs');
const assets = [
	{
		asset: 'clang.zip',
		deliveryAsset: 'clang.wasm.gz',
		source: 'bin/clang.zip',
		target: 'clang/bin/clang.wasm.gz',
		entry: 'clang'
	},
	{
		asset: 'lld.zip',
		deliveryAsset: 'lld.wasm.gz',
		source: 'bin/lld.zip',
		target: 'clang/bin/lld.wasm.gz',
		entry: 'lld'
	},
	{
		asset: 'memfs.zip',
		deliveryAsset: 'memfs.wasm.gz',
		source: 'bin/memfs.zip',
		target: 'clang/bin/memfs.wasm.gz',
		entry: 'memfs'
	},
	{
		asset: 'sysroot.tar.zip',
		deliveryAsset: 'sysroot.tar.gz',
		source: 'bin/sysroot.tar.zip',
		target: 'clang/bin/sysroot.tar.gz',
		entry: 'sysroot.tar'
	},
	{
		asset: 'clangd/clangd.js',
		deliveryAsset: 'clangd/clangd.js',
		source: 'clangd/clangd.js',
		target: 'clangd/clangd.js',
		entry: undefined
	},
	{
		asset: 'clangd/clangd.wasm.gz',
		deliveryAsset: 'clangd/clangd.wasm.gz',
		source: 'clangd/clangd.wasm.gz',
		target: 'clangd/clangd.wasm.gz',
		entry: undefined
	}
];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-clang-'));
	tempDirs.push(directory);
	return directory;
}

function sha256(contents: Buffer) {
	return createHash('sha256').update(contents).digest('hex');
}

async function writeJson(filePath: string, value: unknown) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFixture(sourceDir: string) {
	const payloads = new Map<string, Buffer>();
	const contents = new Map<string, Buffer>();
	for (const asset of assets) {
		if (!asset.entry) {
			contents.set(asset.source, Buffer.from(`fixture:${asset.source}`));
			continue;
		}
		const payload = Buffer.from(`fixture:${asset.entry}`);
		payloads.set(asset.source, payload);
		contents.set(asset.source, Buffer.from(zipSync({ [asset.entry]: payload }, { level: 6 })));
	}
	const stdinImport = Buffer.from('__asyncjs__waitForStdin');
	const importSection = Buffer.concat([
		Buffer.from([0x01, 0x03]),
		Buffer.from('env'),
		Buffer.from([stdinImport.byteLength]),
		stdinImport,
		Buffer.from([0x00, 0x00])
	]);
	contents.set(
		'clangd/clangd.js',
		Buffer.from('const stdinReady = Module.stdinReady; const wasm = WebAssembly;')
	);
	contents.set(
		'clangd/clangd.wasm.gz',
		gzipSync(
			Buffer.concat([
				Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
				Buffer.from([0x01, 0x04, 0x01, 0x60, 0x00, 0x00]),
				Buffer.from([0x02, importSection.byteLength]),
				importSection
			])
		)
	);
	for (const [filename, bytes] of contents) {
		const filePath = path.join(sourceDir, filename);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, bytes);
	}

	const version = 'llvmorg-22.1.8';
	const manifest = {
		manifestVersion: 1,
		version,
		defaultTarget: 'wasm32-wasi',
		compiler: {
			memfs: { asset: 'bin/memfs.zip', argv0: 'memfs' },
			clang: { asset: 'bin/clang.zip', argv0: 'clang' },
			lld: { asset: 'bin/lld.zip', argv0: 'wasm-ld' },
			sysroot: { asset: 'bin/sysroot.tar.zip' },
			resourceDir: '/lib/clang/22',
			compilerRuntimeLibDir: 'lib/clang/22/lib/wasi'
		},
		clangd: {
			js: 'clangd/clangd.js',
			wasm: 'clangd/clangd.wasm.gz'
		},
		targets: {
			'wasm32-wasi': {
				artifactFormat: 'wasi-core-wasm',
				execution: { kind: 'wasi-preview1' }
			}
		}
	};
	const assetHashes = Object.fromEntries(
		assets.map(({ asset, source }) => [asset, sha256(contents.get(source)!)])
	);
	const buildInfo = {
		toolchain: {
			producer: { id: 'wasm-llvm/clang-browser' },
			version,
			llvmVersion: '22.1.8',
			wasiSdkVersion: '33',
			emsdkVersion: '6.0.0',
			resourceDir: manifest.compiler.resourceDir,
			compilerRuntimeLibDir: manifest.compiler.compilerRuntimeLibDir,
			clangd: {
				stdinBridge: 'emscripten-asyncify',
				patch: 'patches/clangd-emscripten-stdin.patch',
				patchSha256: 'a'.repeat(64)
			},
			assets: assetHashes
		},
		assets: assets.map(({ asset, source }) => ({
			asset,
			size: contents.get(source)!.byteLength,
			sha256: assetHashes[asset]
		}))
	};
	await writeJson(path.join(sourceDir, 'runtime-manifest.v1.json'), manifest);
	await writeJson(path.join(sourceDir, 'runtime-build.json'), buildInfo);
	return { contents, payloads, manifest, buildInfo };
}

async function replaceFixtureAsset(
	sourceDir: string,
	buildInfo: Awaited<ReturnType<typeof writeFixture>>['buildInfo'],
	asset: string,
	source: string,
	bytes: Buffer
) {
	await writeFile(path.join(sourceDir, source), bytes);
	const assetHash = sha256(bytes);
	const nextBuildInfo = {
		...buildInfo,
		toolchain: {
			...buildInfo.toolchain,
			assets: { ...buildInfo.toolchain.assets, [asset]: assetHash }
		},
		assets: buildInfo.assets.map((entry) =>
			entry.asset === asset ? { ...entry, size: bytes.byteLength, sha256: assetHash } : entry
		)
	};
	await writeJson(path.join(sourceDir, 'runtime-build.json'), nextBuildInfo);
}

async function writeExistingTargets(staticDir: string) {
	await mkdir(path.join(staticDir, 'clang', 'bin'), { recursive: true });
	await mkdir(path.join(staticDir, 'clangd'), { recursive: true });
	await writeFile(path.join(staticDir, 'clang', 'existing.txt'), 'existing-clang');
	await writeFile(path.join(staticDir, 'clangd', 'existing.txt'), 'existing-clangd');
}

async function expectExistingTargets(staticDir: string) {
	await expect(readFile(path.join(staticDir, 'clang', 'existing.txt'), 'utf8')).resolves.toBe(
		'existing-clang'
	);
	await expect(readFile(path.join(staticDir, 'clangd', 'existing.txt'), 'utf8')).resolves.toBe(
		'existing-clangd'
	);
}

describe('syncWasmClangDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('requires an explicit source directory', async () => {
		await expect(syncWasmClangDist()).rejects.toThrow(
			'wasm-clang sync requires an explicit source directory'
		);
	});

	it('validates, stages, and transactionally installs the complete producer bundle', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const fixture = await writeFixture(sourceDir);
		await writeExistingTargets(staticDir);

		expect(await syncWasmClangDist({ sourceDir, staticDir })).toEqual({
			sourceDir,
			staticDir
		});
		const deliveredManifest = JSON.parse(
			await readFile(path.join(staticDir, 'clang', 'runtime-manifest.v1.json'), 'utf8')
		);
		expect(deliveredManifest.compiler).toMatchObject({
			memfs: { asset: 'bin/memfs.wasm.gz' },
			clang: { asset: 'bin/clang.wasm.gz' },
			lld: { asset: 'bin/lld.wasm.gz' },
			sysroot: { asset: 'bin/sysroot.tar.gz' }
		});
		const deliveredBuildInfo = JSON.parse(
			await readFile(path.join(staticDir, 'clang', 'runtime-build.json'), 'utf8')
		);
		expect(deliveredBuildInfo.delivery).toEqual({
			format: 'wasm-idle-clang-native-gzip-v1',
			sourceAssets: fixture.buildInfo.assets
		});
		expect(deliveredBuildInfo.assets.map(({ asset }: { asset: string }) => asset)).toEqual(
			assets.map(({ deliveryAsset }) => deliveryAsset)
		);
		for (const { entry, source, target } of assets) {
			const delivered = await readFile(path.join(staticDir, target));
			if (entry) {
				const payload = fixture.payloads.get(source)!;
				expect(delivered).toEqual(gzipSync(payload, { level: 9 }));
				expect(gunzipSync(delivered)).toEqual(payload);
			} else {
				expect(delivered).toEqual(fixture.contents.get(source));
			}
		}
		await expect(stat(path.join(staticDir, 'clang', 'existing.txt'))).rejects.toThrow();
		await expect(stat(path.join(staticDir, 'clangd', 'existing.txt'))).rejects.toThrow();
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it('accepts the pnpm argument separator in the CLI path', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { contents } = await writeFixture(sourceDir);

		await execFileAsync(process.execPath, [syncScript, '--', sourceDir, staticDir]);

		await expect(
			readFile(path.join(staticDir, 'clang', 'runtime-build.json'), 'utf8')
		).resolves.toContain('llvmorg-22.1.8');
		await expect(readFile(path.join(staticDir, 'clangd', 'clangd.js'))).resolves.toEqual(
			contents.get('clangd/clangd.js')
		);
	});

	it('rejects excessive CLI arguments', async () => {
		await expect(
			execFileAsync(process.execPath, [syncScript, 'source', 'static', 'extra'])
		).rejects.toThrow('wasm-clang sync accepts at most sourceDir and staticDir arguments');
	});

	it('rejects an invalid runtime manifest shape', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { manifest } = await writeFixture(sourceDir);
		await writeJson(path.join(sourceDir, 'runtime-manifest.v1.json'), {
			...manifest,
			compiler: { ...manifest.compiler, clang: { asset: 'clang.zip', argv0: 'clang' } }
		});

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'does not reference the complete Clang runtime asset set'
		);
	});

	it('rejects manifest and build versions that do not match', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await writeJson(path.join(sourceDir, 'runtime-build.json'), {
			...buildInfo,
			toolchain: { ...buildInfo.toolchain, version: 'llvmorg-23.0.0' }
		});

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'does not match runtime-build.json version'
		);
	});

	it('rejects clangd assets without a stdin bridge receipt', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await writeJson(path.join(sourceDir, 'runtime-build.json'), {
			...buildInfo,
			toolchain: { ...buildInfo.toolchain, clangd: undefined }
		});

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'missing the clangd stdin bridge receipt'
		);
	});

	it('rejects a clangd loader without the stdin readiness callback', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await replaceFixtureAsset(
			sourceDir,
			buildInfo,
			'clangd/clangd.js',
			'clangd/clangd.js',
			Buffer.from('const wasm = WebAssembly;')
		);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'missing the browser stdin readiness callback'
		);
	});

	it('rejects clangd WebAssembly without the Asyncify stdin import', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await replaceFixtureAsset(
			sourceDir,
			buildInfo,
			'clangd/clangd.wasm.gz',
			'clangd/clangd.wasm.gz',
			gzipSync(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
		);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'missing the Asyncify stdin import'
		);
	});

	it('rejects runtime-build metadata with an incomplete asset list', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await writeJson(path.join(sourceDir, 'runtime-build.json'), {
			...buildInfo,
			assets: buildInfo.assets.slice(0, -1)
		});

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'does not describe the complete runtime asset set'
		);
	});

	it('rejects a missing producer asset and preserves both existing targets', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		await writeFixture(sourceDir);
		await rm(path.join(sourceDir, 'bin', 'lld.zip'));
		await writeExistingTargets(staticDir);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'bin/lld.zip was not found'
		);
		await expectExistingTargets(staticDir);
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it('rejects a hash mismatch and preserves both existing targets', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { contents } = await writeFixture(sourceDir);
		await writeFile(
			path.join(sourceDir, 'bin', 'clang.zip'),
			Buffer.alloc(contents.get('bin/clang.zip')!.byteLength, 0x78)
		);
		await writeExistingTargets(staticDir);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'bin/clang.zip does not match runtime-build.json'
		);
		await expectExistingTargets(staticDir);
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it('rejects a size mismatch', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { buildInfo } = await writeFixture(sourceDir);
		await writeJson(path.join(sourceDir, 'runtime-build.json'), {
			...buildInfo,
			assets: buildInfo.assets.map((entry) =>
				entry.asset === 'memfs.zip' ? { ...entry, size: entry.size + 1 } : entry
			)
		});

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'bin/memfs.zip does not match runtime-build.json'
		);
	});
});
