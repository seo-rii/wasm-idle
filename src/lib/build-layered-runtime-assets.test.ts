import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	buildLayeredRuntimeAssets,
	COPY_LITERAL_DELTA_FORMAT,
	decodeCopyLiteralDelta,
	encodeCopyLiteralDelta,
	MAX_LAYER_RAW_BYTES,
	normalizeRustMatchingKey
} from '../../scripts/build-layered-runtime-assets.mjs';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-layered-assets-'));
	tempDirs.push(directory);
	return directory;
}

async function writeFixture(rootDir: string, relativePath: string, bytes: Uint8Array | string) {
	const filePath = path.join(rootDir, ...relativePath.split('/'));
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, bytes);
	return filePath;
}

async function writeJsonFixture(rootDir: string, relativePath: string, value: unknown) {
	return await writeFixture(rootDir, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makePack(format: string, files: Array<[string, Uint8Array]>) {
	const chunks: Buffer[] = [];
	const entries = [];
	let offset = 0;
	for (const [runtimePath, sourceBytes] of files) {
		const bytes = Buffer.from(sourceBytes);
		entries.push({ runtimePath, offset, length: bytes.byteLength });
		chunks.push(bytes);
		offset += bytes.byteLength;
	}
	return {
		pack: Buffer.concat(chunks, offset),
		index: { format, fileCount: entries.length, totalBytes: offset, entries }
	};
}

async function writePack(
	rootDir: string,
	runtimeDirectory: string,
	asset: string,
	index: string,
	pack: ReturnType<typeof makePack>
) {
	await writeFixture(rootDir, `${runtimeDirectory}/${asset}`, gzipSync(pack.pack, { level: 9 }));
	await writeFixture(
		rootDir,
		`${runtimeDirectory}/${index}`,
		gzipSync(Buffer.from(`${JSON.stringify(pack.index, null, 2)}\n`), { level: 9 })
	);
	return {
		asset,
		index,
		fileCount: pack.index.fileCount,
		totalBytes: pack.index.totalBytes
	};
}

async function reconstructDeltaPack(
	rootDir: string,
	runtimeDirectory: string,
	reference: { asset: string; index: string },
	basePack: ReturnType<typeof makePack>
) {
	const deltaPack = gunzipSync(
		await readFile(path.join(rootDir, runtimeDirectory, reference.asset))
	);
	const deltaIndex = JSON.parse(
		gunzipSync(await readFile(path.join(rootDir, runtimeDirectory, reference.index))).toString(
			'utf8'
		)
	);
	const baseEntries = new Map(
		basePack.index.entries.map((entry) => [entry.runtimePath, entry] as const)
	);
	const decodedEntries = deltaIndex.entries.map(
		(entry: {
			offset: number;
			length: number;
			decodedLength: number;
			baseRuntimePath?: string;
		}) => {
			const baseEntry = entry.baseRuntimePath
				? baseEntries.get(entry.baseRuntimePath)
				: undefined;
			const baseBytes = baseEntry
				? basePack.pack.subarray(baseEntry.offset, baseEntry.offset + baseEntry.length)
				: Buffer.alloc(0);
			const decoded = decodeCopyLiteralDelta(
				baseBytes,
				deltaPack.subarray(entry.offset, entry.offset + entry.length)
			);
			expect(decoded.byteLength).toBe(entry.decodedLength);
			return decoded;
		}
	);
	return { bytes: Buffer.concat(decodedEntries), deltaIndex, deltaPack };
}

async function expectMissing(filePath: string) {
	await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('build-layered-runtime-assets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('encodes deterministic literal and copy operations that reconstruct exactly', () => {
		const base = Buffer.from(
			'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789--anchor-tail--'
		);
		const target = Buffer.concat([Buffer.from('!'), base.subarray(5, 69), Buffer.from('?')]);
		const delta = encodeCopyLiteralDelta(base, target);

		expect(encodeCopyLiteralDelta(base, target)).toEqual(delta);
		expect(decodeCopyLiteralDelta(base, delta)).toEqual(target);
		expect(delta[0]).toBe(0);
		expect(delta.readUInt32LE(1)).toBe(1);
		expect(delta[6]).toBe(1);
		expect(delta.readUInt32LE(7)).toBe(5);
		expect(delta.readUInt32LE(11)).toBe(64);
		expect(delta[15]).toBe(0);
		expect(delta.readUInt32LE(16)).toBe(1);
	});

	it('replaces Rust and Go target packs with reconstructable deltas and updates references', async () => {
		const rootDir = await makeTempDir();
		const rustRuntimeDir = 'wasm-rust/runtime';
		const rustPackDir = 'packs/sysroot';
		const coreBytes = Buffer.from(
			'core-prefix-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-core-tail'
		);
		const metadataBytes = Buffer.from(
			'metadata-prefix-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-tail'
		);
		const rustBase = makePack('wasm-rust-runtime-pack-index-v1', [
			['/lib/rustlib/wasm32-wasip1/lib/libcore-1111111111111111.rlib', coreBytes],
			['/lib/rustlib/wasm32-wasip1/lib/libstd-2222222222222222.rmeta', metadataBytes]
		]);
		const rustWasip2 = makePack('wasm-rust-runtime-pack-index-v1', [
			[
				'/lib/rustlib/wasm32-wasip2/lib/libcore-aaaaaaaaaaaaaaaa.rlib',
				Buffer.concat([Buffer.from('p2-'), coreBytes.subarray(3)])
			],
			['/lib/rustlib/wasm32-wasip2/lib/libstd-bbbbbbbbbbbbbbbb.rmeta', metadataBytes]
		]);
		const rustWasip3 = makePack('wasm-rust-runtime-pack-index-v1', [
			['/lib/rustlib/wasm32-wasip3/lib/libcore-cccccccccccccccc.rlib', coreBytes],
			[
				'/lib/rustlib/wasm32-wasip3/lib/libstd-dddddddddddddddd.rmeta',
				Buffer.concat([
					metadataBytes.subarray(0, metadataBytes.byteLength - 3),
					Buffer.from('p3!')
				])
			]
		]);
		const rustReferences = {
			'wasm32-wasip1': await writePack(
				rootDir,
				rustRuntimeDir,
				`${rustPackDir}/wasm32-wasip1.pack.gz`,
				`${rustPackDir}/wasm32-wasip1.index.json.gz`,
				rustBase
			),
			'wasm32-wasip2': await writePack(
				rootDir,
				rustRuntimeDir,
				`${rustPackDir}/wasm32-wasip2.pack.gz`,
				`${rustPackDir}/wasm32-wasip2.index.json.gz`,
				rustWasip2
			),
			'wasm32-wasip3': await writePack(
				rootDir,
				rustRuntimeDir,
				`${rustPackDir}/wasm32-wasip3.pack.gz`,
				`${rustPackDir}/wasm32-wasip3.index.json.gz`,
				rustWasip3
			)
		};
		await writeJsonFixture(rootDir, `${rustRuntimeDir}/runtime-manifest.v3.json`, {
			manifestVersion: 3,
			targets: Object.fromEntries(
				Object.entries(rustReferences).map(([target, sysrootPack]) => [
					target,
					{ sysrootPack }
				])
			)
		});

		const goRuntimeDir = 'wasm-go/runtime';
		const goBase = makePack('wasm-go-runtime-pack-index-v1', [
			['/sysroot/fmt.a', coreBytes],
			['/sysroot/runtime.a', metadataBytes]
		]);
		const goWasip1 = makePack('wasm-go-runtime-pack-index-v1', [
			['/sysroot/fmt.a', Buffer.concat([Buffer.from('wasi-'), coreBytes])],
			['/sysroot/runtime.a', metadataBytes],
			['/sysroot/syscall.a', Buffer.from('literal-only-entry')]
		]);
		const goJsReference = await writePack(
			rootDir,
			goRuntimeDir,
			'sysroot/js.pack.gz',
			'sysroot/js.index.json.gz',
			goBase
		);
		const goWasip1Reference = await writePack(
			rootDir,
			goRuntimeDir,
			'sysroot/wasip1.pack.gz',
			'sysroot/wasip1.index.json.gz',
			goWasip1
		);
		await writeJsonFixture(rootDir, `${goRuntimeDir}/runtime-manifest.v1.json`, {
			manifestVersion: 1,
			targets: {
				'wasip1/wasm': { sysrootPack: goWasip1Reference },
				'wasip2/wasm': { sysrootPack: goWasip1Reference },
				'wasip3/wasm': { sysrootPack: goWasip1Reference },
				'js/wasm': { sysrootPack: goJsReference }
			}
		});

		const goWasip1PackPath = path.join(rootDir, goRuntimeDir, goWasip1Reference.asset);
		const goWasip1IndexPath = path.join(rootDir, goRuntimeDir, goWasip1Reference.index);
		const fullWasip1Before = await Promise.all([
			readFile(goWasip1PackPath),
			readFile(goWasip1IndexPath)
		]);
		const result = await buildLayeredRuntimeAssets({ rootDir });

		expect(result.rust).toMatchObject({ changed: true, assetCount: 2 });
		expect(result.go).toMatchObject({ changed: true, assetCount: 1 });
		expect(
			normalizeRustMatchingKey('/lib/rustlib/wasm32-wasip1/lib/libcore-1111111111111111.rlib')
		).toBe(
			normalizeRustMatchingKey('/lib/rustlib/wasm32-wasip3/lib/libcore-cccccccccccccccc.rlib')
		);

		const rustManifest = JSON.parse(
			await readFile(path.join(rootDir, rustRuntimeDir, 'runtime-manifest.v3.json'), 'utf8')
		);
		for (const [target, original] of [
			['wasm32-wasip2', rustWasip2],
			['wasm32-wasip3', rustWasip3]
		] as const) {
			const reference = rustManifest.targets[target].sysrootPack;
			expect(reference.delta).toEqual({
				format: COPY_LITERAL_DELTA_FORMAT,
				base: rustReferences['wasm32-wasip1']
			});
			expect(reference.decodedTotalBytes).toBe(original.pack.byteLength);
			const reconstructed = await reconstructDeltaPack(
				rootDir,
				rustRuntimeDir,
				reference,
				rustBase
			);
			expect(reconstructed.bytes).toEqual(original.pack);
			expect(reconstructed.deltaIndex.format).toBe('wasm-rust-runtime-delta-pack-index-v1');
			expect(reconstructed.deltaIndex.totalBytes).toBe(reconstructed.deltaPack.byteLength);
			expect(reconstructed.deltaIndex.decodedTotalBytes).toBe(original.pack.byteLength);
			expect(reconstructed.deltaPack).toContain(1);
		}

		const goManifestPath = path.join(rootDir, goRuntimeDir, 'runtime-manifest.v1.json');
		const goManifest = JSON.parse(await readFile(goManifestPath, 'utf8'));
		for (const target of ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm']) {
			expect(goManifest.targets[target].sysrootPack.delta).toBeUndefined();
			expect(goManifest.targets[target].sysrootPack).toEqual(goWasip1Reference);
		}
		expect(
			await Promise.all([readFile(goWasip1PackPath), readFile(goWasip1IndexPath)])
		).toEqual(fullWasip1Before);
		expect(goManifest.targets['js/wasm'].sysrootPack.delta).toEqual({
			format: COPY_LITERAL_DELTA_FORMAT,
			base: goWasip1Reference
		});
		expect(goManifest.targets['js/wasm'].sysrootPack.decodedTotalBytes).toBe(
			goBase.pack.byteLength
		);
		const reconstructedGo = await reconstructDeltaPack(
			rootDir,
			goRuntimeDir,
			goManifest.targets['js/wasm'].sysrootPack,
			goWasip1
		);
		expect(reconstructedGo.bytes).toEqual(goBase.pack);
		expect(reconstructedGo.deltaIndex.format).toBe('wasm-go-runtime-delta-pack-index-v1');

		const stablePaths = [
			path.join(rootDir, rustRuntimeDir, rustReferences['wasm32-wasip2'].asset),
			path.join(rootDir, rustRuntimeDir, rustReferences['wasm32-wasip2'].index),
			path.join(rootDir, rustRuntimeDir, 'runtime-manifest.v3.json'),
			path.join(rootDir, goRuntimeDir, goJsReference.asset),
			path.join(rootDir, goRuntimeDir, goJsReference.index),
			goManifestPath
		];
		const beforeSecondRun = await Promise.all(
			stablePaths.map((filePath) => readFile(filePath))
		);
		const secondResult = await buildLayeredRuntimeAssets({ rootDir });
		const afterSecondRun = await Promise.all(stablePaths.map((filePath) => readFile(filePath)));
		expect(secondResult.rust.changed).toBe(false);
		expect(secondResult.go.changed).toBe(false);
		expect(afterSecondRun).toEqual(beforeSecondRun);
	});

	it('layers logical TinyGo and .NET assets, prunes compressed entries, and removes sources', async () => {
		const rootDir = await makeTempDir();
		const tinygoCompressedPath = 'wasm-tinygo/vendor/emception/compiler.a.gz';
		const tinygoCompressedLogicalPath = tinygoCompressedPath.slice(0, -3);
		const tinygoRawPath = 'wasm-tinygo/vendor/emception/emception.worker.js';
		const csharpRawPath = 'wasm-dotnet/runtime/csharp/compiler.wasm';
		const fsharpCompressedPath = 'wasm-dotnet/runtime/fsharp/FSharp.Core.wasm.gz';
		const fsharpCompressedLogicalPath = fsharpCompressedPath.slice(0, -3);
		const unrelatedPath = 'wasm-lua/runtime.wasm';
		const expected = new Map<string, Buffer>([
			[tinygoCompressedLogicalPath, Buffer.from('tinygo-compressed-payload'.repeat(8))],
			[tinygoRawPath, Buffer.from('tinygo-worker-payload')],
			[csharpRawPath, Buffer.from('csharp-runtime-payload'.repeat(7))],
			[fsharpCompressedLogicalPath, Buffer.from('fsharp-runtime-payload'.repeat(6))]
		]);
		await writeFixture(
			rootDir,
			tinygoCompressedPath,
			gzipSync(expected.get(tinygoCompressedLogicalPath)!, { level: 9 })
		);
		await writeFixture(rootDir, tinygoRawPath, expected.get(tinygoRawPath)!);
		await writeFixture(rootDir, csharpRawPath, expected.get(csharpRawPath)!);
		await writeFixture(
			rootDir,
			fsharpCompressedPath,
			gzipSync(expected.get(fsharpCompressedLogicalPath)!, { level: 9 })
		);
		await writeJsonFixture(rootDir, 'compressed-runtime-assets.v1.json', {
			assets: [
				tinygoCompressedLogicalPath,
				fsharpCompressedLogicalPath,
				unrelatedPath
			].sort(),
			sizes: {
				[tinygoCompressedLogicalPath]: expected.get(tinygoCompressedLogicalPath)!
					.byteLength,
				[fsharpCompressedLogicalPath]: expected.get(fsharpCompressedLogicalPath)!
					.byteLength,
				[unrelatedPath]: 1234
			}
		});

		const result = await buildLayeredRuntimeAssets({ rootDir });

		expect(result.tinygo).toMatchObject({ changed: true, assetCount: 2 });
		expect(result.dotnet).toMatchObject({ changed: true, assetCount: 2 });
		const manifestPath = path.join(rootDir, 'layered-runtime-assets.v1.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.maxLayerBytes).toBe(MAX_LAYER_RAW_BYTES);
		expect(
			Object.values(manifest.layers).every(
				(layer) => (layer as { length: number }).length <= MAX_LAYER_RAW_BYTES
			)
		).toBe(true);
		expect(Object.keys(manifest.layers)).toEqual([
			'wasm-dotnet/runtime/layers/csharp-00.pack.gz',
			'wasm-dotnet/runtime/layers/fsharp-00.pack.gz',
			'wasm-tinygo/layers/emception-00.pack.gz'
		]);
		const layerBytes = new Map<string, Buffer>();
		for (const [layerPath, layer] of Object.entries(manifest.layers) as Array<
			[string, { compressedLength: number; length: number; sha256: string }]
		>) {
			const compressedBytes = await readFile(path.join(rootDir, ...layerPath.split('/')));
			const bytes = gunzipSync(compressedBytes);
			expect(bytes.byteLength).toBe(layer.length);
			expect(compressedBytes.byteLength).toBe(layer.compressedLength);
			expect(createHash('sha256').update(compressedBytes).digest('hex')).toBe(layer.sha256);
			layerBytes.set(layerPath, bytes);
		}
		for (const [logicalPath, expectedBytes] of expected) {
			const entry = manifest.assets[logicalPath] as {
				layer: string;
				offset: number;
				length: number;
			};
			const reconstructed = layerBytes
				.get(entry.layer)!
				.subarray(entry.offset, entry.offset + entry.length);
			expect(entry.length).toBe(expectedBytes.byteLength);
			expect(reconstructed).toEqual(expectedBytes);
		}

		for (const entry of Object.values(manifest.assets) as Array<{
			layer: string;
			offset: number;
			length: number;
		}>) {
			expect(entry.offset + entry.length).toBeLessThanOrEqual(
				(layerBytes.get(entry.layer) as Buffer).byteLength
			);
		}

		for (const relativePath of [
			tinygoCompressedPath,
			tinygoRawPath,
			csharpRawPath,
			fsharpCompressedPath
		]) {
			await expectMissing(path.join(rootDir, ...relativePath.split('/')));
		}
		const compressedManifest = JSON.parse(
			await readFile(path.join(rootDir, 'compressed-runtime-assets.v1.json'), 'utf8')
		);
		expect(compressedManifest).toEqual({
			assets: [unrelatedPath],
			sizes: { [unrelatedPath]: 1234 }
		});

		const manifestBeforeSecondRun = await readFile(manifestPath);
		const layerPaths = Object.keys(manifest.layers).map((layerPath) =>
			path.join(rootDir, ...layerPath.split('/'))
		);
		const layersBeforeSecondRun = await Promise.all(
			layerPaths.map((filePath: string) => readFile(filePath))
		);
		const secondResult = await buildLayeredRuntimeAssets({ rootDir });
		expect(secondResult.tinygo.changed).toBe(false);
		expect(secondResult.dotnet.changed).toBe(false);
		expect(await readFile(manifestPath)).toEqual(manifestBeforeSecondRun);
		expect(await Promise.all(layerPaths.map((filePath: string) => readFile(filePath)))).toEqual(
			layersBeforeSecondRun
		);
	});

	it('keeps identical regenerated sources but rebuilds a group when source bytes change', async () => {
		const rootDir = await makeTempDir();
		const firstPath = 'wasm-tinygo/vendor/emception/first.a';
		const secondPath = 'wasm-tinygo/vendor/emception/second.a';
		const firstBytes = Buffer.from('first-runtime-object'.repeat(5));
		const secondBytes = Buffer.from('second-runtime-object'.repeat(5));
		await writeFixture(rootDir, firstPath, firstBytes);
		await writeFixture(rootDir, secondPath, secondBytes);

		await buildLayeredRuntimeAssets({ rootDir });
		const manifestPath = path.join(rootDir, 'layered-runtime-assets.v1.json');
		const firstManifestBytes = await readFile(manifestPath);
		const firstManifest = JSON.parse(firstManifestBytes.toString('utf8'));
		const layerPath = Object.keys(firstManifest.layers)[0];
		const layerFilePath = path.join(rootDir, ...layerPath.split('/'));
		const firstLayerBytes = await readFile(layerFilePath);

		await writeFixture(rootDir, firstPath, firstBytes);
		const identicalResult = await buildLayeredRuntimeAssets({ rootDir });
		await expectMissing(path.join(rootDir, ...firstPath.split('/')));
		expect(await readFile(manifestPath)).toEqual(firstManifestBytes);
		expect(await readFile(layerFilePath)).toEqual(firstLayerBytes);
		expect(identicalResult.tinygo.afterBytes).toBe(0);

		const changedBytes = Buffer.from('changed-first-runtime-object'.repeat(6));
		await writeFixture(rootDir, firstPath, changedBytes);
		const changedResult = await buildLayeredRuntimeAssets({ rootDir });
		await expectMissing(path.join(rootDir, ...firstPath.split('/')));
		expect(changedResult.tinygo.changed).toBe(true);
		expect(changedResult.dotnet.changed).toBe(false);

		const rebuiltManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		const rebuiltLayerPath = Object.keys(rebuiltManifest.layers)[0];
		const rebuiltLayer = gunzipSync(
			await readFile(path.join(rootDir, ...rebuiltLayerPath.split('/')))
		);
		for (const [logicalPath, expectedBytes] of [
			[firstPath, changedBytes],
			[secondPath, secondBytes]
		] as const) {
			const entry = rebuiltManifest.assets[logicalPath] as {
				layer: string;
				offset: number;
				length: number;
			};
			expect(entry.layer).toBe(rebuiltLayerPath);
			expect(rebuiltLayer.subarray(entry.offset, entry.offset + entry.length)).toEqual(
				expectedBytes
			);
		}

		const stableManifest = await readFile(manifestPath);
		const stableLayer = await readFile(path.join(rootDir, ...rebuiltLayerPath.split('/')));
		const finalResult = await buildLayeredRuntimeAssets({ rootDir });
		expect(finalResult.tinygo.changed).toBe(false);
		expect(await readFile(manifestPath)).toEqual(stableManifest);
		expect(await readFile(path.join(rootDir, ...rebuiltLayerPath.split('/')))).toEqual(
			stableLayer
		);

		await writeFile(
			path.join(rootDir, ...rebuiltLayerPath.split('/')),
			gzipSync(Buffer.from('truncated-layer'))
		);
		await expect(buildLayeredRuntimeAssets({ rootDir })).rejects.toThrow(
			/length for layer .* does not match its manifest/
		);
	});

	it('prints Rust, Go, TinyGo, and .NET byte summaries from the CLI', async () => {
		const rootDir = await makeTempDir();
		const scriptPath = path.resolve('scripts/build-layered-runtime-assets.mjs');
		const { stdout } = await execFileAsync(process.execPath, [scriptPath, rootDir], {
			cwd: path.resolve('.')
		});

		expect(stdout).toContain('Rust: before 0 bytes, after 0 bytes, saved 0 bytes');
		expect(stdout).toContain('Go: before 0 bytes, after 0 bytes, saved 0 bytes');
		expect(stdout).toContain('TinyGo: before 0 bytes, after 0 bytes, saved 0 bytes');
		expect(stdout).toContain('.NET: before 0 bytes, after 0 bytes, saved 0 bytes');
	});
});
