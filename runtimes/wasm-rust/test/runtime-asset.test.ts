import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_MAX_RUNTIME_ASSET_BYTES,
	fetchRuntimeAssetBytes,
	fetchRuntimeAssetJson
} from '../src/runtime-asset.js';

describe('runtime asset fetch fallback', () => {
	it('uses least-authority fetch options and accepts an exact final URL', async () => {
		const assetUrl = 'https://example.test/runtime/data.bin';
		const response = new Response(new Uint8Array([1, 2, 3]));
		Object.defineProperty(response, 'url', { value: assetUrl });
		const fetchImpl = vi.fn(async () => response);

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'data.bin', fetchImpl, false)
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
		expect(fetchImpl).toHaveBeenCalledWith(assetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
	});

	it.each([
		'data:application/wasm;base64,AGFzbQ==',
		'https://user:secret@example.test/runtime/data.bin',
		'https://example.test/runtime/data.bin#fragment'
	])('rejects an unsafe runtime asset URL before fetching: %s', async (assetUrl) => {
		const fetchImpl = vi.fn(async () => new Response(new Uint8Array()));

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'data.bin', fetchImpl, false)
		).rejects.toThrow(/runtime asset URL/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		['relative', 'data.bin', 'invalid final URL'],
		['malformed', 'http://[', 'invalid final URL'],
		['mismatched', 'https://mirror.test/runtime/data.bin', 'unexpected final URL']
	])('rejects and cancels a %s response URL', async (_caseName, responseUrl, message) => {
		let cancelled = false;
		let readerRequested = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', { value: responseUrl });
		Object.defineProperty(response.body, 'getReader', {
			value: () => {
				readerRequested = true;
				throw new Error('rejected response body should not be read');
			}
		});

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false
			)
		).rejects.toThrow(message);
		expect(readerRequested).toBe(false);
		expect(cancelled).toBe(true);
	});

	it.each(['', '-1', '1.5', '1e2', '3, 3', '9007199254740992'])(
		'rejects and cancels an invalid Content-Length: %s',
		async (contentLength) => {
			let cancelled = false;
			let readerRequested = false;
			const response = new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					}
				}),
				{ headers: { 'content-length': contentLength } }
			);
			Object.defineProperty(response.body, 'getReader', {
				value: () => {
					readerRequested = true;
					throw new Error('invalid-length response body should not be read');
				}
			});

			await expect(
				fetchRuntimeAssetBytes(
					'https://example.test/runtime/data.bin',
					'data.bin',
					async () => response,
					false
				)
			).rejects.toThrow(`invalid Content-Length: ${contentLength}`);
			expect(readerRequested).toBe(false);
			expect(cancelled).toBe(true);
		}
	);

	it('accepts a zero Content-Length declaration', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/empty.bin',
				'empty.bin',
				async () => new Response(null, { headers: { 'content-length': '0' } }),
				false
			)
		).resolves.toEqual(new Uint8Array());
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
		'rejects an invalid maxAssetBytes before fetching: %s',
		async (maxAssetBytes) => {
			const fetchImpl = vi.fn(async () => new Response(new Uint8Array()));

			await expect(
				fetchRuntimeAssetBytes(
					'https://example.test/runtime/data.bin',
					'data.bin',
					fetchImpl,
					false,
					undefined,
					{ maxAssetBytes }
				)
			).rejects.toThrow(/invalid maxAssetBytes/);
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	);

	it('rejects an oversized declaration before requesting a reader', async () => {
		let cancelled = false;
		let readerRequested = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'content-length': '5' } }
		);
		Object.defineProperty(response.body, 'getReader', {
			value: () => {
				readerRequested = true;
				throw new Error('oversized response body should not be read');
			}
		});

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
		expect(readerRequested).toBe(false);
		expect(cancelled).toBe(true);
	});

	it('cancels and releases an unknown-length stream that exceeds the byte limit', async () => {
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5]) })
				.mockResolvedValueOnce({ done: true, value: undefined }),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: () => reader }
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it('cancels and releases a stream after a read failure', async () => {
		const failure = new Error('stream failed');
		const reader = {
			read: vi.fn(async () => {
				throw failure;
			}),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: () => reader }
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toBe(failure);
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects an oversized bodyless response after materialization', async () => {
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: null,
			arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
	});

	it('bounds gzip expansion and accepts raw or expanded bytes exactly at the limit', async () => {
		const bombExpanded = new Uint8Array(100);
		const bombCompressed = gzipSync(bombExpanded);
		expect(bombCompressed.byteLength).toBeLessThan(32);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin.gz',
				'data.bin.gz',
				async () => new Response(bombCompressed),
				false,
				undefined,
				{ maxAssetBytes: 32 }
			)
		).rejects.toThrow(/decompressed size exceeds the 32 byte limit/);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => new Response(new Uint8Array([1, 2, 3, 4])),
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));

		const exactExpanded = new Uint8Array(32);
		const exactCompressed = gzipSync(exactExpanded);
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin.gz',
				'data.bin.gz',
				async () => new Response(exactCompressed),
				false,
				undefined,
				{ maxAssetBytes: exactExpanded.byteLength }
			)
		).resolves.toEqual(exactExpanded);
	});

	it('preserves a custom byte limit through gzip fallback and JSON loading', async () => {
		const fallbackUrl = 'https://example.test/runtime/data.bin';
		const expanded = new Uint8Array([1, 2, 3, 4, 5]);
		await expect(
			fetchRuntimeAssetBytes(
				fallbackUrl,
				'data.bin',
				async (input) =>
					String(input).endsWith('.gz')
						? new Response(gzipSync(expanded))
						: new Response(null, { status: 404 }),
				true,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/status 404/);

		await expect(
			fetchRuntimeAssetJson(
				'https://example.test/runtime/manifest.json',
				'manifest',
				async () => new Response('{"ok":true}'),
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
	});

	it('exports a safe default runtime asset byte limit', () => {
		expect(DEFAULT_MAX_RUNTIME_ASSET_BYTES).toBe(128 * 1024 * 1024);
	});

	it('cancels a failed response before trying the gzip fallback', async () => {
		const assetUrl = 'https://example.test/runtime/llvm/lld.wasm';
		let cancelled = false;
		let sent = false;
		const failedResponse = new Response(
			new ReadableStream({
				pull(controller) {
					if (sent) {
						controller.close();
						return;
					}
					sent = true;
					controller.enqueue(new TextEncoder().encode('missing'));
				},
				cancel() {
					cancelled = true;
				}
			}),
			{ status: 404 }
		);
		Object.defineProperty(failedResponse, 'url', { value: assetUrl });
		const gzipResponse = new Response(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
		Object.defineProperty(gzipResponse, 'url', { value: `${assetUrl}.gz` });

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'lld.wasm', async (input) => {
				return String(input).endsWith('.gz') ? gzipResponse : failedResponse;
			})
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
		expect(cancelled).toBe(true);
	});

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
