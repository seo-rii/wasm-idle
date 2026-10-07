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
const stdinCallback =
	'function __asyncjs__waitForStdin(){return Asyncify.handleAsync(async()=>{await Module.stdinReady()})}';
const minifiedLoader = `${stdinCallback};var wasmImports;
function assignWasmImports(){wasmImports={ca:__asyncjs__waitForStdin}}
function getWasmImports(){assignWasmImports();var imports={a:wasmImports};return imports}
async function createWasm(){var info=getWasmImports();if(Module["instantiateWasm"]){Module["instantiateWasm"](info,()=>{})}return instantiateAsync(wasmBinary,wasmBinaryFile,info)}
if(!ENVIRONMENT_IS_PTHREAD){createWasm()}`;

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

async function writeFixture(sourceDir: string, minified = false) {
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
	const stdinImport = Buffer.from(minified ? 'ca' : '__asyncjs__waitForStdin');
	const importNamespace = Buffer.from(minified ? 'a' : 'env');
	const importSection = Buffer.concat([
		Buffer.from([0x01, importNamespace.byteLength]),
		importNamespace,
		Buffer.from([stdinImport.byteLength]),
		stdinImport,
		Buffer.from([0x00, 0x00])
	]);
	contents.set('clangd/clangd.js', Buffer.from(minified ? minifiedLoader : stdinCallback));
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

async function writeHeaderFixture(sourceDir: string) {
	const fixture = await writeFixture(sourceDir);
	const tree = {
		schemaVersion: 1,
		version: `${fixture.manifest.version}:fixture-commit`,
		targetTriple: 'wasm32-wasi',
		resourceDir: '/lib/clang/22',
		files: {
			'/usr/include/wasm32-wasi/stdio.h': 'selected C header',
			'/usr/include/wasm32-wasi/noeh/c++/v1/__config_site': 'selected C++ configuration',
			'/usr/include/c++/v1/vector': 'shared C++ header',
			'/lib/clang/22/include/stddef.h': 'matching resource header'
		}
	};
	const raw = Buffer.from(JSON.stringify(tree));
	const compressed = gzipSync(raw);
	const headers = {
		asset: 'clangd/clangd.headers.json.gz',
		format: 'clangd-headers-v1',
		version: sha256(raw),
		targetTriple: tree.targetTriple,
		resourceDir: tree.resourceDir,
		bytes: compressed.length,
		sha256: sha256(compressed),
		uncompressedBytes: raw.length,
		uncompressedSha256: sha256(raw)
	};
	const manifest = { ...fixture.manifest, clangd: { ...fixture.manifest.clangd, headers } };
	const buildInfo = {
		...fixture.buildInfo,
		toolchain: {
			...fixture.buildInfo.toolchain,
			clangd: { ...fixture.buildInfo.toolchain.clangd, headers },
			assets: { ...fixture.buildInfo.toolchain.assets, [headers.asset]: headers.sha256 }
		},
		assets: [
			...fixture.buildInfo.assets,
			{ asset: headers.asset, size: headers.bytes, sha256: headers.sha256 }
		]
	};
	await writeFile(path.join(sourceDir, headers.asset), compressed);
	await writeJson(path.join(sourceDir, 'runtime-manifest.v1.json'), manifest);
	await writeJson(path.join(sourceDir, 'runtime-build.json'), buildInfo);
	return { ...fixture, manifest, buildInfo, headers, tree, compressed };
}

async function writeMemfsSidecars(
	sourceDir: string,
	fixture: Awaited<ReturnType<typeof writeFixture>>,
	wasm = fixture.payloads.get('bin/memfs.zip')!
) {
	const compressed = gzipSync(wasm, { level: 9 });
	const buildReceipt = {
		format: 'wasm-llvm-memfs-build-v1',
		maxNodes: 8192,
		outputs: {
			'memfs.wasm': { bytes: wasm.byteLength, sha256: sha256(wasm) },
			'memfs.wasm.gz': { bytes: compressed.byteLength, sha256: sha256(compressed) }
		}
	};
	const contents = new Map([
		['memfs-build-receipt.json', Buffer.from(`${JSON.stringify(buildReceipt, null, 2)}\n`)],
		['LICENSE.memfs-llvm.txt', Buffer.from('fixture: pinned LLVM license\n')],
		['LICENSE.memfs-stb_sprintf.txt', Buffer.from('fixture: pinned stb_sprintf license\n')]
	]);
	const files = Object.fromEntries(
		[...contents].map(([name, bytes]) => [
			name,
			{ bytes: bytes.byteLength, sha256: sha256(bytes) }
		])
	);
	const buildInfo = {
		...fixture.buildInfo,
		toolchain: { ...fixture.buildInfo.toolchain, memfs: { buildReceipt, files } }
	};
	for (const [name, bytes] of contents) await writeFile(path.join(sourceDir, name), bytes);
	await writeJson(path.join(sourceDir, 'runtime-build.json'), buildInfo);
	return { contents, buildInfo };
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

	it('preserves verified MemFS sidecars and metadata without changing the six binary assets', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const fixture = await writeFixture(sourceDir);
		const { contents, buildInfo } = await writeMemfsSidecars(sourceDir, fixture);
		await writeExistingTargets(staticDir);

		await syncWasmClangDist({ sourceDir, staticDir });

		for (const [name, bytes] of contents) {
			expect(await readFile(path.join(staticDir, 'clang', name))).toEqual(bytes);
		}
		const deliveredBuildInfo = JSON.parse(
			await readFile(path.join(staticDir, 'clang/runtime-build.json'), 'utf8')
		);
		expect(deliveredBuildInfo.toolchain.memfs).toEqual(buildInfo.toolchain.memfs);
		expect(deliveredBuildInfo.assets.map(({ asset }: { asset: string }) => asset)).toEqual(
			assets.map(({ deliveryAsset }) => deliveryAsset)
		);
		expect(deliveredBuildInfo.delivery.sourceAssets).toEqual(fixture.buildInfo.assets);
		const deliveredMemfs = gunzipSync(
			await readFile(path.join(staticDir, 'clang/bin/memfs.wasm.gz'))
		);
		expect(deliveredMemfs).toEqual(fixture.payloads.get('bin/memfs.zip'));
		expect(buildInfo.toolchain.memfs.buildReceipt.outputs['memfs.wasm']).toEqual({
			bytes: deliveredMemfs.byteLength,
			sha256: sha256(deliveredMemfs)
		});
		await expect(stat(path.join(staticDir, 'clang/existing.txt'))).rejects.toThrow();
		await expect(stat(path.join(staticDir, 'clangd/existing.txt'))).rejects.toThrow();
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it('preserves separately versioned clangd headers and pins through native-gzip delivery', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const fixture = await writeHeaderFixture(sourceDir);
		await syncWasmClangDist({ sourceDir, staticDir });
		expect(await readFile(path.join(staticDir, fixture.headers.asset))).toEqual(
			fixture.compressed
		);
		const manifest = JSON.parse(
			await readFile(path.join(staticDir, 'clang/runtime-manifest.v1.json'), 'utf8')
		);
		const receipt = JSON.parse(
			await readFile(path.join(staticDir, 'clang/runtime-build.json'), 'utf8')
		);
		expect(manifest.clangd.headers).toEqual(fixture.headers);
		expect(receipt.toolchain.clangd.headers).toEqual(fixture.headers);
		expect(receipt.assets).toHaveLength(7);
		expect(receipt.toolchain.assets[fixture.headers.asset]).toBe(fixture.headers.sha256);
		expect(JSON.parse(gunzipSync(fixture.compressed).toString('utf8'))).toEqual(fixture.tree);
	});

	it.each(['missing', 'corrupt', 'stale-raw-receipt', 'manifest-mismatch'])(
		'rejects a %s header asset before replacing existing targets',
		async (failure) => {
			const sourceDir = await makeTempDir();
			const staticDir = path.join(await makeTempDir(), 'static');
			const fixture = await writeHeaderFixture(sourceDir);
			await writeExistingTargets(staticDir);
			if (failure === 'missing') await rm(path.join(sourceDir, fixture.headers.asset));
			if (failure === 'corrupt')
				await writeFile(path.join(sourceDir, fixture.headers.asset), 'corrupt');
			if (failure === 'stale-raw-receipt') {
				fixture.headers.version = 'a'.repeat(64);
				fixture.headers.uncompressedSha256 = 'a'.repeat(64);
				await writeJson(path.join(sourceDir, 'runtime-manifest.v1.json'), fixture.manifest);
				await writeJson(path.join(sourceDir, 'runtime-build.json'), fixture.buildInfo);
			}
			if (failure === 'manifest-mismatch') {
				fixture.manifest.clangd.headers = {
					...fixture.headers,
					targetTriple: 'wasm32-wasip2'
				};
				await writeJson(path.join(sourceDir, 'runtime-manifest.v1.json'), fixture.manifest);
			}
			await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow();
			await expectExistingTargets(staticDir);
		}
	);

	it.each(
		[
			'memfs-build-receipt.json',
			'LICENSE.memfs-llvm.txt',
			'LICENSE.memfs-stb_sprintf.txt'
		].flatMap((name) => ['corrupt', 'missing'].map((failure) => ({ name, failure })))
	)(
		'rejects a $failure MemFS sidecar $name and preserves existing targets',
		async ({ name, failure }) => {
			const sourceDir = await makeTempDir();
			const staticDir = path.join(await makeTempDir(), 'static');
			const fixture = await writeFixture(sourceDir);
			const { contents } = await writeMemfsSidecars(sourceDir, fixture);
			await writeExistingTargets(staticDir);
			if (failure === 'missing') {
				await rm(path.join(sourceDir, name));
			} else {
				await writeFile(
					path.join(sourceDir, name),
					Buffer.alloc(contents.get(name)!.byteLength, 0x78)
				);
			}

			await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
				failure === 'missing'
					? /ENOENT/
					: `MemFS sidecar does not match its receipt: ${name}`
			);
			await expectExistingTargets(staticDir);
			expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
			expect((await readdir(path.join(staticDir, 'clang'))).sort()).toEqual([
				'bin',
				'existing.txt'
			]);
		}
	);

	it('rejects a self-consistent MemFS receipt for a different raw payload and preserves existing targets', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const fixture = await writeFixture(sourceDir);
		const rawMemfs = fixture.payloads.get('bin/memfs.zip')!;
		await writeMemfsSidecars(sourceDir, fixture, Buffer.alloc(rawMemfs.byteLength, 0x78));
		await writeExistingTargets(staticDir);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'MemFS payload does not match its source build receipt'
		);
		await expectExistingTargets(staticDir);
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it('rejects sidecar bytes that disagree with the embedded MemFS receipt despite matching their file pin', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const fixture = await writeFixture(sourceDir);
		const { buildInfo } = await writeMemfsSidecars(sourceDir, fixture);
		buildInfo.toolchain.memfs.buildReceipt.maxNodes = 16384;
		await writeJson(path.join(sourceDir, 'runtime-build.json'), buildInfo);
		await writeExistingTargets(staticDir);

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'MemFS build receipt does not match toolchain metadata'
		);
		await expectExistingTargets(staticDir);
		expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
	});

	it.each(['extra.txt', '../LICENSE.memfs-llvm.txt', '/LICENSE.memfs-llvm.txt'])(
		'rejects an unapproved MemFS file map entry %s and preserves existing targets',
		async (name) => {
			const sourceDir = await makeTempDir();
			const staticDir = path.join(await makeTempDir(), 'static');
			const fixture = await writeFixture(sourceDir);
			const { buildInfo } = await writeMemfsSidecars(sourceDir, fixture);
			const files = buildInfo.toolchain.memfs.files;
			files[name] = files['LICENSE.memfs-llvm.txt'];
			if (name !== 'extra.txt') delete files['LICENSE.memfs-llvm.txt'];
			await writeJson(path.join(sourceDir, 'runtime-build.json'), buildInfo);
			await writeExistingTargets(staticDir);

			await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
				name === 'extra.txt'
					? 'Invalid MemFS sidecar metadata'
					: 'Invalid MemFS sidecar receipt'
			);
			await expectExistingTargets(staticDir);
			expect((await readdir(staticDir)).sort()).toEqual(['clang', 'clangd']);
		}
	);

	it('installs a producer bundle with minified Asyncify import wiring', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { contents } = await writeFixture(sourceDir, true);
		await syncWasmClangDist({ sourceDir, staticDir });
		expect(await readFile(path.join(staticDir, 'clangd/clangd.wasm.gz'))).toEqual(
			contents.get('clangd/clangd.wasm.gz')
		);
	});

	it('preserves existing targets when minified stdin wiring does not match Wasm', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = path.join(await makeTempDir(), 'static');
		const { contents, buildInfo } = await writeFixture(sourceDir, true);
		await writeExistingTargets(staticDir);
		await replaceFixtureAsset(
			sourceDir,
			buildInfo,
			'clangd/clangd.js',
			'clangd/clangd.js',
			Buffer.from(contents.get('clangd/clangd.js')!.toString().replace('ca:', 'wrong:'))
		);
		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'missing the Asyncify stdin import'
		);
		await expectExistingTargets(staticDir);
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
