import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { configureRuntimeAssetCache, resolveRuntimeAssetCacheOptions } from '@wasm-idle/core';
import { loadLanguageToolAsset } from '../src/assets.js';
import { fetchBoundedExternalAsset } from '../src/external-asset.js';
import { configureWorkerLanguageToolPersistentAssets } from '../src/persistent-assets.js';
import { createWorkerLanguageServerClient } from '../src/worker-client.js';

const storage = vi.hoisted(() => ({
	values: new Map<string, Uint8Array>(),
	reads: vi.fn(),
	writes: vi.fn()
}));
vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: class {
		listen() {}
		dispose() {}
	},
	BrowserMessageWriter: class {
		write() {}
		dispose() {}
	}
}));
vi.mock('@wasm-idle/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@wasm-idle/core')>();
	const key = (request: any) =>
		JSON.stringify([
			request.identity.url,
			request.identity.sha256,
			request.identity.validationKey
		]);
	const read = async (request: any) => {
		storage.reads(request);
		if (!actual.resolveRuntimeAssetCacheOptions(request.cache).enabled) return undefined;
		return storage.values.get(key(request))?.slice();
	};
	const write = async (request: any) => {
		storage.writes(request);
		if (!actual.resolveRuntimeAssetCacheOptions(request.cache).enabled) return false;
		storage.values.set(key(request), request.bytes.slice());
		return true;
	};
	return {
		...actual,
		readPersistentRuntimeAsset: read,
		writePersistentRuntimeAsset: write,
		loadPersistentRuntimeAsset: async (request: any) => {
			const hit = await read(request);
			if (hit) return hit;
			const bytes = await request.load();
			await actual.verifyRuntimeAssetIntegrity({
				asset: request.identity.url,
				bytes,
				expected: { sha256: request.identity.sha256, bytes: request.identity.bytes }
			});
			await write({ ...request, bytes });
			return bytes;
		}
	};
});

const bytes = new TextEncoder().encode('export default 42;');
const receipt = {
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex'),
	mediaType: 'text/javascript'
};
const config = { baseUrl: 'https://assets.example/clangd/', integrity: { 'clangd.js': receipt } };
const response = () => new Response(bytes, { headers: { 'content-type': 'text/javascript' } });

beforeEach(() => {
	storage.values.clear();
	storage.reads.mockClear();
	storage.writes.mockClear();
	configureRuntimeAssetCache({});
	configureWorkerLanguageToolPersistentAssets({});
});
afterEach(() => {
	configureRuntimeAssetCache({});
	vi.unstubAllGlobals();
});

