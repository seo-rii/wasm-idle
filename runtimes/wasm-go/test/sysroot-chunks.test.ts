import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { splitGoSysrootPacks } from '../scripts/split-sysroot.mjs';
import { createBrowserGoBuildPlan } from '../src/build-planner.js';
import { compileGo } from '../src/compiler.js';
import {
	loadRuntimePackEntries,
	loadRuntimeSysrootChunks,
	clearRuntimePackCache
} from '../src/runtime-asset.js';
import { parseRuntimeManifest } from '../src/runtime-manifest.js';
import { createRuntimeManifest } from './helpers.js';
import type { RuntimeAssetPackReference, RuntimeSysrootChunk } from '../src/types.js';

const temporary: string[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => {
	clearRuntimePackCache();
	await Promise.all(
		temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

async function fixture() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'go-chunks-'));
	temporary.push(dir);
	await mkdir(path.join(dir, 'sysroot'));
	const manifest = createRuntimeManifest();
	const records = [
		{ name: 'fmt', bytes: Buffer.from('fmt-library'), imports: ['runtime'] },
		{ name: 'net/http', bytes: Buffer.from('http-library'), imports: ['fmt'] },
		{ name: 'runtime', bytes: Buffer.from('runtime-library'), imports: [] }
	];
	const packages = records.map(({ name, imports }) => ({
		importPath: name,
		runtimePath: `/sysroot/${name}.a`,
		imports
	}));
	for (const target of ['wasip1', 'js']) {
		const pieces = records.map(({ bytes }) =>
			target === 'js' ? Buffer.concat([bytes, Buffer.from('-js')]) : bytes
		);
		let offset = 0;
		const entries = records.map(({ name }, i) => {
			const entry = { runtimePath: `/sysroot/${name}.a`, offset, length: pieces[i]!.length };
			offset += entry.length;
			return entry;
		});
		const reference = {
			asset: `sysroot/${target}.pack.gz`,
			index: `sysroot/${target}.index.json.gz`,
			fileCount: entries.length,
			totalBytes: offset
		};
		await writeFile(path.join(dir, reference.asset), gzipSync(Buffer.concat(pieces)));
		await writeFile(
			path.join(dir, reference.index),
			gzipSync(
				JSON.stringify({
					format: 'wasm-go-runtime-pack-index-v1',
					fileCount: entries.length,
					totalBytes: offset,
					entries
				})
			)
		);
		await writeFile(
			path.join(dir, `sysroot/${target}.stdlib-index.json.gz`),
			gzipSync(
				JSON.stringify({
					format: 'wasm-go-stdlib-index-v1',
					packageCount: packages.length,
					packages
				})
			)
		);
		for (const [name, config] of Object.entries(manifest.targets)) {
			if ((name === 'js/wasm') === (target === 'js')) {
				config!.sysrootPack = reference;
				config!.stdlibIndex = {
					asset: `sysroot/${target}.stdlib-index.json.gz`,
					packageCount: packages.length
				};
			}
		}
	}
	await writeFile(path.join(dir, 'runtime-manifest.v1.json'), JSON.stringify(manifest));
	return { dir, records };
}

async function localFetch(dir: string, requests: string[], url: string | URL | Request) {
	const asset = new URL(String(url)).pathname.slice('/runtime/'.length);
	requests.push(asset);
	return new Response(await readFile(path.join(dir, asset)));
}

