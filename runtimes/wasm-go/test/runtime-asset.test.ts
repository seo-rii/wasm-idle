import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	clearRuntimePackCache,
	fetchRuntimeAssetBytes,
	loadRuntimePackEntries,
	parseRuntimePackIndex
} from '../src/runtime-asset.js';

function encodeUint32(value: number) {
	return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function encodeLiteral(...bytes: number[]) {
	return [0, ...encodeUint32(bytes.length), ...bytes];
}

function encodeCopy(baseOffset: number, length: number) {
	return [1, ...encodeUint32(baseOffset), ...encodeUint32(length)];
}

describe('runtime assets', () => {
	afterEach(() => {
		clearRuntimePackCache();
		vi.useRealTimers();
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

	it('loads identity packed runtime entries without delta metadata', async () => {
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

	it('reuses successfully loaded packs when callers provide abort signals', async () => {
		const requests: string[] = [];
		const fetchImpl = async (url: string | URL | Request) => {
			requests.push(String(url));
			if (String(url).endsWith('.index.json')) {
				return new Response(
					JSON.stringify({
						format: 'wasm-go-runtime-pack-index-v1',
						fileCount: 1,
						totalBytes: 3,
						entries: [{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 }]
					})
				);
			}
			return new Response(new Uint8Array([1, 2, 3]));
		};
		const pack = {
			index: 'sysroot/wasip1.index.json',
			asset: 'sysroot/wasip1.pack',
			fileCount: 1,
			totalBytes: 3
		};

		await loadRuntimePackEntries(
			'https://example.invalid/runtime/',
			pack,
			fetchImpl as typeof fetch,
			undefined,
			{ signal: new AbortController().signal }
		);
		await loadRuntimePackEntries(
			'https://example.invalid/runtime/',
			pack,
			fetchImpl as typeof fetch,
			undefined,
			{ signal: new AbortController().signal }
		);

		expect(requests).toEqual([
			'https://example.invalid/runtime/sysroot/wasip1.index.json',
			'https://example.invalid/runtime/sysroot/wasip1.pack'
		]);
	});

	it('recursively loads and decodes copy/literal delta packs', async () => {
		const fmtDelta = [...encodeCopy(1, 3), ...encodeLiteral(90, 91)];
		const renamedDelta = [...encodeCopy(0, 2), ...encodeLiteral(99)];
		const deltaBytes = new Uint8Array([...fmtDelta, ...renamedDelta]);
		const requests: string[] = [];
		const assetProgress: Array<{ loaded: number; total?: number }> = [];
		const entries = await loadRuntimePackEntries(
			'https://example.invalid/runtime/',
			{
				index: 'sysroot/delta.index.json',
				asset: 'sysroot/delta.pack',
				fileCount: 2,
				totalBytes: deltaBytes.byteLength,
				decodedTotalBytes: 8,
				delta: {
					format: 'copy-literal-v1',
					base: {
						index: 'sysroot/base.index.json',
						asset: 'sysroot/base.pack',
						fileCount: 2,
						totalBytes: 8
					}
				}
			},
			async (url) => {
				const requestUrl = String(url);
				requests.push(requestUrl);
				if (requestUrl.endsWith('/delta.index.json')) {
					return new Response(
						JSON.stringify({
							format: 'wasm-go-runtime-delta-pack-index-v1',
							fileCount: 2,
							totalBytes: deltaBytes.byteLength,
							decodedTotalBytes: 8,
							entries: [
								{
									runtimePath: '/sysroot/fmt.a',
									offset: 0,
									length: fmtDelta.length,
									decodedLength: 5
								},
								{
									runtimePath: '/sysroot/renamed.a',
									baseRuntimePath: '/sysroot/shared.a',
									offset: fmtDelta.length,
									length: renamedDelta.length,
									decodedLength: 3
								}
							]
						})
					);
				}
				if (requestUrl.endsWith('/delta.pack')) {
					return new Response(deltaBytes);
				}
				if (requestUrl.endsWith('/base.index.json')) {
					return new Response(
						JSON.stringify({
							format: 'wasm-go-runtime-pack-index-v1',
							fileCount: 2,
							totalBytes: 8,
							entries: [
								{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 5 },
								{ runtimePath: '/sysroot/shared.a', offset: 5, length: 3 }
							]
						})
					);
				}
				if (requestUrl.endsWith('/base.pack')) {
					return new Response(new Uint8Array([10, 11, 12, 13, 14, 20, 21, 22]));
				}
				return new Response('missing', { status: 404 });
			},
			{ asset: (loaded, total) => assetProgress.push({ loaded, total }) }
		);

		expect(entries.map((entry) => entry.runtimePath)).toEqual([
			'/sysroot/fmt.a',
			'/sysroot/renamed.a'
		]);
		expect(Array.from(entries[0]!.bytes)).toEqual([11, 12, 13, 90, 91]);
		expect(Array.from(entries[1]!.bytes)).toEqual([20, 21, 99]);
		expect(requests).toEqual([
			'https://example.invalid/runtime/sysroot/delta.index.json',
			'https://example.invalid/runtime/sysroot/delta.pack',
			'https://example.invalid/runtime/sysroot/base.index.json',
			'https://example.invalid/runtime/sysroot/base.pack'
		]);
		expect(assetProgress.length).toBeGreaterThan(1);
		expect(assetProgress.map(({ loaded }) => loaded)).toEqual(
			[...assetProgress.map(({ loaded }) => loaded)].sort((left, right) => left - right)
		);
		expect(assetProgress.at(-1)?.loaded).toBe(assetProgress.at(-1)?.total);
	});

	it.each([
		{
			name: 'truncated literal payload',
			encoded: [0, ...encodeUint32(3), 1, 2],
			decodedLength: 3,
			expected: /literal exceeds encoded entry length/
		},
		{
			name: 'out-of-bounds copy',
			encoded: encodeCopy(2, 2),
			decodedLength: 2,
			expected: /copy range 2\+2 exceeds base length 3/
		},
		{
			name: 'short decoded output',
			encoded: encodeLiteral(1, 2),
			decodedLength: 3,
			expected: /decoded 2 bytes, expected 3/
		},
		{
			name: 'unknown operation',
			encoded: [2],
			decodedLength: 0,
			expected: /unknown operation 2/
		}
	])('rejects malformed delta streams: $name', async ({ encoded, decodedLength, expected }) => {
		await expect(
			loadRuntimePackEntries(
				'https://example.invalid/runtime/',
				{
					index: 'sysroot/delta.index.json',
					asset: 'sysroot/delta.pack',
					fileCount: 1,
					totalBytes: encoded.length,
					decodedTotalBytes: decodedLength,
					delta: {
						format: 'copy-literal-v1',
						base: {
							index: 'sysroot/base.index.json',
							asset: 'sysroot/base.pack',
							fileCount: 1,
							totalBytes: 3
						}
					}
				},
				async (url) => {
					const requestUrl = String(url);
					if (requestUrl.endsWith('/delta.index.json')) {
						return new Response(
							JSON.stringify({
								format: 'wasm-go-runtime-delta-pack-index-v1',
								fileCount: 1,
								totalBytes: encoded.length,
								decodedTotalBytes: decodedLength,
								entries: [
									{
										runtimePath: '/sysroot/fmt.a',
										offset: 0,
										length: encoded.length,
										decodedLength
									}
								]
							})
						);
					}
					if (requestUrl.endsWith('/delta.pack')) {
						return new Response(new Uint8Array(encoded));
					}
					if (requestUrl.endsWith('/base.index.json')) {
						return new Response(
							JSON.stringify({
								format: 'wasm-go-runtime-pack-index-v1',
								fileCount: 1,
								totalBytes: 3,
								entries: [{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 }]
							})
						);
					}
					if (requestUrl.endsWith('/base.pack')) {
						return new Response(new Uint8Array([10, 11, 12]));
					}
					return new Response('missing', { status: 404 });
				}
			)
		).rejects.toThrow(expected);
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
			fetchRuntimeAssetBytes(
				'https://example.invalid/tools/compile.wasm',
				'compile.wasm',
				async () => new Response('<!doctype html><html></html>')
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

	it('rejects declared and streamed assets above the caller byte cap', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.invalid/declared.wasm',
				'declared.wasm',
				async () =>
					new Response(new Uint8Array(8), {
						headers: { 'content-length': '8' }
					}),
				true,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/hard asset limit 4 bytes/);

		const cancel = vi.fn();
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.invalid/streamed.wasm',
				'streamed.wasm',
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new Uint8Array([1, 2, 3]));
								controller.enqueue(new Uint8Array([4, 5, 6]));
							},
							cancel
						})
					),
				true,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/hard asset limit 4 bytes/);
		expect(cancel).toHaveBeenCalled();
	});

	it('caps decompressed gzip bytes instead of trusting the compressed size', async () => {
		const compressed = new Uint8Array(gzipSync(new Uint8Array(1024).fill(65)));
		expect(compressed.byteLength).toBeLessThan(1024);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.invalid/runtime.pack.gz',
				'runtime.pack',
				async () => new Response(compressed),
				true,
				undefined,
				{ maxAssetBytes: compressed.byteLength }
			)
		).rejects.toThrow(/hard asset limit/);
	});

	it('aborts an in-flight streamed asset and cancels its reader', async () => {
		const controller = new AbortController();
		const reason = new Error('stop Go asset');
		const cancel = vi.fn();
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const pending = fetchRuntimeAssetBytes(
			'https://example.invalid/pending.wasm',
			'pending.wasm',
			async () =>
				new Response(
					new ReadableStream({
						start(streamController) {
							streamController.enqueue(new Uint8Array([1]));
						},
						cancel
					})
				),
			true,
			() => markStarted(),
			{ signal: controller.signal }
		);
		await started;
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancel).toHaveBeenCalled();
	});

	it('enforces the asset deadline even when a custom fetch ignores its signal', async () => {
		vi.useFakeTimers();
		const pending = fetchRuntimeAssetBytes(
			'https://example.invalid/hung.wasm',
			'hung.wasm',
			() => new Promise(() => undefined),
			true,
			undefined,
			{ assetTimeoutMs: 5 }
		);
		const outcome = pending.catch((error) => error);

		await vi.advanceTimersByTimeAsync(5);

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			message: 'hung.wasm timed out after 5 ms'
		});
	});

	it('rejects oversized declared delta output before allocating decoded entries', async () => {
		await expect(
			loadRuntimePackEntries(
				'https://example.invalid/runtime/',
				{
					index: 'delta.index.json',
					asset: 'delta.pack',
					fileCount: 1,
					totalBytes: 0,
					decodedTotalBytes: 2_048,
					delta: {
						format: 'copy-literal-v1',
						base: {
							index: 'base.index.json',
							asset: 'base.pack',
							fileCount: 0,
							totalBytes: 0
						}
					}
				},
				async (url) => {
					if (String(url).endsWith('.index.json')) {
						return new Response(
							JSON.stringify({
								format: 'wasm-go-runtime-delta-pack-index-v1',
								fileCount: 1,
								totalBytes: 0,
								decodedTotalBytes: 2_048,
								entries: [
									{
										runtimePath: '/large.a',
										offset: 0,
										length: 0,
										decodedLength: 2_048
									}
								]
							})
						);
					}
					return new Response(new Uint8Array());
				},
				undefined,
				{ maxAssetBytes: 1_024 }
			)
		).rejects.toThrow(/decoded bytes exceed the hard asset limit 1024 bytes/);
	});
});
