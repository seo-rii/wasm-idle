import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_RUNTIME_ASSET_BYTES, fetchRuntimeAssetBytes } from '../src/runtime-asset.js';

describe('runtime asset loader', () => {
	it('inflates gzip-compressed assets after fetch', async () => {
		const body = gzipSync(new TextEncoder().encode('compressed D runtime asset'));
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () => new Response(body),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('compressed D runtime asset');
	});

	it('does not inflate again when fetch already decoded gzip content encoding', async () => {
		const body = new TextEncoder().encode('decoded D runtime asset');
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () =>
				new Response(body, {
					headers: {
						'Content-Encoding': 'gzip'
					}
				}),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('decoded D runtime asset');
	});

	it('omits credentials and rejects redirects for exact HTTP asset requests', async () => {
		const fetchImpl = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3)));

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl
			)
		).resolves.toEqual(Uint8Array.of(1, 2, 3));
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://example.test/runtime/bin/ldc2.wasm',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
	});

	it('rejects embedded URL credentials before invoking fetch', async () => {
		const fetchImpl = vi.fn();

		await expect(
			fetchRuntimeAssetBytes(
				'https://user:secret@example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl
			)
		).rejects.toThrow('D runtime asset URLs must not include credentials');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('cancels a response whose final URL differs from the declared asset', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', {
			value: 'https://mirror.test/runtime/bin/ldc2.wasm'
		});

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				async () => response
			)
		).rejects.toThrow(
			'D runtime asset ldc2.wasm returned an unexpected final URL: https://mirror.test/runtime/bin/ldc2.wasm'
		);
		expect(cancelled).toBe(true);
	});

	it('rejects an oversized declared response before reading its body', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull() {
							throw new Error('body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{
						headers: { 'Content-Length': String(DEFAULT_MAX_RUNTIME_ASSET_BYTES + 1) }
					}
				)
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl
			)
		).rejects.toThrow(
			`ldc2.wasm download size exceeds the ${DEFAULT_MAX_RUNTIME_ASSET_BYTES} byte limit`
		);
		expect(cancelled).toBe(true);
	});

	it('cancels an unknown-length download as soon as it crosses its byte limit', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(Uint8Array.of(1, 2, 3));
							controller.enqueue(Uint8Array.of(4, 5, 6));
						},
						cancel() {
							cancelled = true;
						}
					})
				)
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/toolchain.tar',
				'D toolchain',
				fetchImpl,
				undefined,
				undefined,
				5
			)
		).rejects.toThrow('D toolchain download size exceeds the 5 byte limit');
		expect(cancelled).toBe(true);
	});

	it('bounds streamed gzip output before materializing a decompression bomb', async () => {
		const expanded = new Uint8Array(4096);
		const compressed = gzipSync(expanded, { level: 9 });
		const limit = compressed.byteLength + 16;
		expect(limit).toBeLessThan(expanded.byteLength);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/toolchain.tar.gz',
				'D toolchain',
				async () => new Response(compressed),
				undefined,
				'gzip',
				limit
			)
		).rejects.toThrow(`D toolchain decompressed size exceeds the ${limit} byte limit`);
	});
});