describe('dependency-selected Go sysroot packs', () => {
	it('round-trips every target and loads only the fmt/runtime closure', async () => {
		const { dir } = await fixture();
		const result = await splitGoSysrootPacks(dir);
		expect(result.changed).toBe(true);
		const manifest = parseRuntimeManifest(
			JSON.parse(await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8'))
		);
		for (const target of ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'] as const) {
			clearRuntimePackCache();
			const compile = await compileGo(
				{ code: 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }', target },
				{
					manifest,
					runtimeBaseUrl: 'https://test/runtime/',
					dependencies: {
						fetchImpl: (url) => localFetch(dir, [], url),
						runTool: async (invocation) => ({
							exitCode: 0,
							outputs: {
								[invocation.outputPath]: new Uint8Array([
									0, 97, 115, 109, 1, 0, 0, 0
								])
							}
						})
					}
				}
			);
			expect(compile.success).toBe(true);
			const selected = compile.plan!.sysrootChunks!;
			expect(selected).toHaveLength(2);
			expect(selected.flatMap((chunk) => chunk.runtimePaths).sort()).toEqual([
				'/sysroot/fmt.a',
				'/sysroot/runtime.a'
			]);
			const requests: string[] = [];
			const loaded = await loadRuntimeSysrootChunks(
				'https://test/runtime/',
				selected,
				(url) => localFetch(dir, requests, url)
			);
			expect(loaded.map((entry) => new TextDecoder().decode(entry.bytes)).sort()).toEqual(
				target === 'js/wasm'
					? ['fmt-library-js', 'runtime-library-js']
					: ['fmt-library', 'runtime-library']
			);
			expect(requests.every((name) => !name.includes('-02.'))).toBe(true);
			const all = await loadRuntimeSysrootChunks(
				'https://test/runtime/',
				manifest.targets[target]!.sysrootChunks!,
				(url) => localFetch(dir, [], url)
			);
			expect(all).toHaveLength(3);
		}
	});

	it('is deterministic and does not rewrite an already split bundle', async () => {
		const first = await fixture();
		const second = await fixture();
		await splitGoSysrootPacks(first.dir);
		await splitGoSysrootPacks(second.dir);
		const names = await readdir(path.join(first.dir, 'sysroot/chunks'));
		for (const name of names)
			expect(await readFile(path.join(first.dir, 'sysroot/chunks', name))).toEqual(
				await readFile(path.join(second.dir, 'sysroot/chunks', name))
			);
		const before = await readFile(path.join(first.dir, 'runtime-manifest.v1.json'));
		expect(await splitGoSysrootPacks(first.dir)).toEqual({ changed: false });
		expect(await readFile(path.join(first.dir, 'runtime-manifest.v1.json'))).toEqual(before);
	});

	it('preserves a custom target with its own legacy sysroot pack', async () => {
		const { dir } = await fixture();
		const manifestPath = path.join(dir, 'runtime-manifest.v1.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		const original = manifest.targets['wasip2/wasm'].sysrootPack;
		const custom = {
			...original,
			asset: 'sysroot/custom.pack.gz',
			index: 'sysroot/custom.index.json.gz'
		};
		await writeFile(
			path.join(dir, custom.asset),
			await readFile(path.join(dir, original.asset))
		);
		await writeFile(
			path.join(dir, custom.index),
			await readFile(path.join(dir, original.index))
		);
		manifest.targets['wasip2/wasm'].sysrootPack = custom;
		await writeFile(manifestPath, JSON.stringify(manifest));
		await splitGoSysrootPacks(dir);
		const after = JSON.parse(await readFile(manifestPath, 'utf8'));
		expect(after.targets['wasip2/wasm'].sysrootPack).toEqual(custom);
		expect(after.targets['wasip2/wasm'].sysrootChunks).toBeUndefined();
		const build = JSON.parse(await readFile(path.join(dir, 'runtime-build.json'), 'utf8'));
		expect(build.outputs.sysroots['wasip2/wasm'].packGzip).toBe(custom.asset);
		expect((await readFile(path.join(dir, custom.asset))).byteLength).toBeGreaterThan(0);
	});

	it.each(['separate', 'nested'] as const)(
		'preserves custom JS deltas with a %s base during WASI splitting',
		async (kind) => {
			const { dir, records } = await fixture();
			const manifestPath = path.join(dir, 'runtime-manifest.v1.json');
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			const originalBase: RuntimeAssetPackReference =
				manifest.targets['wasip1/wasm'].sysrootPack;
			const writeDelta = async (name: string, base: RuntimeAssetPackReference) => {
				const bytes = Buffer.alloc(9 * records.length);
				const entries = records.map(({ name, bytes: decoded }, index) => {
					const offset = index * 9;
					bytes[offset] = 1;
					bytes.writeUInt32LE(decoded.length, offset + 5);
					return {
						runtimePath: `/sysroot/${name}.a`,
						baseRuntimePath: `/sysroot/${name}.a`,
						offset,
						length: 9,
						decodedLength: decoded.length
					};
				});
				const decodedTotalBytes = records.reduce(
					(sum, entry) => sum + entry.bytes.length,
					0
				);
				const index = Buffer.from(
					JSON.stringify({
						format: 'wasm-go-runtime-delta-pack-index-v1',
						fileCount: entries.length,
						totalBytes: bytes.length,
						decodedTotalBytes,
						entries
					})
				);
				const reference: RuntimeAssetPackReference = {
					asset: `sysroot/${name}.pack.gz`,
					index: `sysroot/${name}.index.json.gz`,
					fileCount: entries.length,
					totalBytes: bytes.length,
					decodedTotalBytes,
					sha256: sha(bytes),
					indexSha256: sha(index),
					delta: { format: 'copy-literal-v1', base }
				};
				await writeFile(path.join(dir, reference.asset), gzipSync(bytes));
				await writeFile(path.join(dir, reference.index), gzipSync(index));
				return reference;
			};
			const customBase =
				kind === 'nested'
					? await writeDelta('custom-js-base', originalBase)
					: {
							...originalBase,
							asset: 'sysroot/custom-js-base.pack.gz',
							index: 'sysroot/custom-js-base.index.json.gz'
						};
			if (kind === 'separate') {
				await writeFile(
					path.join(dir, customBase.asset),
					await readFile(path.join(dir, originalBase.asset))
				);
				await writeFile(
					path.join(dir, customBase.index),
					await readFile(path.join(dir, originalBase.index))
				);
			}
			const jsReference = await writeDelta('js', customBase);
			manifest.targets['js/wasm'].sysrootPack = jsReference;
			await writeFile(manifestPath, JSON.stringify(manifest));
			const preservedAssets = new Map<string, Buffer>();
			for (
				let pack: RuntimeAssetPackReference | undefined = jsReference;
				pack;
				pack = pack.delta?.base
			) {
				for (const asset of [pack.asset, pack.index])
					preservedAssets.set(asset, await readFile(path.join(dir, asset)));
			}
			const fetchImpl: typeof fetch = (url) => localFetch(dir, [], url);
			const before = await loadRuntimePackEntries(
				'https://test/runtime/',
				jsReference,
				fetchImpl
			);
			await splitGoSysrootPacks(dir);
			const after = parseRuntimeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
			expect(after.targets['wasip1/wasm']!.sysrootChunks).toHaveLength(3);
			expect(after.targets['js/wasm']!.sysrootPack).toEqual(jsReference);
			expect(after.targets['js/wasm']!.sysrootChunks).toBeUndefined();
			for (const [asset, bytes] of preservedAssets)
				expect(await readFile(path.join(dir, asset))).toEqual(bytes);
			clearRuntimePackCache();
			expect(
				await loadRuntimePackEntries(
					'https://test/runtime/',
					after.targets['js/wasm']!.sysrootPack!,
					fetchImpl
				)
			).toEqual(before);
			const build = JSON.parse(await readFile(path.join(dir, 'runtime-build.json'), 'utf8'));
			expect(build.outputs.sysroots['js/wasm'].packGzip).toBe(jsReference.asset);
			expect(await splitGoSysrootPacks(dir)).toEqual({ changed: false });
		}
	);

	it('honors aggregate decoded limits and cancellation before downloading chunks', async () => {
		const { dir } = await fixture();
		await splitGoSysrootPacks(dir);
		const manifest = JSON.parse(
			await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8')
		);
		const chunks: RuntimeSysrootChunk[] = manifest.targets['wasip1/wasm'].sysrootChunks;
		let fetched = 0;
		const fetchImpl: typeof fetch = async () => {
			fetched++;
			throw new Error('unexpected fetch');
		};
		await expect(
			loadRuntimeSysrootChunks('https://test/runtime/', chunks, fetchImpl, undefined, {
				maxAssetBytes: 10
			})
		).rejects.toThrow(/hard asset limit/);
		const controller = new AbortController();
		controller.abort(new Error('cancelled'));
		await expect(
			loadRuntimeSysrootChunks('https://test/runtime/', chunks, fetchImpl, undefined, {
				signal: controller.signal
			})
		).rejects.toThrow('cancelled');
		expect(fetched).toBe(0);
	});

	it('requires decoded sizes for delta chunks before fetching', async () => {
		const { dir } = await fixture();
		await splitGoSysrootPacks(dir);
		const manifest = JSON.parse(
			await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8')
		);
		const chunks: RuntimeSysrootChunk[] = manifest.targets['js/wasm'].sysrootChunks;
		for (const chunk of chunks) delete chunk.decodedTotalBytes;
		expect(() => parseRuntimeManifest(manifest)).toThrow(/chunk paths or integrity/);
		let fetched = 0;
		await expect(
			loadRuntimeSysrootChunks('https://test/runtime/', chunks, async () => {
				fetched++;
				throw new Error('unexpected fetch');
			})
		).rejects.toThrow(/requires decodedTotalBytes/);
		expect(fetched).toBe(0);
	});

	it('also limits actual mounted bytes when index ranges overlap', async () => {
		const bytes = new Uint8Array(600);
		const runtimePaths = ['/sysroot/a.a', '/sysroot/b.a'];
		const index = Buffer.from(
			JSON.stringify({
				format: 'wasm-go-runtime-pack-index-v1',
				fileCount: 2,
				totalBytes: bytes.byteLength,
				entries: runtimePaths.map((runtimePath) => ({
					runtimePath,
					offset: 0,
					length: bytes.byteLength
				}))
			})
		);
		const chunk: RuntimeSysrootChunk = {
			asset: 'overlap.pack',
			index: 'overlap.index.json',
			fileCount: 2,
			totalBytes: bytes.byteLength,
			sha256: sha(bytes),
			indexSha256: sha(index),
			runtimePaths
		};
		await expect(
			loadRuntimeSysrootChunks(
				'https://test/runtime/',
				[chunk],
				async (url) => new Response(String(url).endsWith('.json') ? index : bytes),
				undefined,
				{ maxAssetBytes: 900 }
			)
		).rejects.toThrow(/hard asset limit/);
	});

	it('preserves delta base paths from a different WASI chunk', async () => {
		const { dir, records } = await fixture();
		const manifestPath = path.join(dir, 'runtime-manifest.v1.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		const reference = manifest.targets['js/wasm'].sysrootPack;
		const expected = records[0]!.bytes;
		const delta = Buffer.alloc(9);
		delta[0] = 1;
		delta.writeUInt32LE(expected.byteLength, 5);
		const index = {
			format: 'wasm-go-runtime-delta-pack-index-v1',
			fileCount: 1,
			totalBytes: delta.byteLength,
			decodedTotalBytes: expected.byteLength,
			entries: [
				{
					runtimePath: '/sysroot/runtime.a',
					offset: 0,
					length: delta.byteLength,
					decodedLength: expected.byteLength,
					baseRuntimePath: '/sysroot/fmt.a'
				}
			]
		};
		Object.assign(reference, {
			fileCount: 1,
			totalBytes: delta.byteLength,
			decodedTotalBytes: expected.byteLength,
			delta: { format: 'copy-literal-v1', base: manifest.targets['wasip1/wasm'].sysrootPack }
		});
		await writeFile(path.join(dir, reference.asset), gzipSync(delta));
		await writeFile(path.join(dir, reference.index), gzipSync(JSON.stringify(index)));
		await writeFile(manifestPath, JSON.stringify(manifest));
		const fetchImpl: typeof fetch = (url) => localFetch(dir, [], url);
		const before = await loadRuntimePackEntries('https://test/runtime/', reference, fetchImpl);
		clearRuntimePackCache();
		await splitGoSysrootPacks(dir);
		const afterManifest = parseRuntimeManifest(
			JSON.parse(await readFile(manifestPath, 'utf8'))
		);
		const chunks = afterManifest.targets['js/wasm']!.sysrootChunks!;
		const after = await loadRuntimeSysrootChunks('https://test/runtime/', chunks, fetchImpl);
		expect(after.map((entry) => ({ ...entry, bytes: Buffer.from(entry.bytes) }))).toEqual(
			before.map((entry) => ({ ...entry, bytes: Buffer.from(entry.bytes) }))
		);
		expect(Buffer.from(after[0]!.bytes)).toEqual(expected);
		expect(chunks[0]!.delta!.base.asset).toContain('wasip1-js-');
	});

	it('selects explicit library dependencies without forcing the runtime chunk', async () => {
		const { dir } = await fixture();
		await splitGoSysrootPacks(dir);
		const manifest = JSON.parse(
			await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8')
		);
		const plan = createBrowserGoBuildPlan(
			{
				code: 'package util',
				packageKind: 'library',
				packageImportPath: 'util',
				dependencies: [{ importPath: 'fmt', archivePath: '/sysroot/fmt.a' }]
			},
			manifest
		);
		expect(plan.sysrootChunks).toHaveLength(1);
		expect(plan.sysrootChunks![0]!.runtimePaths).toEqual(['/sysroot/fmt.a']);
	});

	it('rejects malformed chunk manifests, overlapping paths and missing integrity', async () => {
		const { dir } = await fixture();
		await splitGoSysrootPacks(dir);
		const pristine = JSON.parse(
			await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8')
		);
		for (const mutate of [
			(chunks: RuntimeSysrootChunk[]) => {
				delete chunks[0]!.sha256;
			},
			(chunks: RuntimeSysrootChunk[]) => {
				chunks[0]!.sha256 = 'bad';
			},
			(chunks: RuntimeSysrootChunk[]) => {
				chunks[1]!.runtimePaths = chunks[0]!.runtimePaths;
			},
			(chunks: RuntimeSysrootChunk[]) => {
				chunks[0]!.runtimePaths = ['/sysroot/../escape'];
			}
		]) {
			const copy = structuredClone(pristine);
			mutate(copy.targets['wasip1/wasm'].sysrootChunks);
			expect(() => parseRuntimeManifest(copy)).toThrow();
		}
	});

	it('rejects tampering before mounting and does not reuse an incompatible cached receipt', async () => {
		const { dir } = await fixture();
		await splitGoSysrootPacks(dir);
		const manifest = JSON.parse(
			await readFile(path.join(dir, 'runtime-manifest.v1.json'), 'utf8')
		);
		const chunk: RuntimeSysrootChunk = manifest.targets['wasip1/wasm'].sysrootChunks[0];
		const fetchImpl: typeof fetch = (url) => localFetch(dir, [], url);
		await loadRuntimeSysrootChunks('https://test/runtime/', [chunk], fetchImpl);
		await expect(
			loadRuntimeSysrootChunks(
				'https://test/runtime/',
				[{ ...chunk, sha256: '0'.repeat(64) }],
				fetchImpl
			)
		).rejects.toThrow(/SHA-256 mismatch/);
		clearRuntimePackCache();
		await expect(
			loadRuntimeSysrootChunks(
				'https://test/runtime/',
				[{ ...chunk, indexSha256: sha(Buffer.from('wrong')) }],
				fetchImpl
			)
		).rejects.toThrow(/SHA-256 mismatch/);
		clearRuntimePackCache();
		await expect(
			loadRuntimeSysrootChunks(
				'https://test/runtime/',
				[{ ...chunk, runtimePaths: ['/sysroot/other.a'] }],
				fetchImpl
			)
		).rejects.toThrow(/paths differ/);
	});
});
