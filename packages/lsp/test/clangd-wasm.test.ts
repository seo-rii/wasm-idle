import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { prepareClangdWasm } from '../src/clangd/wasm.js';

const bytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const gzip = Uint8Array.from(gzipSync(bytes));
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const receipt = {
	bytes: gzip.length,
	sha256: digest(gzip),
	uncompressedBytes: bytes.length,
	uncompressedSha256: digest(bytes)
};
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('clangd verified Wasm preparation', () => {
	it('accepts compressed-only object receipts and hashes the actual Wasm for Module reuse', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const loader = vi.fn(() => gzip);
		const compile = vi.spyOn(WebAssembly, 'compile');
		const config = {
			baseUrl: 'https://assets.example/compressed-only/',
			loader,
			integrity: { 'clangd.wasm.gz': { bytes: gzip.length, sha256: digest(gzip) } },
			persistentCache: false as const
		};
		const first = await prepareClangdWasm(config, vi.fn());
		const second = await prepareClangdWasm(config, vi.fn());
		expect(second.module).toBe(first.module);
		expect(first.sha256).toBe(digest(bytes));
		expect(loader).toHaveBeenCalledTimes(2);
		expect(compile).toHaveBeenCalledTimes(1);
	});
	it.each([{ uncompressedBytes: bytes.length }, { uncompressedSha256: digest(bytes) }])(
		'rejects partial logical receipts: %s',
		async (logical) => {
			vi.stubGlobal('crypto', webcrypto);
			await expect(
				prepareClangdWasm(
					{
						baseUrl: 'https://assets.example/partial-logical/',
						loader: () => gzip,
						integrity: {
							'clangd.wasm.gz': {
								bytes: gzip.length,
								sha256: digest(gzip),
								...logical
							}
						},
						persistentCache: false
					},
					vi.fn()
				)
			).rejects.toThrow('missing uncompressed integrity metadata');
		}
	);
	it('requires Web Crypto when a custom asset requests integrity verification', async () => {
		vi.stubGlobal('crypto', undefined);
		const compile = vi.spyOn(WebAssembly, 'compile');
		await expect(
			prepareClangdWasm(
				{
					baseUrl: 'https://assets.example/crypto-required/',
					loader: () => gzip,
					integrity: { 'clangd.wasm.gz': receipt },
					persistentCache: false
				},
				vi.fn()
			)
		).rejects.toThrow('Web Crypto SHA-256 is unavailable');
		expect(compile).not.toHaveBeenCalled();
	});

	it('streams a verified native gzip asset and reuses the compiled Module', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const fetch = vi.fn(async () => new Response(gzip));
		vi.stubGlobal('fetch', fetch);
		const config = {
			baseUrl: 'https://assets.example/streaming/',
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		const first = await prepareClangdWasm(config, vi.fn());
		const second = await prepareClangdWasm(config, vi.fn());
		expect(first.module).toBeInstanceOf(WebAssembly.Module);
		expect(second.module).toBe(first.module);
		expect(first.sha256).toBe(digest(bytes));
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('does not let corruption seed the module cache and retries successfully', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(Uint8Array.of(0x1f, 0x8b, 0)))
			.mockResolvedValueOnce(new Response(gzip));
		vi.stubGlobal('fetch', fetch);
		const config = {
			baseUrl: 'https://assets.example/retry/',
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		await expect(prepareClangdWasm(config, vi.fn())).rejects.toThrow();
		expect((await prepareClangdWasm(config, vi.fn())).module).toBeInstanceOf(
			WebAssembly.Module
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('honors custom loaders and reuses only the actual compatible compiler bytes', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const loader = vi.fn(() => gzip);
		const config = {
			baseUrl: 'https://assets.example/custom/',
			loader,
			persistentCache: false as const
		};
		const first = await prepareClangdWasm(config, vi.fn());
		const second = await prepareClangdWasm(config, vi.fn());
		expect(loader).toHaveBeenCalledTimes(2);
		expect(second.module).toBe(first.module);
		loader.mockReturnValue(Uint8Array.of(0x1f, 0x8b, 0));
		await expect(prepareClangdWasm(config, vi.fn())).rejects.toThrow();
	});
	it('keeps stricter response URL policies separate from completed modules', async () => {
		vi.stubGlobal('crypto', webcrypto);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(gzip))
		);
		const config = {
			baseUrl: 'https://assets.example/policy/',
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		await prepareClangdWasm(config, vi.fn());
		await expect(
			prepareClangdWasm({ ...config, requireExactResponseUrl: true }, vi.fn())
		).rejects.toThrow('unexpected final URL');
	});
	it('admits allowed redirects while forwarding custom HTTP policies and enforcing integrity', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			const response = new Response(gzip);
			Object.defineProperty(response, 'url', {
				value: 'https://mirror.example/clangd/clangd.wasm.gz'
			});
			return response;
		});
		vi.stubGlobal('fetch', fetch);
		const config = {
			baseUrl: 'https://assets.example/redirect/',
			allowedBaseUrls: ['https://mirror.example/clangd/'],
			cache: 'no-store' as const,
			redirect: 'follow' as const,
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		expect((await prepareClangdWasm(config, vi.fn())).module).toBeInstanceOf(
			WebAssembly.Module
		);
		expect(fetch.mock.calls[0][1]).toMatchObject({
			cache: 'no-store',
			redirect: 'follow',
			credentials: 'omit'
		});
		await expect(
			prepareClangdWasm({ ...config, requireExactResponseUrl: true }, vi.fn())
		).rejects.toThrow('unexpected final URL');
	});
	it('rejects an unallowed final URL before compiling and permits a retry', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const cancel = vi.fn();
		const rejected = new Response(new ReadableStream({ cancel }));
		Object.defineProperty(rejected, 'url', {
			value: 'https://outside.example/compiler.wasm.gz'
		});
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(rejected)
			.mockResolvedValueOnce(new Response(gzip));
		vi.stubGlobal('fetch', fetch);
		const compile = vi.spyOn(WebAssembly, 'compileStreaming');
		const config = {
			baseUrl: 'https://assets.example/redirect-retry/',
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		await expect(prepareClangdWasm(config, vi.fn())).rejects.toThrow(
			'outside the allowed asset bases'
		);
		expect(compile).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalled();
		expect((await prepareClangdWasm(config, vi.fn())).module).toBeInstanceOf(
			WebAssembly.Module
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('cancels streaming compilation after it starts and retries without caching the aborted operation', async () => {
		vi.stubGlobal('crypto', webcrypto);
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			start(out) {
				out.enqueue(bytes);
			},
			cancel
		});
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(stream))
			.mockResolvedValueOnce(new Response(gzip));
		vi.stubGlobal('fetch', fetch);
		const compile = vi.spyOn(WebAssembly, 'compileStreaming');
		const controller = new AbortController();
		const config = {
			baseUrl: 'https://assets.example/cancel-streaming/',
			integrity: { 'clangd.wasm.gz': receipt },
			persistentCache: false as const
		};
		const pending = prepareClangdWasm(config, vi.fn(), { signal: controller.signal });
		const rejected = expect(pending).rejects.toThrow('stop streaming clangd');
		await vi.waitFor(() => expect(compile).toHaveBeenCalled());
		controller.abort(new Error('stop streaming clangd'));
		await rejected;
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
		expect((await prepareClangdWasm(config, vi.fn())).module).toBeInstanceOf(
			WebAssembly.Module
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
