import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLanguageToolAsset } from '../src/assets.js';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('language tool asset loading', () => {
	it('rejects assets outside the clangd runtime allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'../../private',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected clangd runtime asset: ../../private');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a clangd asset whose configured SHA-256 digest does not match', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-type' ? 'text/javascript; charset=utf-8' : null
					)
				},
				body: null,
				arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					integrity: {
						'clangd.js': {
							bytes: 3,
							sha256: '0'.repeat(64),
							mediaType: 'text/javascript'
						}
					}
				},
				vi.fn()
			)
		).rejects.toThrow(
			'Runtime asset clangd.js SHA-256 mismatch: expected ' +
				'0'.repeat(64) +
				', received 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
		);
	});

	it('assembles a stream in bounded storage when Content-Length is inaccurate', async () => {
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5, 6]) })
				.mockResolvedValueOnce({ done: true, value: undefined })
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-length' ? '4' : 'application/wasm'
					)
				},
				body: { getReader: () => reader }
			})
		);
		const copySpy = vi.spyOn(Uint8Array, 'from');

		const loaded = await loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{ baseUrl: 'https://assets.example.com/clangd/' },
			vi.fn()
		);

		expect(copySpy).not.toHaveBeenCalled();
		expect([...loaded.bytes]).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('rejects an oversized response before reading its body', async () => {
		const read = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-length' ? String(128 * 1024 * 1024 + 1) : null
					)
				},
				body: { getReader: () => ({ read }) }
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.wasm.gz',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Runtime asset clangd.wasm.gz exceeds the 134217728 byte limit');
		expect(read).not.toHaveBeenCalled();
	});

	it('cancels a streamed response that crosses the asset limit', async () => {
		const cancel = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: { get: vi.fn(() => null) },
				body: {
					getReader: () => ({
						read: vi.fn().mockResolvedValueOnce({
							done: false,
							value: { byteLength: 128 * 1024 * 1024 + 1 } as Uint8Array
						}),
						cancel
					})
				}
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.wasm.gz',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Runtime asset clangd.wasm.gz exceeds the 134217728 byte limit');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects redirects outside the configured asset bases and omits credentials', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			url: 'https://evil.example.com/clangd/clangd.js',
			headers: { get: vi.fn(() => null) },
			body: null,
			arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow(
			'Runtime asset clangd.js URL is outside the allowed asset bases: https://evil.example.com/clangd/clangd.js'
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://assets.example.com/clangd/clangd.js',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			})
		);
	});

	it('aborts a loader that exceeds its configured timeout', async () => {
		vi.useFakeTimers();
		let loaderSignal: AbortSignal | undefined;
		const loading = loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{
				baseUrl: 'https://assets.example.com/clangd/',
				loader: ({ signal }) => {
					loaderSignal = signal;
					return new Promise(() => {});
				}
			},
			vi.fn(),
			{ timeoutMs: 25 }
		);
		const rejection = expect(loading).rejects.toThrow(
			'Timed out loading runtime asset clangd.js after 25 ms'
		);

		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(loaderSignal?.aborted).toBe(true);
	});

	it('honors a caller cancellation before invoking a custom loader', async () => {
		const controller = new AbortController();
		const loader = vi.fn();
		controller.abort(new Error('asset load cancelled'));

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					loader
				},
				vi.fn(),
				{ signal: controller.signal }
			)
		).rejects.toThrow('asset load cancelled');
		expect(loader).not.toHaveBeenCalled();
	});
});
