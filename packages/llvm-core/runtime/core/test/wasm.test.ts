import { zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compile, decompressGzip, getInstance, readBuffer } from '../src/wasm.js';

const emptyWasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);

async function zipBytes(filename: string, contents: Uint8Array, level: 0 | 6 = 6) {
	return zipSync({ [filename]: contents }, { level });
}

describe('WebAssembly loading utilities', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rejects package-relative and file runtime assets', async () => {
		await expect(readBuffer('runtime.zip')).rejects.toThrow(
			/Runtime asset URL must be absolute/u
		);
		await expect(readBuffer('file:///tmp/runtime.zip')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
		await expect(readBuffer('data:application/zip;base64,AA==')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
		await expect(compile('toString')).rejects.toThrow(/Runtime asset URL must be absolute/u);
		await expect(compile('constructor')).rejects.toThrow(/Runtime asset URL must be absolute/u);
	});

	it('extracts the first file from a zip response and reports completion', async () => {
		const progress = { set: vi.fn() };
		const archive = await zipBytes('fixture.bin', Uint8Array.of(1, 2, 3, 4));
		const url = 'https://cdn.test/llvm/fixture.bin.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);

		await expect(readBuffer(url, progress)).resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
		expect(progress.set).toHaveBeenLastCalledWith(1);
	});

	it('reads chunked stored ZIP responses and skips directory entries', async () => {
		const archive = zipSync(
			{
				'fixture/': new Uint8Array(),
				'fixture/data.bin': Uint8Array.of(5, 6, 7, 8)
			},
			{ level: 0 }
		);
		const url = 'https://cdn.test/llvm/chunked-stored.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								for (let offset = 0; offset < archive.byteLength; offset += 7) {
									controller.enqueue(archive.slice(offset, offset + 7));
								}
								controller.close();
							}
						}),
						{ headers: { 'Content-Length': String(archive.byteLength) } }
					)
			)
		);

		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(5, 6, 7, 8));
	});

	it('uses native gzip decompression for wasm.gz and tar.gz assets', async () => {
		const progress = { set: vi.fn() };
		const contents = Uint8Array.of(21, 22, 23, 24);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/fixture.wasm.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(compressed, {
						headers: { 'Content-Length': String(compressed.byteLength) }
					})
			)
		);

		await expect(readBuffer(url, progress)).resolves.toEqual(contents);
		expect(progress.set).toHaveBeenLastCalledWith(1);
	});

	it('bounds decompressed gzip output before materializing the full asset', async () => {
		const contents = Uint8Array.of(1, 2, 3, 4, 5);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });

		await expect(decompressGzip(compressed, 'fixture.wasm.gz', 4)).rejects.toThrow(
			'Runtime asset fixture.wasm.gz decompressed size exceeds the 4 byte limit'
		);
		await expect(decompressGzip(contents, 'decoded.wasm', 4)).rejects.toThrow(
			'Runtime asset decoded.wasm decompressed size exceeds the 4 byte limit'
		);
	});

	it('rejects an oversized gzip transfer before starting decompression', async () => {
		const contents = gzipSync(Uint8Array.of(1, 2, 3), { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/gzip-download-limit.wasm.gz';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(contents);
							},
							cancel() {
								cancelled = true;
							}
						}),
						{ headers: { 'Content-Length': String(contents.byteLength) } }
					)
			)
		);

		await expect(readBuffer(url, undefined, contents.byteLength - 1)).rejects.toThrow(
			`Runtime asset ${url} download size exceeds the ${contents.byteLength - 1} byte limit`
		);
		expect(cancelled).toBe(true);
	});

	it('connects gzip network chunks to the native decompression stream before download completion', async () => {
		const contents = Uint8Array.from({ length: 16_384 }, (_, index) => index % 251);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });
		const nativeDecompressionStream = globalThis.DecompressionStream;
		let offset = 0;
		let pulls = 0;
		let pullsAtDecompression = -1;
		vi.stubGlobal(
			'DecompressionStream',
			function TrackingDecompressionStream(format: CompressionFormat) {
				pullsAtDecompression = pulls;
				return new nativeDecompressionStream(format);
			}
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							pull(controller) {
								if (offset >= compressed.byteLength) {
									controller.close();
									return;
								}
								controller.enqueue(compressed.subarray(offset, ++offset));
								pulls += 1;
							}
						}),
						{ headers: { 'Content-Length': String(compressed.byteLength) } }
					)
			)
		);

		await expect(readBuffer('https://cdn.test/llvm/streamed-runtime.tar.gz')).resolves.toEqual(
			contents
		);
		expect(pullsAtDecompression).toBeGreaterThanOrEqual(2);
		expect(pullsAtDecompression).toBeLessThan(compressed.byteLength);
	});

	it('accepts gzip URLs already decoded by HTTP content encoding', async () => {
		const contents = Uint8Array.of(31, 32, 33);
		const url = 'https://cdn.test/llvm/already-decoded.tar.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(contents))
		);

		await expect(readBuffer(url)).resolves.toEqual(contents);
	});

	it('reports when native gzip decompression is unavailable', async () => {
		const compressed = gzipSync(Uint8Array.of(41, 42), { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/no-decompression-stream.wasm.gz';
		vi.stubGlobal('DecompressionStream', undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(compressed))
		);

		await expect(readBuffer(url)).rejects.toThrow(
			/DecompressionStream\('gzip'\) is unavailable/u
		);
	});

	it('extracts ZIP data when the response does not expose a body stream', async () => {
		const archive = await zipBytes('fixture.bin', Uint8Array.of(9, 10, 11));
		const url = 'https://cdn.test/llvm/no-body.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers({ 'Content-Length': String(archive.byteLength) }),
				body: null,
				arrayBuffer: async () => archive.slice().buffer
			}))
		);

		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(9, 10, 11));
	});

	it('rejects an oversized Content-Length before reading the response body', async () => {
		const url = 'https://cdn.test/llvm/content-length-limit.bin';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
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
						{ headers: { 'Content-Length': '6' } }
					)
			)
		);

		await expect(readBuffer(url, undefined, 5)).rejects.toThrow(
			'Runtime asset https://cdn.test/llvm/content-length-limit.bin size exceeds the 5 byte limit'
		);
		expect(cancelled).toBe(true);
	});

	it('cancels an unknown-length stream as soon as it crosses the byte limit', async () => {
		const url = 'https://cdn.test/llvm/stream-limit.bin';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
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
			)
		);

		await expect(readBuffer(url, undefined, 5)).rejects.toThrow(
			'Runtime asset https://cdn.test/llvm/stream-limit.bin size exceeds the 5 byte limit'
		);
		expect(cancelled).toBe(true);
	});

	it('does not reuse a cached asset across different byte limits', async () => {
		const url = 'https://cdn.test/llvm/cache-limit.bin';
		const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3)));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url, undefined, 3)).resolves.toEqual(Uint8Array.of(1, 2, 3));
		await expect(readBuffer(url, undefined, 2)).rejects.toThrow(
			`Runtime asset ${url} size exceeds the 2 byte limit`
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rejects a ZIP entry from its declared original size before extraction', async () => {
		const expanded = new Uint8Array(4096);
		const archive = zipSync({ 'expanded.bin': expanded }, { level: 6 });
		const limit = archive.byteLength + 16;
		expect(limit).toBeLessThan(expanded.byteLength);
		const url = 'https://cdn.test/llvm/zip-output-limit.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);

		await expect(readBuffer(url, undefined, limit)).rejects.toThrow(
			`Runtime asset ${url} extracted size exceeds the ${limit} byte limit`
		);
	});

	it('omits credentials and referrer metadata from runtime asset fetches', async () => {
		const url = 'https://cdn.test/llvm/request-policy.bin';
		const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1)));
		vi.stubGlobal('fetch', fetchMock);

		await readBuffer(url);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' })
		);
	});

	it('evicts malformed archives from the cache so the same URL can be retried', async () => {
		const archive = await zipBytes('fixture.bin', Uint8Array.of(12, 13));
		const url = 'https://cdn.test/llvm/retry.zip';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3)))
			.mockResolvedValueOnce(new Response(archive));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url)).rejects.toThrow();
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(12, 13));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('deduplicates concurrent compilation without prototype-key cache hits', async () => {
		const url = 'https://cdn.test/llvm/concurrent.wasm';
		const compileSpy = vi.spyOn(WebAssembly, 'compile');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(emptyWasm))
		);

		const [first, second] = await Promise.all([compile(url), compile(url)]);

		expect(first).toBe(second);
		expect(compileSpy).toHaveBeenCalledTimes(1);
		compileSpy.mockRestore();
	});

	it('compiles zipped wasm and instantiates the resulting module', async () => {
		const archive = await zipBytes('fixture.wasm', emptyWasm);
		const url = 'https://cdn.test/llvm/fixture.wasm.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);
		const module = await compile(url);
		const instance = await getInstance(module, {});

		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(instance).toBeInstanceOf(WebAssembly.Instance);
	});
});
