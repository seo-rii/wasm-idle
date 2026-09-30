import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPersistentPythonLspAssets } from '../src/python/persistent-fetch.js';
const state = vi.hoisted(() => ({
	load: vi.fn(async () => new Uint8Array([0, 97, 115, 109])),
	receipt: { bytes: 4, sha256: 'a'.repeat(64), mediaType: 'application/wasm' }
}));
vi.mock('../src/external-asset.js', () => ({ fetchBoundedExternalAsset: state.load }));
vi.mock('../src/persistent-assets.js', () => ({
	resolveLanguageToolPersistentReceipt: (url: string) =>
		url.startsWith('https://assets.example/repl/pyodide/') ? state.receipt : undefined
}));
afterEach(() => {
	state.load.mockClear();
	vi.unstubAllGlobals();
});
describe('Python LSP persistent fetch routing', () => {
	it('routes pinned bootstrap requests to bounded cache-aware loading and restores fetch', async () => {
		const native = vi.fn();
		vi.stubGlobal('fetch', native);
		await withPersistentPythonLspAssets(
			{ assetRoot: 'https://assets.example/repl', persistentCache: { maxBytes: 1024 } },
			async () => {
				const response = await fetch(
					'https://assets.example/repl/pyodide/pyodide.asm.wasm'
				);
				expect(response.headers.get('content-type')).toBe('application/wasm');
				expect(new Uint8Array(await response.arrayBuffer())).toEqual(
					new Uint8Array([0, 97, 115, 109])
				);
			}
		);
		expect(state.load).toHaveBeenCalledWith(
			expect.objectContaining({
				integrity: state.receipt,
				persistentCache: { maxBytes: 1024 }
			})
		);
		expect(native).not.toHaveBeenCalled();
		expect(globalThis.fetch).toBe(native);
	});
	it('does not intercept custom requests or urls without release receipts', async () => {
		const native = vi.fn(async () => new Response('network'));
		vi.stubGlobal('fetch', native);
		await withPersistentPythonLspAssets(
			{ assetRoot: 'https://assets.example/repl' },
			async () => {
				await fetch('https://third-party.example/pkg.whl');
				await fetch('https://assets.example/repl/pyodide/pyodide.asm.wasm', {
					headers: { Range: 'bytes=0-4' }
				});
			}
		);
		expect(state.load).not.toHaveBeenCalled();
		expect(native).toHaveBeenCalledTimes(2);
	});

	it('preserves customized package locks and package bodies even when a stock receipt is inferred', async () => {
		const native = vi.fn(async () => new Response('custom deployment package content'));
		vi.stubGlobal('fetch', native);
		await withPersistentPythonLspAssets(
			{ assetRoot: 'https://assets.example/repl' },
			async () => {
				for (const asset of ['pyodide-lock.json', 'jedi-custom.whl']) {
					const response = await fetch(`https://assets.example/repl/pyodide/${asset}`);
					expect(await response.text()).toBe('custom deployment package content');
				}
			}
		);
		expect(native).toHaveBeenCalledTimes(2);
		expect(state.load).not.toHaveBeenCalled();
	});
	it('leaves disabled calls on their original loader and restores after initialization failure', async () => {
		const native = vi.fn();
		vi.stubGlobal('fetch', native);
		await withPersistentPythonLspAssets(
			{ assetRoot: 'https://assets.example/repl', persistentCache: false },
			async () => expect(globalThis.fetch).toBe(native)
		);
		await expect(
			withPersistentPythonLspAssets(
				{ assetRoot: 'https://assets.example/repl' },
				async () => {
					throw new Error('startup failure');
				}
			)
		).rejects.toThrow('startup failure');
		expect(globalThis.fetch).toBe(native);
	});
});
