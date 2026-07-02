import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it } from 'vitest';

import { clearLinkAssetCache, linkBitcodeWithLlvmWasm } from '../src/browser-linker.js';
import { normalizeRuntimeManifest, resolveTargetManifest } from '../src/runtime-manifest.js';
import { createRuntimeManifest, createRuntimeManifestV3 } from './helpers.js';

interface FakeLlvmInitOptions {
	locateFile(file: string): string;
	wasmBinary?: Uint8Array;
	getPreloadedPackage?: (packageName: string, packageSize: number) => ArrayBuffer;
	print(text: string): void;
	printErr(text: string): void;
}

function createFakeLlvmModules() {
	const llcFiles = new Map<string, Uint8Array>();
	const lldFiles = new Map<string, Uint8Array>();
	let llcInitOptions: FakeLlvmInitOptions | null = null;
	let lldInitOptions: FakeLlvmInitOptions | null = null;
	let llcCallMainGate: Promise<void> | null = null;

	return {
		blockLlcCallMain(gate: Promise<void>) {
			llcCallMainGate = gate;
		},
		getLlcInitOptions: () => llcInitOptions,
		getLldInitOptions: () => lldInitOptions,
		writtenPaths: lldFiles,
		importRuntimeModule: async <T>(assetUrl: string) => {
			if (assetUrl.endsWith('/llvm/llc.js')) {
				return {
					default: async (options: FakeLlvmInitOptions) => {
						llcInitOptions = options;
						return {
							FS: {
								mkdir() {},
								writeFile(filePath: string, contents: Uint8Array) {
									llcFiles.set(filePath, new Uint8Array(contents));
								},
								readFile(filePath: string) {
									const file = llcFiles.get(filePath);
									if (!file) {
										throw new Error(`missing fake llc file ${filePath}`);
									}
									return file;
								}
							},
							async callMain() {
								if (llcCallMainGate) {
									await llcCallMainGate;
								}
								llcFiles.set('/work/main.o', new Uint8Array([0xaa, 0xbb, 0xcc]));
							}
						};
					}
				} as T;
			}
			if (assetUrl.endsWith('/llvm/lld.js')) {
				return {
					default: async (options: FakeLlvmInitOptions) => {
						lldInitOptions = options;
						return {
							FS: {
								mkdir() {},
								writeFile(filePath: string, contents: Uint8Array) {
									lldFiles.set(filePath, new Uint8Array(contents));
								},
								readFile(filePath: string) {
									const file = lldFiles.get(filePath);
									if (!file) {
										throw new Error(`missing fake lld file ${filePath}`);
									}
									return file;
								}
							},
							async callMain() {
								lldFiles.set(
									'/work/main.wasm',
									new Uint8Array([0x00, 0x61, 0x73, 0x6d])
								);
							}
						};
					}
				} as T;
			}
			throw new Error(`unexpected runtime module ${assetUrl}`);
		}
	};
}

function createNormalizedTarget() {
	const manifest = normalizeRuntimeManifest(createRuntimeManifest());
	const target = resolveTargetManifest(manifest);
	target.compile.link.files = [
		...(target.compile.link.files || []),
		{
			asset: 'link/extra.a',
			runtimePath: '/rustlib/extra.a'
		}
	];
	return {
		manifest,
		target
	};
}

function createNormalizedPackTarget() {
	const manifest = normalizeRuntimeManifest(createRuntimeManifestV3());
	return {
		manifest,
		target: resolveTargetManifest(manifest)
	};
}

