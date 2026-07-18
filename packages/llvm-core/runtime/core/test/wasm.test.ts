import { zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compile, getInstance, readBuffer } from '../src/wasm.js';

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

	it('streams chunked stored ZIP responses and skips directory entries', async () => {
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
