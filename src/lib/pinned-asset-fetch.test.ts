// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchPinnedRuntimeAsset,
	prefetchRuntimeAssets
} from '../../packages/core/src/pinned-asset-fetch';
import * as storage from '../../packages/core/src/persistent-asset-cache';

const url = 'https://assets.test/compiler.wasm';
const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const receipt = { sha256: digest(bytes), bytes: bytes.byteLength, mediaType: 'application/wasm' };

function response(
	body: BodyInit = bytes,
	overrides: { url?: string; status?: number; headers?: HeadersInit } = {}
) {
	const result = new Response(body, {
		status: overrides.status ?? 200,
		headers: overrides.headers ?? { 'Content-Type': 'application/wasm' }
	});
	Object.defineProperty(result, 'url', { value: overrides.url ?? url });
	return result;
}

afterEach(() => {
	storage.configureRuntimeAssetCache({});
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('pinned public asset fetch', () => {
	it('binds native/custom fetch correctly and verifies bytes even with caching disabled', async () => {
		const fetcher = vi.fn(function (this: unknown) {
			expect(this).toBe(globalThis);
			return Promise.resolve(response());
		});
		const progress = vi.fn();
		expect(
			await fetchPinnedRuntimeAsset({
				url,
				receipt,
				fetch: fetcher,
				persistentCache: false,
				onProgress: progress
			})
		).toEqual(bytes);
		expect(fetcher).toHaveBeenCalledWith(
			url,
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
		await expect(
			fetchPinnedRuntimeAsset({
				url,
				receipt: { ...receipt, sha256: '0'.repeat(64) },
				fetch: fetcher,
				persistentCache: false
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});

	it('does not apply the decoded Wasm MIME requirement to a pinned raw gzip payload', async () => {
		const compressed = gzipSync(bytes);
		const encodedReceipt = {
			sha256: digest(compressed),
			bytes: compressed.length,
			mediaType: 'application/wasm',
			uncompressedSha256: receipt.sha256,
			uncompressedBytes: bytes.length
		};
		expect(
			await fetchPinnedRuntimeAsset({
				url,
				receipt: encodedReceipt,
				fetch: async () =>
					response(compressed, { headers: { 'Content-Type': 'application/gzip' } }),
				persistentCache: false
			})
		).toEqual(new Uint8Array(compressed));
		await expect(
			fetchPinnedRuntimeAsset({
				url,
				receipt,
				fetch: async () =>
					response(bytes, { headers: { 'Content-Type': 'application/gzip' } }),
				persistentCache: false
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});

	it.each([
		'https://user:secret@assets.test/asset',
		'file:///asset',
		`${url}#fragment`,
		'/relative'
	])('rejects unsupported request URL %s before fetching', async (input) => {
		const fetcher = vi.fn();
		await expect(
			fetchPinnedRuntimeAsset({ url: input, receipt, fetch: fetcher, persistentCache: false })
		).rejects.toMatchObject({ code: 'runtime-configuration' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each(['wrong-url', 'missing-url', 'partial', 'redirected', 'opaque'])(
		'rejects %s responses before reading executable bytes',
		async (kind) => {
			const cancel = vi.fn();
			const body = new ReadableStream({ cancel });
			const candidate = response(body, {
				url:
					kind === 'wrong-url'
						? 'https://elsewhere.test/compiler.wasm'
						: kind === 'missing-url'
							? ''
							: url,
				status: kind === 'partial' ? 206 : 200
			});
			if (kind === 'redirected')
				Object.defineProperty(candidate, 'redirected', { value: true });
			if (kind === 'opaque') Object.defineProperty(candidate, 'type', { value: 'opaque' });
			await expect(
				fetchPinnedRuntimeAsset({
					url,
					receipt,
					fetch: async () => candidate,
					persistentCache: false
				})
			).rejects.toThrow(/exact URL/);
			expect(cancel).toHaveBeenCalledOnce();
		}
	);

	it('bounds body reads even when the server omits content length', async () => {
		const cancel = vi.fn();
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(bytes);
			},
			cancel
		});
		await expect(
			fetchPinnedRuntimeAsset({
				url,
				receipt: { sha256: receipt.sha256 },
				maxAssetBytes: 4,
				fetch: async () => response(body),
				persistentCache: false
			})
		).rejects.toMatchObject({ code: 'asset-too-large', actual: bytes.length, limit: 4 });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects oversized declared responses before streaming', async () => {
		const candidate = response(bytes, {
			headers: { 'Content-Length': '10000', 'Content-Type': 'application/wasm' }
		});
		await expect(
			fetchPinnedRuntimeAsset({
				url,
				receipt,
				maxAssetBytes: 1024,
				fetch: async () => candidate,
				persistentCache: false
			})
		).rejects.toMatchObject({ code: 'asset-too-large' });
	});

	it('settles cancellation while custom fetch ignores the signal and cancels its late response', async () => {
		const controller = new AbortController();
		const cancelled = new Error('cancel fetch');
		let deliver!: (response: Response) => void;
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					deliver = resolve;
				})
		);
		const pending = fetchPinnedRuntimeAsset({
			url,
			receipt,
			fetch: fetcher,
			persistentCache: false,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		controller.abort(cancelled);
		await expect(pending).rejects.toBe(cancelled);
		const cancel = vi.fn();
		deliver(response(new ReadableStream({ cancel })));
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
	});

	it('settles cancellation during an indefinitely pending stream read', async () => {
		const controller = new AbortController();
		const cancelled = new Error('cancel stream');
		const pull = vi.fn(() => new Promise<void>(() => {}));
		const cancel = vi.fn(() => new Promise<void>(() => {}));
		const pending = fetchPinnedRuntimeAsset({
			url,
			receipt,
			fetch: async () => response(new ReadableStream({ pull, cancel })),
			persistentCache: false,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(pull).toHaveBeenCalled());
		controller.abort(cancelled);
		await expect(pending).rejects.toBe(cancelled);
		expect(cancel).toHaveBeenCalledOnce();
	});
});

describe('explicit asset prefetch', () => {
	it('makes no storage or network requests when globally or locally disabled', async () => {
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		const stats = vi.spyOn(storage, 'getRuntimeAssetCacheStats');
		storage.configureRuntimeAssetCache(false);
		expect(await prefetchRuntimeAssets({ assets: [{ url, receipt }] })).toEqual({
			completed: 0,
			stored: 0,
			skipped: true
		});
		storage.configureRuntimeAssetCache({});
		expect(
			await prefetchRuntimeAssets({ assets: [{ url, receipt }], persistentCache: false })
		).toEqual({ completed: 0, stored: 0, skipped: true });
		expect(stats).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('skips useless downloads when browser storage cannot be opened', async () => {
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		vi.spyOn(storage, 'getRuntimeAssetCacheStats').mockResolvedValue({
			available: false,
			entries: 0,
			bytes: 0,
			maxBytes: 100,
			versions: []
		});
		expect(await prefetchRuntimeAssets({ assets: [{ url, receipt }] })).toEqual({
			completed: 0,
			stored: 0,
			skipped: true
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('reports verified downloads separately from writes rejected by quota', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		vi.spyOn(storage, 'getRuntimeAssetCacheStats').mockResolvedValue({
			available: true,
			entries: 0,
			bytes: 0,
			maxBytes: 100,
			versions: []
		});
		vi.spyOn(storage, 'readPersistentRuntimeAsset').mockResolvedValue(undefined);
		const write = vi.spyOn(storage, 'writePersistentRuntimeAsset').mockResolvedValue(false);
		expect(await prefetchRuntimeAssets({ assets: [{ url, receipt }] })).toEqual({
			completed: 1,
			stored: 0,
			skipped: false
		});
		expect(write).toHaveBeenCalledOnce();
		write.mockResolvedValue(true);
		expect(await prefetchRuntimeAssets({ assets: [{ url, receipt }] })).toEqual({
			completed: 1,
			stored: 1,
			skipped: false
		});
	});
});
