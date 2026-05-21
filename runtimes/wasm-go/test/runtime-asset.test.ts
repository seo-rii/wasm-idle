import { afterEach, describe, expect, it } from 'vitest';

import {
	clearRuntimePackCache,
	fetchRuntimeAssetBytes,
	loadRuntimePackEntries,
	parseRuntimePackIndex
} from '../src/runtime-asset.js';

describe('runtime assets', () => {
	afterEach(() => {
		clearRuntimePackCache();
	});

	it('parses runtime pack indexes', () => {
		const index = parseRuntimePackIndex({
			format: 'wasm-go-runtime-pack-index-v1',
			fileCount: 1,
			totalBytes: 4,
			entries: [
				{
					runtimePath: '/sysroot/fmt.a',
					offset: 0,
					length: 4
				}
			]
		});

		expect(index.entries[0]?.runtimePath).toBe('/sysroot/fmt.a');
	});

	it('loads packed runtime entries', async () => {
		const requests: string[] = [];
		const entries = await loadRuntimePackEntries(
			'https://example.invalid/runtime/',
			{
				index: 'sysroot/wasip1.index.json',
				asset: 'sysroot/wasip1.pack',
				fileCount: 2,
				totalBytes: 6
			},
			async (url) => {
				requests.push(String(url));
				if (String(url).endsWith('.index.json')) {
					return new Response(
						JSON.stringify({
							format: 'wasm-go-runtime-pack-index-v1',
							fileCount: 2,
							totalBytes: 6,
							entries: [
								{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
								{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
							]
						})
					);
				}
				return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
			}
		);

		expect(entries.map((entry) => entry.runtimePath)).toEqual([
			'/sysroot/fmt.a',
			'/sysroot/runtime.a'
		]);
		expect(Array.from(entries[1]!.bytes)).toEqual([4, 5, 6]);
		expect(requests).toEqual([
			'https://example.invalid/runtime/sysroot/wasip1.index.json',
			'https://example.invalid/runtime/sysroot/wasip1.pack'
		]);
	});

	it('rejects truncated packed runtime payloads before slicing entries', async () => {
		await expect(
			loadRuntimePackEntries(
				'https://example.invalid/runtime/',
				{
					index: 'sysroot/wasip1.index.json',
					asset: 'sysroot/wasip1.pack',
					fileCount: 2,
					totalBytes: 6
				},
				async (url) => {
					if (String(url).endsWith('.index.json')) {
						return new Response(
							JSON.stringify({
								format: 'wasm-go-runtime-pack-index-v1',
								fileCount: 2,
								totalBytes: 6,
								entries: [
									{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
									{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
								]
							})
						);
					}
					return new Response(new Uint8Array([1, 2, 3, 4]));
				}
			)
		).rejects.toThrow(/expected 6 bytes but loaded 4/);
	});

	it('rejects html responses masquerading as assets', async () => {
		await expect(
			fetchRuntimeAssetBytes('https://example.invalid/tools/compile.wasm', 'compile.wasm', async () =>
				new Response('<!doctype html><html></html>')
			)
		).rejects.toThrow(/expected a wasm-go runtime asset but got HTML instead/);
	});

	it('reports incremental download progress for streamed runtime assets', async () => {
		const updates: Array<[number, number | undefined]> = [];
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.invalid/tools/compile.wasm',
			'compile.wasm',
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array([1, 2]));
							controller.enqueue(new Uint8Array([3, 4]));
							controller.close();
						}
					}),
					{
						headers: {
							'content-length': '4'
						}
					}
				),
			true,
			(loaded, total) => updates.push([loaded, total])
		);

		expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
		expect(updates).toEqual([
			[2, 4],
			[4, 4],
			[4, 4]
		]);
	});
});
