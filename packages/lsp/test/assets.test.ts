import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLanguageToolAsset } from '../src/assets.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('language tool asset loading', () => {
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
});
