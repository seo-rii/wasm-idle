import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentModuleAssetFetch } from '../src/module-asset-fetch.js';

const state = vi.hoisted(() => ({
	load: vi.fn(async (_options: any) => new Uint8Array([0, 97, 115, 109])),
	lookup: vi.fn(async (url: string, _options: unknown) =>
		url === 'https://app.example/wasm-go/runtime/tools/compile.wasm.gz'
			? {
					sha256: 'a'.repeat(64),
					bytes: 4,
					uncompressedSha256: 'b'.repeat(64),
					uncompressedBytes: 9
				}
			: undefined
	)
}));
vi.mock('../src/external-asset.js', () => ({ fetchBoundedExternalAsset: state.load }));
vi.mock('../src/persistent-assets.js', () => ({
	resolveLanguageToolPersistentOptions: () => ({}),
	resolveLanguageToolPersistentReceipt: state.lookup
}));

const options = { assetRoot: 'https://app.example/', persistentCache: { maxBytes: 1024 } };
const moduleUrl = 'https://app.example/wasm-go/index.js?v=7';
const tool = 'https://app.example/wasm-go/runtime/tools/compile.wasm.gz';

afterEach(() => {
	state.load.mockClear();
	state.lookup.mockClear();
});

describe('persistent module asset fetch', () => {
	it('serves a pinned file under the module directory through the persistent cache', async () => {
		const network = vi.fn(async () => new Response('network'));
		const fetch = createPersistentModuleAssetFetch(moduleUrl, network, options);
		const response = await fetch(`${tool}?v=7`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 97, 115, 109])
		);
		expect(response.headers.get('content-length')).toBe('4');
		// The lock describes the file without its version query; the cache keys the full URL.
		expect(state.lookup).toHaveBeenCalledWith(tool, options, undefined, undefined);
		expect(state.load).toHaveBeenCalledWith(
			expect.objectContaining({
				url: `${tool}?v=7`,
				integrity: expect.objectContaining({ sha256: 'a'.repeat(64) }),
				// A decoded .gz body is larger than the stored file.
				maxBytes: 9,
				persistentCache: options.persistentCache,
				fetch: network
			})
		);
		expect(network).not.toHaveBeenCalled();
	});

	it('passes other requests to the network unchanged', async () => {
		const network = vi.fn(async () => new Response('network'));
		const fetch = createPersistentModuleAssetFetch(moduleUrl, network, options);
		await fetch('https://app.example/other/compile.wasm.gz');
		await fetch(`${tool}?v=7&x=1`);
		await fetch(tool, { headers: { range: 'bytes=0-1' } });
		await fetch(tool, { method: 'HEAD' });
		await fetch('https://app.example/wasm-go/runtime/unpinned.json');
		expect(state.load).not.toHaveBeenCalled();
		expect(network).toHaveBeenCalledTimes(5);
	});

	it('falls back to the network when the bytes differ from the lock', async () => {
		state.load.mockRejectedValueOnce(new Error('SHA-256 mismatch'));
		const network = vi.fn(async () => new Response('rebuilt'));
		const fetch = createPersistentModuleAssetFetch(moduleUrl, network, options);
		expect(await (await fetch(tool)).text()).toBe('rebuilt');
		const aborted = new AbortController();
		aborted.abort(new DOMException('stop', 'AbortError'));
		state.load.mockRejectedValueOnce(new DOMException('stop', 'AbortError'));
		await expect(fetch(tool, { signal: aborted.signal })).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(network).toHaveBeenCalledOnce();
	});

	it('is the plain network fetch without a lock root or with caching disabled', () => {
		const network = vi.fn();
		expect(createPersistentModuleAssetFetch(moduleUrl, network, {})).toBe(network);
		expect(
			createPersistentModuleAssetFetch(moduleUrl, network, {
				...options,
				persistentCache: { enabled: false }
			})
		).toBe(network);
		expect(createPersistentModuleAssetFetch('data:text/javascript,', network, options)).toBe(
			network
		);
	});
});
