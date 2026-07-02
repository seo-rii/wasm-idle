import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { fetchRuntimeAssetBytes } from '../src/runtime-asset.js';

describe('runtime asset fetch fallback', () => {
	it('retries the gzip variant when a raw wasm asset resolves to html', async () => {
		const requestedUrls: string[] = [];

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/llvm/lld.wasm',
				'wasm-rust llvm asset llvm/lld.wasm',
				async (assetUrl) => {
					requestedUrls.push(String(assetUrl));
					if (String(assetUrl).endsWith('/llvm/lld.wasm')) {
						return new Response('<!doctype html><html><body>fallback</body></html>', {
							status: 200,
							headers: {
								'content-type': 'text/html; charset=utf-8'
							}
						});
					}
					if (String(assetUrl).endsWith('/llvm/lld.wasm.gz')) {
						return new Response(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
					}
					throw new Error(`unexpected asset ${String(assetUrl)}`);
				}
			)
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));

		expect(requestedUrls).toEqual([
			'https://example.test/runtime/llvm/lld.wasm',
			'https://example.test/runtime/llvm/lld.wasm.gz'
		]);
	});

	it('fails with a stale-bundle hint when both raw and gzip runtime assets resolve to html', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/llvm/lld.wasm',
				'wasm-rust llvm asset llvm/lld.wasm',
				async () =>
					new Response('<!doctype html><html><body>fallback</body></html>', {
						status: 200,
						headers: {
							'content-type': 'text/html; charset=utf-8'
						}
					})
			)
		).rejects.toThrow(
			/stale or wrong wasm-rust bundle|rewrote a missing nested asset request/i
		);
	});

	it('accepts already-decoded gzip assets without trying to decompress them again', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/rustc/rustc.wasm.gz',
				'rustc.wasm',
				async () =>
					new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), {
						status: 200,
						headers: {
							'content-encoding': 'gzip',
							'content-type': 'application/wasm'
						}
					})
			)
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
	});

	it('streams byte progress while reading an asset response body', async () => {
		const progressEvents: Array<{ loaded: number; total?: number }> = [];
		const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(bytes.slice(0, 2));
					controller.enqueue(bytes.slice(2, 5));
					controller.enqueue(bytes.slice(5));
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

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				(progress) => progressEvents.push(progress)
			)
		).resolves.toEqual(bytes);

		expect(progressEvents.map((event) => event.loaded)).toEqual([2, 5, 6]);
		expect(progressEvents.at(-1)?.total).toBe(bytes.byteLength);
	});
});