describe('browser linker asset loading', () => {
	beforeEach(() => {
		clearLinkAssetCache();
	});

	it('prefetches link assets in parallel before writing them into lld', async () => {
		const { manifest, target } = createNormalizedTarget();
		const modules = createFakeLlvmModules();
		const progressEvents: Array<{
			stage: 'link' | 'componentize';
			completed: number;
			total: number;
			message?: string;
			bytesCompleted?: number;
			bytesTotal?: number;
		}> = [];
		let releaseLlcCallMain: (() => void) | null = null;
		modules.blockLlcCallMain(
			new Promise<void>((resolve) => {
				releaseLlcCallMain = resolve;
			})
		);
		const requestedUrls: string[] = [];
		const pendingResponses = new Map<string, (response: Response) => void>();
		const expectedUrls = [
			'llvm/llc.wasm',
			'llvm/lld.wasm',
			'llvm/lld.data',
			target.compile.link.allocatorObjectAsset!,
			...(target.compile.link.files || []).map((entry) => entry.asset)
		].map((assetPath) => `https://example.test/runtime/${assetPath}`);

		const linkPromise = linkBitcodeWithLlvmWasm(
			new Uint8Array([1, 2, 3, 4]),
			manifest,
			target,
			'https://example.test/runtime/',
			{
				importRuntimeModule: modules.importRuntimeModule,
				onProgress: (progress) => progressEvents.push(progress),
				fetchImpl: async (assetUrl) => {
					requestedUrls.push(String(assetUrl));
					if (
						String(assetUrl).endsWith('/llvm/llc.wasm') ||
						String(assetUrl).endsWith('/llvm/lld.wasm') ||
						String(assetUrl).endsWith('/llvm/lld.data')
					) {
						const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
						return new Response(
							new ReadableStream({
								start(controller) {
									controller.enqueue(bytes.slice(0, 2));
									controller.enqueue(bytes.slice(2));
									controller.close();
								}
							}),
							{
								status: 200,
								headers: {
									'content-length': String(bytes.byteLength)
								}
							}
						);
					}
					return await new Promise<Response>((resolve) => {
						pendingResponses.set(String(assetUrl), resolve);
					});
				}
			}
		);

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(requestedUrls.sort()).toEqual(expectedUrls.sort());

		releaseLlcCallMain?.();
		for (const [assetUrl, resolve] of pendingResponses) {
			resolve(new Response(new Uint8Array(assetUrl.endsWith('alloc.o') ? [1] : [2, 3, 4])));
		}

		const artifact = await linkPromise;

		expect(artifact.format).toBe('core-wasm');
		expect([...modules.writtenPaths.keys()]).toEqual(
			expect.arrayContaining([
				'/work/main.o',
				'/work/alloc.o',
				'/rustlib/libstd.rlib',
				'/rustlib/extra.a',
				'/work/main.wasm'
			])
		);
		expect(progressEvents.some((event) => event.bytesCompleted !== undefined)).toBe(true);
		expect(
			progressEvents.some(
				(event) =>
					event.stage === 'link' &&
					event.bytesCompleted !== undefined &&
					event.bytesCompleted < (event.bytesTotal || 0)
			)
		).toBe(true);
	});

	it('reuses cached runtime link assets across repeated linker runs', async () => {
		const { manifest, target } = createNormalizedTarget();
		let fetchCount = 0;
		const modules = createFakeLlvmModules();

		const fetchImpl = async (assetUrl: string | URL | Request) => {
			fetchCount += 1;
			return new Response(new Uint8Array([String(assetUrl).length % 255]));
		};

		await linkBitcodeWithLlvmWasm(
			new Uint8Array([1, 2, 3]),
			manifest,
			target,
			'https://example.test/runtime/',
			{
				importRuntimeModule: modules.importRuntimeModule,
				fetchImpl
			}
		);
		await linkBitcodeWithLlvmWasm(
			new Uint8Array([4, 5, 6]),
			manifest,
			target,
			'https://example.test/runtime/',
			{
				importRuntimeModule: modules.importRuntimeModule,
				fetchImpl
			}
		);

		expect(fetchCount).toBe(6);
	});

	it('loads link assets from a shared runtime pack instead of per-file fetches', async () => {
		const { manifest, target } = createNormalizedPackTarget();
		const modules = createFakeLlvmModules();
		const requestedUrls: string[] = [];

		const artifact = await linkBitcodeWithLlvmWasm(
			new Uint8Array([1, 2, 3]),
			manifest,
			target,
			'https://example.test/runtime/',
			{
				importRuntimeModule: modules.importRuntimeModule,
				fetchImpl: async (assetUrl) => {
					requestedUrls.push(String(assetUrl));
					if (String(assetUrl).endsWith('/llvm/llc.wasm.gz')) {
						return new Response(
							gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01]))
						);
					}
					if (String(assetUrl).endsWith('/llvm/lld.wasm.gz')) {
						return new Response(
							gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02]))
						);
					}
					if (String(assetUrl).endsWith('/llvm/lld.data.gz')) {
						return new Response(gzipSync(new Uint8Array([9, 8, 7])));
					}
					if (String(assetUrl).endsWith('.index.json.gz')) {
						return new Response(
							gzipSync(
								JSON.stringify({
									format: 'wasm-rust-runtime-pack-index-v1',
									fileCount: 2,
									totalBytes: 6,
									entries: [
										{
											runtimePath: '/rustlib/libstd.rlib',
											offset: 0,
											length: 4
										},
										{
											runtimePath: '/work/alloc.o',
											offset: 4,
											length: 2
										}
									]
								})
							)
						);
					}
					return new Response(gzipSync(new Uint8Array([9, 8, 7, 6, 5, 4])));
				}
			}
		);

		expect(artifact.format).toBe('core-wasm');
		expect(requestedUrls.sort()).toEqual([
			'https://example.test/runtime/llvm/llc.wasm.gz',
			'https://example.test/runtime/llvm/lld.data.gz',
			'https://example.test/runtime/llvm/lld.wasm.gz',
			'https://example.test/runtime/packs/link/wasm32-wasip1.index.json.gz',
			'https://example.test/runtime/packs/link/wasm32-wasip1.pack.gz'
		]);
		expect([
			...((modules.getLlcInitOptions()?.wasmBinary || new Uint8Array()) as Uint8Array)
		]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01]);
		expect([
			...new Uint8Array(
				modules.getLldInitOptions()?.getPreloadedPackage?.('lld.data', 3) ||
					new ArrayBuffer(0)
			)
		]).toEqual([9, 8, 7]);
		expect([...modules.writtenPaths.keys()]).toEqual(
			expect.arrayContaining([
				'/work/main.o',
				'/work/alloc.o',
				'/rustlib/libstd.rlib',
				'/work/main.wasm'
			])
		);
	});

	it('recovers when stale linker metadata asks for raw llvm assets but only gzip assets are available', async () => {
		const { manifest, target } = createNormalizedTarget();
		const modules = createFakeLlvmModules();
		const requestedUrls: string[] = [];

		const artifact = await linkBitcodeWithLlvmWasm(
			new Uint8Array([1, 2, 3]),
			manifest,
			target,
			'https://example.test/runtime/',
			{
				importRuntimeModule: modules.importRuntimeModule,
				fetchImpl: async (assetUrl) => {
					requestedUrls.push(String(assetUrl));
					if (
						String(assetUrl).endsWith('/llvm/llc.wasm') ||
						String(assetUrl).endsWith('/llvm/lld.wasm') ||
						String(assetUrl).endsWith('/llvm/lld.data')
					) {
						return new Response('<!doctype html><html><body>fallback</body></html>', {
							status: 200,
							headers: {
								'content-type': 'text/html; charset=utf-8'
							}
						});
					}
					if (
						String(assetUrl).endsWith('/llvm/llc.wasm.gz') ||
						String(assetUrl).endsWith('/llvm/lld.wasm.gz')
					) {
						return new Response(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
					}
					if (String(assetUrl).endsWith('/llvm/lld.data.gz')) {
						return new Response(gzipSync(new Uint8Array([9, 8, 7])));
					}
					return new Response(new Uint8Array([1, 2, 3, 4]));
				}
			}
		);

		expect(artifact.format).toBe('core-wasm');
		expect(requestedUrls).toEqual(
			expect.arrayContaining([
				'https://example.test/runtime/llvm/llc.wasm',
				'https://example.test/runtime/llvm/llc.wasm.gz',
				'https://example.test/runtime/llvm/lld.wasm',
				'https://example.test/runtime/llvm/lld.wasm.gz',
				'https://example.test/runtime/llvm/lld.data',
				'https://example.test/runtime/llvm/lld.data.gz'
			])
		);
	});
});
