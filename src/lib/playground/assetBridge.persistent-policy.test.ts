// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@wasm-idle/core', async (original) => ({
	...(await original<typeof import('@wasm-idle/core')>()),
	readPersistentRuntimeAsset: storage.read,
	writePersistentRuntimeAsset: storage.write
}));
import { WorkerAssetBridge } from './assetBridge';
import { RuntimeAssetCache } from './runtimeAssetCache';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('worker bridge per-execution persistent policy', () => {
	it('restores the load baseline and keeps false attached to an already started request', async () => {
		const bytes = new TextEncoder().encode('export default 1;');
		const asset = 'clangd.js';
		const baseUrl = 'https://assets.example/clang/';
		const config = {
			baseUrl,
			useAssetBridge: true,
			persistentCache: { enabled: true, maxBytes: 4096, maxEntryBytes: 2048 },
			integrity: {
				[asset]: {
					bytes: bytes.length,
					sha256: createHash('sha256').update(bytes).digest('hex')
				}
			}
		};
		storage.read.mockResolvedValue(undefined);
		storage.write.mockResolvedValue(true);
		let finish!: (response: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finish = resolve;
					})
			)
		);
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clangd',
			config
		);
		expect(bridge.setExecutionPersistentCache(false)).toMatchObject({
			enabled: false,
			maxBytes: 4096
		});
		expect(bridge.matches(config)).toBe(true);
		bridge.handleMessage({ data: { assetRequest: { id: 1, asset } } } as MessageEvent);
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		expect(bridge.setExecutionPersistentCache()).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
		const response = new Response(bytes);
		Object.defineProperty(response, 'url', { value: `${baseUrl}${asset}` });
		finish(response);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage.mock.calls[0][0].assetResponse.ok).toBe(true);
		expect(storage.read.mock.calls[0][0].cache).toMatchObject({ enabled: false });
		expect(storage.write.mock.calls[0][0].cache).toMatchObject({ enabled: false });
		expect(bridge.setExecutionPersistentCache({ maxEntryBytes: 1024 })).toMatchObject({
			enabled: true,
			maxBytes: 4096,
			maxEntryBytes: 1024
		});
		expect(bridge.setExecutionPersistentCache()).toMatchObject({ maxEntryBytes: 2048 });
		bridge.dispose();
	});

	it('does not change a worker native-loader selection when a call enables storage', () => {
		const config = {
			baseUrl: 'https://assets.example/python/',
			useAssetBridge: false,
			persistentCache: false as const
		};
		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'python',
			config
		);
		expect(bridge.setExecutionPersistentCache({ enabled: true }).enabled).toBe(true);
		expect(bridge.matches(config)).toBe(true);
		expect(bridge.setExecutionPersistentCache().enabled).toBe(false);
		bridge.dispose();
	});

	it('keeps differently configured storage policies independent while downloads are pending', async () => {
		const bytes = new TextEncoder().encode('export default 1;');
		const asset = 'clangd.js';
		const config = {
			baseUrl: 'https://assets.example/clang/',
			useAssetBridge: true,
			integrity: {
				[asset]: {
					bytes: bytes.length,
					sha256: createHash('sha256').update(bytes).digest('hex')
				}
			}
		};
		const cache = new RuntimeAssetCache();
		const messages = [vi.fn(), vi.fn()];
		const bridges = messages.map(
			(postMessage, index) =>
				new WorkerAssetBridge(
					{ postMessage } as unknown as Worker,
					'clangd',
					{ ...config, persistentCache: index === 0 ? false : { enabled: true } },
					undefined,
					128,
					false,
					cache
				)
		);
		const finishes: Array<(value: Response) => void> = [];
		const reads = new Map<boolean, () => void>();
		storage.read.mockImplementation(
			({ cache }) =>
				new Promise<undefined>((resolve) => {
					reads.set(cache.enabled, () => resolve(undefined));
				})
		);
		storage.write.mockResolvedValue(true);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finishes.push(resolve);
					})
			)
		);
		for (const bridge of bridges)
			bridge.handleMessage({ data: { assetRequest: { id: 1, asset } } } as MessageEvent);
		await vi.waitFor(() => expect(storage.read).toHaveBeenCalledTimes(2));
		for (const enabled of [false, true])
			expect(
				storage.read.mock.calls.filter(([options]) => options.cache.enabled === enabled)
			).toHaveLength(1);
		// Start both policies' downloads in a known order, then complete them in reverse.
		reads.get(false)!();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		reads.get(true)!();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
		finishes[1](new Response(bytes));
		await vi.waitFor(() => expect(messages[1]).toHaveBeenCalledOnce());
		expect(messages[0]).not.toHaveBeenCalled();
		expect(storage.write).toHaveBeenCalledOnce();
		expect(storage.write.mock.calls[0][0].cache.enabled).toBe(true);
		finishes[0](new Response(bytes));
		await vi.waitFor(() => {
			for (const postMessage of messages) expect(postMessage).toHaveBeenCalledOnce();
		});
		expect(storage.write).toHaveBeenCalledTimes(2);
		for (const enabled of [false, true])
			expect(
				storage.write.mock.calls.filter(([options]) => options.cache.enabled === enabled)
			).toHaveLength(1);
		for (const postMessage of messages)
			expect(postMessage.mock.calls[0][0].assetResponse.ok).toBe(true);
		for (const bridge of bridges) bridge.dispose();
	});

	it('stores only MIME-validated responses and keys hits by the expected MIME type', async () => {
		const bytes = new TextEncoder().encode('export default 1;');
		const asset = 'clangd.js';
		const baseUrl = 'https://assets.example/clang/';
		const receipt = {
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		const stored = new Map<string, Uint8Array>();
		const keyOf = ({ identity }: { identity: Record<string, unknown> }) =>
			JSON.stringify([identity.url, identity.sha256, identity.validationKey]);
		storage.read.mockImplementation(async (request) => stored.get(keyOf(request)));
		storage.write.mockImplementation(async (request) => {
			stored.set(keyOf(request), Uint8Array.from(request.bytes));
			return true;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const response = new Response(bytes, { headers: { 'content-type': 'text/plain' } });
				Object.defineProperty(response, 'url', { value: `${baseUrl}${asset}` });
				return response;
			})
		);
		const load = async (mediaType?: string) => {
			const postMessage = vi.fn();
			const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clangd', {
				baseUrl,
				useAssetBridge: true,
				integrity: { [asset]: mediaType ? { ...receipt, mediaType } : receipt }
			});
			bridge.handleMessage({ data: { assetRequest: { id: 1, asset } } } as MessageEvent);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			bridge.dispose();
			return postMessage.mock.calls[0][0].assetResponse;
		};
		const mismatch = {
			ok: false,
			error: `Runtime asset ${asset} MIME type mismatch: expected text/javascript, received text/plain`
		};

		expect(await load('text/javascript')).toMatchObject(mismatch);
		expect(storage.write).not.toHaveBeenCalled();
		expect(await load('text/javascript')).toMatchObject(mismatch);
		// An entry stored without a MIME expectation cannot vouch for a stricter receipt.
		expect(await load()).toMatchObject({ ok: true, mimeType: 'text/plain' });
		expect(stored.size).toBe(1);
		expect(await load('text/javascript')).toMatchObject(mismatch);
		expect(globalThis.fetch).toHaveBeenCalledTimes(4);
	});
});
