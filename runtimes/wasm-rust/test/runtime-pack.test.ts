import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it } from 'vitest';

import { buildRuntimePack } from '../scripts/runtime-pack.mjs';
import {
	clearRuntimeAssetPackCache,
	loadRuntimePackEntries,
	parseRuntimePackIndex
} from '../src/runtime-asset-store.js';

describe('runtime pack', () => {
	beforeEach(() => {
		clearRuntimeAssetPackCache();
	});

	it('round-trips pack entries through the generated index and runtime loader', async () => {
		const { packBytes, index } = await buildRuntimePack([
			{
				runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
				bytes: new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0x01])
			},
			{
				runtimePath: '/work/alloc.o',
				bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d])
			}
		]);
		const parsedIndex = parseRuntimePackIndex(index);
		const progressEvents: Array<{ loaded: number; total?: number }> = [];
		const gzippedPackBytes = gzipSync(packBytes);

		expect(parsedIndex.fileCount).toBe(2);
		expect(parsedIndex.entries.map((entry) => entry.runtimePath)).toEqual([
			'/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
			'/work/alloc.o'
		]);

		const loadedEntries = await loadRuntimePackEntries(
			'https://example.test/runtime/',
			{
				asset: 'packs/sysroot/wasm32-wasip1.pack.gz',
				index: 'packs/sysroot/wasm32-wasip1.index.json.gz',
				fileCount: index.fileCount,
				totalBytes: index.totalBytes
			},
			async (url) => {
				if (String(url).endsWith('.index.json.gz')) {
					return new Response(gzipSync(JSON.stringify(index)), {
						status: 200,
						headers: {
							'content-type': 'application/gzip'
						}
					});
				}
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(gzippedPackBytes.slice(0, 3));
							controller.enqueue(gzippedPackBytes.slice(3));
							controller.close();
						}
					}),
					{
						status: 200,
						headers: {
							'content-length': String(gzippedPackBytes.byteLength),
							'content-type': 'application/gzip'
						}
					}
				);
			},
			(progress) => progressEvents.push(progress)
		);

		expect(
			loadedEntries.map((entry) => ({
				runtimePath: entry.runtimePath,
				bytes: [...entry.bytes]
			}))
		).toEqual([
			{
				runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
				bytes: [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0x01]
			},
			{
				runtimePath: '/work/alloc.o',
				bytes: [0x00, 0x61, 0x73, 0x6d]
			}
		]);
		expect(progressEvents.map((event) => event.loaded)).toEqual([3, gzippedPackBytes.byteLength]);
		expect(progressEvents.at(-1)?.total).toBe(gzippedPackBytes.byteLength);
	});

	it('rejects malformed runtime pack indexes', () => {
		expect(() =>
			parseRuntimePackIndex({
				format: 'wasm-rust-runtime-pack-index-v1',
				fileCount: 2,
				totalBytes: 3,
				entries: [
					{
						runtimePath: '/work/alloc.o',
						offset: 0,
						length: 2
					},
					{
						runtimePath: '/work/alloc.o',
						offset: 2,
						length: 2
					}
				]
			})
		).toThrow(/runtimePath \/work\/alloc\.o/);
	});
});
