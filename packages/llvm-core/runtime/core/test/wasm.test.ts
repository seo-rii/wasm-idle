import { zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compile, decompressGzip, fetchRuntimeJson, getInstance, readBuffer } from '../src/wasm.js';

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
		await expect(readBuffer('https://cdn.test/runtime.wasm#latest')).rejects.toThrow(
			/Runtime asset URLs must not include fragments/u
		);
		await expect(compile('toString')).rejects.toThrow(/Runtime asset URL must be absolute/u);
		await expect(compile('constructor')).rejects.toThrow(/Runtime asset URL must be absolute/u);
	});

	it('rejects credential-bearing runtime asset URLs before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const expectedError = 'Runtime asset URLs must not include credentials';

		await expect(readBuffer('https://user@cdn.test/runtime.bin')).rejects.toThrow(
			expectedError
		);
		await expect(readBuffer('https://user:secret@cdn.test/runtime.wasm.gz')).rejects.toThrow(
			expectedError
		);
		await expect(readBuffer('https://:secret@cdn.test/runtime.zip')).rejects.toThrow(
			expectedError
		);
		await expect(compile('https://user:secret@cdn.test/runtime.wasm')).rejects.toThrow(
			expectedError
		);
		await expect(
			fetchRuntimeJson('https://user:secret@cdn.test/manifest.json')
		).rejects.toThrow(expectedError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('preserves pre-abort reasons without fetching or caching assets', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop before asset fetch');
		controller.abort(reason);

		await expect(
			readBuffer(
				'https://cdn.test/llvm/pre-aborted-runtime.zip',
				undefined,
				undefined,
				controller.signal
			)
		).rejects.toBe(reason);
		await expect(
			compile('https://cdn.test/llvm/pre-aborted-runtime.wasm', undefined, controller.signal)
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('normalizes a fetch abort back to the caller-provided reason', async () => {
		const url = 'https://cdn.test/llvm/cancelled-fetch.bin';
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('fetch aborted', 'AbortError')),
						{ once: true }
					);
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop pending fetch');
		const pending = readBuffer(url, undefined, undefined, controller.signal);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

	it('cancels active raw asset readers without poisoning a later retry', async () => {
		const url = 'https://cdn.test/llvm/cancelled-runtime.bin';
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			}
		});
		const getReaderSpy = vi.spyOn(body, 'getReader');
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(body))
			.mockResolvedValueOnce(new Response(Uint8Array.of(7, 8, 9)));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop raw asset load');
		const pending = readBuffer(url, undefined, undefined, controller.signal);

		await vi.waitFor(() => expect(getReaderSpy).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			new URL(url),
			expect.objectContaining({ signal: controller.signal })
		);
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(7, 8, 9));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('cancels active gzip readers and preserves the caller reason', async () => {
		const url = 'https://cdn.test/llvm/cancelled-runtime.wasm.gz';
		const compressed = gzipSync(Uint8Array.of(1, 2, 3, 4), { level: 9, mtime: 0 });
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(streamController) {
				streamController.enqueue(compressed.subarray(0, compressed.byteLength - 2));
			},
			cancel() {
				cancelled = true;
			}
		});
		const getReaderSpy = vi.spyOn(body, 'getReader');
		const fetchMock = vi.fn(async () => new Response(body));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop gzip asset load');
		const pending = readBuffer(url, undefined, undefined, controller.signal);

		await vi.waitFor(() => expect(getReaderSpy).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it('observes cancellation before extracting a downloaded ZIP', async () => {
		const url = 'https://cdn.test/llvm/cancelled-runtime.zip';
		const archive = await zipBytes('fixture.bin', Uint8Array.of(1, 2, 3));
		const controller = new AbortController();
		const reason = new Error('stop before ZIP extraction');
		const fetchMock = vi.fn(
			async () =>
				new Response(archive, {
					headers: { 'Content-Length': String(archive.byteLength) }
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			readBuffer(
				url,
				{
					set(value) {
						if (value > 0) controller.abort(reason);
					}
				},
				undefined,
				controller.signal
			)
		).rejects.toBe(reason);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it('keeps aborted compilation outside the shared module cache', async () => {
		const url = 'https://cdn.test/llvm/cancelled-compilation.wasm';
		const module = new WebAssembly.Module(emptyWasm);
		let compilationStarted!: () => void;
		let finishCompilation!: () => void;
		const started = new Promise<void>((resolve) => {
			compilationStarted = resolve;
		});
		const finish = new Promise<void>((resolve) => {
			finishCompilation = resolve;
		});
		const compileSpy = vi
			.spyOn(WebAssembly, 'compile')
			.mockImplementationOnce(async () => {
				compilationStarted();
				await finish;
				return module;
			})
			.mockResolvedValueOnce(module);
		const fetchMock = vi.fn(async () => new Response(emptyWasm));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop WebAssembly compilation');

		try {
			const pending = compile(url, undefined, controller.signal);
			await started;
			controller.abort(reason);
			finishCompilation();

			await expect(pending).rejects.toBe(reason);
			await expect(compile(url)).resolves.toBe(module);
			expect(compileSpy).toHaveBeenCalledTimes(2);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			compileSpy.mockRestore();
		}
	});

	it('loads bounded runtime JSON with least-authority request options', async () => {
		const url = 'https://cdn.test/llvm/runtime-manifest.v1.json';
		const body = new TextEncoder().encode(JSON.stringify({ manifestVersion: 1 }));
		const response = new Response(body, {
			headers: { 'Content-Length': String(body.byteLength) }
		});
		Object.defineProperty(response, 'url', { value: url });
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();

		await expect(
			fetchRuntimeJson(url, {
				fetchImpl,
				label: 'fixture runtime manifest',
				maxBytes: body.byteLength,
				signal: controller.signal
			})
		).resolves.toEqual({ manifestVersion: 1 });
		expect(fetchImpl).toHaveBeenCalledWith(url, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		});
	});

	it('cancels runtime JSON bodies that exceed declared or streamed limits', async () => {
		const declaredUrl = 'https://cdn.test/llvm/declared-manifest.json';
		let declaredCancelled = false;
		const declaredResponse = new Response(
			new ReadableStream({
				pull() {
					throw new Error('body should not be read');
				},
				cancel() {
					declaredCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '6' } }
		);
		await expect(
			fetchRuntimeJson(declaredUrl, {
				fetchImpl: async () => declaredResponse,
				maxBytes: 5
			})
		).rejects.toThrow(`Runtime asset ${declaredUrl} size exceeds the 5 byte limit`);
		expect(declaredCancelled).toBe(true);

		const streamedUrl = 'https://cdn.test/llvm/streamed-manifest.json';
		let streamedCancelled = false;
		const streamedResponse = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(Uint8Array.of(1, 2, 3));
					controller.enqueue(Uint8Array.of(4, 5, 6));
				},
				cancel() {
					streamedCancelled = true;
				}
			})
		);
		await expect(
			fetchRuntimeJson(streamedUrl, {
				fetchImpl: async () => streamedResponse,
				maxBytes: 5
			})
		).rejects.toThrow(`Runtime asset ${streamedUrl} size exceeds the 5 byte limit`);
		expect(streamedCancelled).toBe(true);
	});

	it('cancels an active runtime JSON reader with the caller signal', async () => {
		const url = 'https://cdn.test/llvm/cancelled-manifest.json';
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
		const reason = new Error('stop manifest load');
		const pending = fetchRuntimeJson(url, {
			fetchImpl,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
	});

	it('rejects substituted, invalid UTF-8, and malformed runtime JSON', async () => {
		const url = 'https://cdn.test/llvm/runtime-manifest.json';
		let substitutedCancelled = false;
		const substituted = new Response(
			new ReadableStream({
				cancel() {
					substitutedCancelled = true;
				}
			})
		);
		Object.defineProperty(substituted, 'url', {
			value: 'https://mirror.test/llvm/runtime-manifest.json'
		});
		await expect(fetchRuntimeJson(url, { fetchImpl: async () => substituted })).rejects.toThrow(
			/returned an unexpected final URL/u
		);
		expect(substitutedCancelled).toBe(true);

		await expect(
			fetchRuntimeJson(url, {
				fetchImpl: async () => new Response(Uint8Array.of(0xc3, 0x28)),
				label: 'fixture manifest'
			})
		).rejects.toThrow('fixture manifest is not valid UTF-8');
		await expect(
			fetchRuntimeJson(url, {
				fetchImpl: async () => new Response('{'),
				label: 'fixture manifest'
			})
		).rejects.toThrow('fixture manifest is not valid JSON');
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
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
	});

	it('rejects a response whose final URL differs from the declared asset URL', async () => {
		const url = 'https://cdn.test/llvm/exact-url.bin';
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', {
			value: 'https://mirror.test/llvm/exact-url.bin'
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response)
		);

		await expect(readBuffer(url)).rejects.toThrow(
			`Runtime asset ${url} returned an unexpected final URL: https://mirror.test/llvm/exact-url.bin`
		);
		expect(cancelled).toBe(true);
	});

	it('cancels failed response bodies before allowing the asset to be retried', async () => {
		const url = 'https://cdn.test/llvm/failed-response.bin';
		let cancelled = false;
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						}
					}),
					{ status: 503 }
				)
			)
			.mockResolvedValueOnce(new Response(Uint8Array.of(7, 8, 9)));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url)).rejects.toThrow(`Failed to load runtime asset ${url}: 503`);
		expect(cancelled).toBe(true);
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(7, 8, 9));
		expect(fetchMock).toHaveBeenCalledTimes(2);
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