describe('persistent language tool integration', () => {
	it('reuses verified bytes across separate clangd loads and returns private buffers', async () => {
		const fetch = vi.fn(response);
		vi.stubGlobal('fetch', fetch);
		const first = await loadLanguageToolAsset('clangd', 'clangd.js', config, vi.fn());
		first.bytes.fill(0);
		const second = await loadLanguageToolAsset('clangd', 'clangd.js', { ...config }, vi.fn());
		expect(second.bytes).toEqual(bytes);
		expect(second.mimeType).toBe('text/javascript');
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('honors per-load false while retaining HTTP cache policy and configuration budgets', async () => {
		const fetch = vi.fn(response);
		vi.stubGlobal('fetch', fetch);
		const options = {
			...config,
			cache: 'force-cache' as const,
			persistentCache: { maxBytes: 1024 }
		};
		await loadLanguageToolAsset('clangd', 'clangd.js', options, vi.fn());
		await loadLanguageToolAsset('clangd', 'clangd.js', options, vi.fn(), {
			persistentCache: false
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1]?.[1]).toMatchObject({ cache: 'force-cache' });
		expect(storage.reads.mock.calls[0][0].cache.maxBytes).toBe(1024);
		expect(storage.reads.mock.calls[1][0].cache.enabled).toBe(false);
	});

	it('bypasses persistent storage for custom loaders without a receipt', async () => {
		const fetch = vi.fn(response);
		vi.stubGlobal('fetch', fetch);
		const custom = {
			baseUrl: config.baseUrl,
			loader: () => new URL('clangd.js', config.baseUrl)
		};
		await loadLanguageToolAsset('clangd', 'clangd.js', custom, vi.fn());
		await loadLanguageToolAsset('clangd', 'clangd.js', custom, vi.fn());
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(storage.reads).not.toHaveBeenCalled();
	});

	it('does not reuse a permissive response for a later exact-URL policy', async () => {
		const fetch = vi.fn(response);
		vi.stubGlobal('fetch', fetch);
		await loadLanguageToolAsset('clangd', 'clangd.js', config, vi.fn());
		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					...config,
					requireExactResponseUrl: true
				},
				vi.fn()
			)
		).rejects.toThrow('exact final URL');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(storage.writes).toHaveBeenCalledOnce();
	});

	it('never publishes an invalid MIME response or reads an unauthorized asset URL', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Response(bytes, { headers: { 'content-type': 'text/html' } }))
		);
		await expect(loadLanguageToolAsset('clangd', 'clangd.js', config, vi.fn())).rejects.toThrow(
			'MIME type mismatch'
		);
		expect(storage.writes).not.toHaveBeenCalled();
		storage.reads.mockClear();
		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					...config,
					loader: () => 'https://untrusted.example/clangd.js'
				},
				vi.fn()
			)
		).rejects.toThrow('outside the allowed');
		expect(storage.reads).not.toHaveBeenCalled();
	});

	it('uses explicit receipts for external assets and rejects corrupt downloads before publication', async () => {
		const fetch = vi.fn(response);
		const options = {
			url: 'https://assets.example/compiler.wasm',
			label: 'compiler',
			integrity: receipt,
			fetch
		};
		await fetchBoundedExternalAsset(options);
		await fetchBoundedExternalAsset(options);
		expect(fetch).toHaveBeenCalledOnce();
		storage.values.clear();
		storage.writes.mockClear();
		await expect(
			fetchBoundedExternalAsset({
				...options,
				fetch: vi.fn(() => Promise.resolve(new Response('corrupt')))
			})
		).rejects.toThrow();
		expect(storage.writes).not.toHaveBeenCalled();
	});

	it('applies a host worker snapshot instead of using unrelated worker defaults', async () => {
		configureRuntimeAssetCache(false);
		configureWorkerLanguageToolPersistentAssets({
			persistentCache: { enabled: true, maxBytes: 4096 }
		});
		vi.stubGlobal('fetch', vi.fn(response));
		await fetchBoundedExternalAsset({
			url: 'https://assets.example/compiler.wasm',
			label: 'compiler',
			integrity: receipt
		});
		expect(storage.reads.mock.calls[0][0].cache).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
	});

	it('sends the resolved per-instance configuration in a worker init envelope', async () => {
		const listeners = new Set<(event: any) => void>();
		const worker = {
			addEventListener: (type: string, fn: any) => {
				if (type === 'message') listeners.add(fn);
			},
			removeEventListener: (_type: string, fn: any) => listeners.delete(fn),
			terminate: vi.fn(),
			postMessage: vi.fn(() => {
				for (const fn of [...listeners]) fn({ data: { type: 'ready' } });
			})
		};
		const handle = await createWorkerLanguageServerClient({
			createWorker: () => worker as unknown as Worker,
			initOptions: { strict: 'unchanged' },
			lifecycle: {
				persistentCache: false,
				rootUrl: '/repl',
				currentUrl: 'https://app.example/editor'
			}
		});
		expect(worker.postMessage.mock.calls[0]?.[0]).toEqual({
			type: 'init',
			options: { strict: 'unchanged' },
			persistentAssets: {
				persistentCache: resolveRuntimeAssetCacheOptions(false),
				assetRoot: 'https://app.example/repl'
			}
		});
		handle.dispose();
	});
});
