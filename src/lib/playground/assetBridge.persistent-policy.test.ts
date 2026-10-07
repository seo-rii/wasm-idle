// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
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
		storage.read.mockResolvedValue(undefined);
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
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
		expect(storage.read.mock.calls.map(([options]) => options.cache.enabled)).toEqual([
			false,
			true
		]);
		for (const finish of finishes) finish(new Response(bytes));
		await vi.waitFor(() => {
			for (const postMessage of messages) expect(postMessage).toHaveBeenCalledOnce();
		});
		expect(storage.write.mock.calls.map(([options]) => options.cache.enabled)).toEqual([
			false,
			true
		]);
		for (const bridge of bridges) bridge.dispose();
	});
});
