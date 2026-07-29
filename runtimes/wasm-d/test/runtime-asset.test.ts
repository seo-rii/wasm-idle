import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_RUNTIME_ASSET_BYTES, fetchRuntimeAssetBytes } from '../src/runtime-asset.js';
import {
	DEFAULT_MAX_RUNTIME_MANIFEST_BYTES,
	loadRuntimeManifest
} from '../src/runtime-manifest.js';

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
		const controller = new AbortController();

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl,
				undefined,
				undefined,
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				controller.signal
			)
		).resolves.toEqual(Uint8Array.of(1, 2, 3));
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://example.test/runtime/bin/ldc2.wasm',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: controller.signal
			})
		);
	});

	it('preserves a pre-aborted reason without invoking fetch', async () => {
		const fetchImpl = vi.fn();
		const controller = new AbortController();
		const reason = new Error('stop before D asset fetch');
		controller.abort(reason);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl,
				undefined,
				undefined,
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				controller.signal
			)
		).rejects.toBe(reason);
		expect(fetchImpl).not.toHaveBeenCalled();
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

	it.each([
		['empty', ''],
		['negative', '-1'],
		['fractional', '1.5'],
		['exponential', '1e2'],
		['duplicate', '2, 2'],
		['unsafe', '9007199254740992']
	])('rejects and cancels a %s Content-Length declaration', async (_caseName, value) => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'Content-Length': value } }
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				async () => response
			)
		).rejects.toThrow(`D runtime asset ldc2.wasm has an invalid Content-Length: ${value}`);
		expect(cancelled).toBe(true);
	});

	it('rejects and cancels invalid Content-Length on gzip and manifest paths', async () => {
		let gzipCancelled = false;
		let manifestCancelled = false;
		const gzipResponse = new Response(
			new ReadableStream({
				cancel() {
					gzipCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '-1' } }
		);
		const manifestResponse = new Response(
			new ReadableStream({
				cancel() {
					manifestCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '1e2' } }
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				async () => gzipResponse,
				undefined,
				'gzip'
			)
		).rejects.toThrow('D runtime asset ldc2.wasm has an invalid Content-Length: -1');
		await expect(
			loadRuntimeManifest('https://example.test/runtime/', async () => manifestResponse)
		).rejects.toThrow(
			'D runtime asset wasm-d runtime manifest has an invalid Content-Length: 1e2'
		);
		expect(gzipCancelled).toBe(true);
		expect(manifestCancelled).toBe(true);
	});

	it('allows absent and zero Content-Length declarations', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/no-content-length.bin',
				'D runtime asset',
				async () => new Response(Uint8Array.of(1, 2))
			)
		).resolves.toEqual(Uint8Array.of(1, 2));
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/zero-content-length.bin',
				'D runtime asset',
				async () => new Response(null, { headers: { 'Content-Length': '0' } })
			)
		).resolves.toEqual(new Uint8Array());
	});

	it('uses a dedicated 4 MiB ceiling for runtime manifests', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull() {
							throw new Error('manifest body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{
						headers: {
							'Content-Length': String(DEFAULT_MAX_RUNTIME_MANIFEST_BYTES + 1)
						}
					}
				)
		);

		await expect(
			loadRuntimeManifest('https://example.test/runtime/', fetchImpl)
		).rejects.toThrow(
			`wasm-d runtime manifest download size exceeds the ${DEFAULT_MAX_RUNTIME_MANIFEST_BYTES} byte limit`
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

	it('cancels an active unknown-length download with the caller signal', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();
		const reason = new Error('stop D asset download');
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar',
			'D toolchain',
			fetchImpl,
			undefined,
			undefined,
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
	});

	it('cancels an active gzip decompression chain with the caller signal', async () => {
		const compressed = gzipSync(new Uint8Array(1024), { level: 9 });
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(compressed);
				},
				cancel() {
					cancelled = true;
				}
			})
		);
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();
		const reason = new Error('stop D asset decompression');
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar.gz',
			'D toolchain',
			fetchImpl,
			undefined,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		await vi.waitFor(() => expect(cancelled).toBe(true));
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
