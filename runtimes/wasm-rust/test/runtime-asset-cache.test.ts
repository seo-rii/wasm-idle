import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createRuntimeAssetCacheClient,
	createRuntimeAssetCacheService
} from '../src/runtime-asset-cache-service.js';
import {
	withRuntimeAssetPersistentCache,
	type RuntimeAssetPersistentCache,
	type RuntimeAssetPersistentCacheIdentity
} from '../src/runtime-asset-cache.js';
import {
	clearRegisteredRuntimeAssetReceipts,
	fetchRuntimeAssetBytes,
	isRegisteredRuntimeAssetCacheIdentity,
	registerRuntimeAssetReceipts
} from '../src/runtime-asset.js';
import {
	createRuntimeAssetDeliveryBudget,
	readRuntimeAssetDeliveryBudget
} from '../src/runtime-delivery-budget.js';

const url = 'https://assets.example/wasm-rust/runtime/rustc.wasm.gz?v=pinned';
const bytes = new TextEncoder().encode('real receipt verified compiler bytes');
const compressed = gzipSync(bytes);
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const receipt = {
	bytes: compressed.byteLength,
	sha256: digest(compressed),
	uncompressedBytes: bytes.byteLength,
	uncompressedSha256: digest(bytes)
};
const identity = {
	url,
	sha256: digest(bytes),
	bytes: bytes.byteLength,
	validationKey: JSON.stringify(['wasm-rust-pinned-logical-v1', 128 * 1024 * 1024])
};
const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const close of cleanup.splice(0)) close();
	clearRegisteredRuntimeAssetReceipts();
	vi.restoreAllMocks();
});

function response(data: Uint8Array = compressed, responseUrl = url) {
	const result = new Response(Uint8Array.from(data).buffer);
	Object.defineProperty(result, 'url', { value: responseUrl });
	return result;
}

function harness() {
	registerRuntimeAssetReceipts('https://assets.example/wasm-rust/runtime/', { [url]: receipt });
	const entries = new Map<string, Uint8Array>();
	const backend = {
		read: vi.fn(async (key: RuntimeAssetPersistentCacheIdentity) =>
			entries.get(JSON.stringify(key))
		),
		write: vi.fn(async (key: RuntimeAssetPersistentCacheIdentity, value: Uint8Array) => {
			entries.set(JSON.stringify(key), Uint8Array.from(value));
			return true;
		})
	} satisfies RuntimeAssetPersistentCache;
	const connect = (cache: RuntimeAssetPersistentCache = backend, timeout?: number) => {
		const service = createRuntimeAssetCacheService(
			cache,
			isRegisteredRuntimeAssetCacheIdentity
		);
		const transferredPort = structuredClone(service.port, { transfer: [service.port] });
		const client = createRuntimeAssetCacheClient(transferredPort, timeout);
		cleanup.push(() => {
			client.close();
			service.close();
		});
		return { client, service };
	};
	return { backend, entries, connect };
}

describe('Rust inner-worker persistent asset capability', () => {
	it('reuses verified logical bytes across fresh inner clients without calling native fetch', async () => {
		const h = harness();
		const first = h.connect();
		const nativeFetch = vi.fn(async () => response());
		expect(
			await fetchRuntimeAssetBytes(
				url,
				'rustc',
				withRuntimeAssetPersistentCache(nativeFetch, first.client)
			)
		).toEqual(bytes);
		expect(nativeFetch).toHaveBeenCalledOnce();
		expect(h.backend.write).toHaveBeenCalledOnce();
		first.client.close();
		first.service.close();
		const second = h.connect();
		const forbiddenFetch = vi.fn(async () => {
			throw new Error('network should not run');
		});
		const budget = createRuntimeAssetDeliveryBudget(1024);
		const progress = vi.fn();
		expect(
			await fetchRuntimeAssetBytes(
				url,
				'rustc',
				withRuntimeAssetPersistentCache(forbiddenFetch, second.client),
				true,
				progress,
				{ deliveryBudget: budget }
			)
		).toEqual(bytes);
		expect(forbiddenFetch).not.toHaveBeenCalled();
		expect(readRuntimeAssetDeliveryBudget(budget).deliveredBytes).toBe(bytes.byteLength);
		expect(progress).toHaveBeenLastCalledWith({
			loaded: bytes.byteLength,
			total: bytes.byteLength
		});
		expect(h.entries.get(JSON.stringify(identity))?.byteLength).toBe(bytes.byteLength);
	});

	it('does not detach caller buffers and independently rejects wrong receipt identities', async () => {
		const h = harness();
		const { client } = h.connect();
		const owned = Uint8Array.from(bytes);
		await client.write(identity, owned);
		expect(owned).toEqual(bytes);
		const cached = await client.read(identity);
		expect(cached).toEqual(bytes);
		expect(h.entries.get(JSON.stringify(identity))).toEqual(bytes);
		await expect(client.read({ ...identity, sha256: '0'.repeat(64) })).rejects.toThrow(
			/Unpinned/
		);
		await expect(client.read({ ...identity, url: `${url}&other=1` })).rejects.toThrow(
			/Unpinned/
		);
		await expect(
			client.read({ ...identity, validationKey: 'arbitrary-policy' })
		).rejects.toThrow(/Unpinned/);
		expect(h.backend.read).toHaveBeenCalledOnce();
	});

	it('rechecks cached content and byte limits before accepting a hit', async () => {
		const h = harness();
		const { client } = h.connect();
		h.entries.set(JSON.stringify(identity), new Uint8Array(bytes.byteLength));
		const nativeFetch = vi.fn(async () => response());
		const fetchImpl = withRuntimeAssetPersistentCache(nativeFetch, client);
		expect(await fetchRuntimeAssetBytes(url, 'rustc', fetchImpl)).toEqual(bytes);
		expect(nativeFetch).toHaveBeenCalledOnce();
		h.backend.read.mockClear();
		await expect(
			fetchRuntimeAssetBytes(url, 'rustc', fetchImpl, true, undefined, { maxAssetBytes: 1 })
		).rejects.toThrow(/receipt exceeds/);
		expect(h.backend.read).not.toHaveBeenCalled();
	});

	it('never persists wrong-URL or unlabelled custom transport responses', async () => {
		const h = harness();
		const { client } = h.connect();
		await expect(
			fetchRuntimeAssetBytes(
				url,
				'rustc',
				withRuntimeAssetPersistentCache(
					async () => response(compressed, 'https://elsewhere.example/x'),
					client
				)
			)
		).rejects.toThrow(/unexpected final URL/);
		expect(
			await fetchRuntimeAssetBytes(
				url,
				'rustc',
				withRuntimeAssetPersistentCache(async () => new Response(compressed), client)
			)
		).toEqual(bytes);
		expect(h.backend.write).not.toHaveBeenCalled();
	});

	it('settles cancellation even if the storage implementation ignores it', async () => {
		const h = harness();
		let storageSignal: AbortSignal | undefined;
		const read = vi.fn(
			(_identity: RuntimeAssetPersistentCacheIdentity, signal?: AbortSignal) => {
				storageSignal = signal;
				return new Promise<Uint8Array | undefined>(() => {});
			}
		);
		const { client } = h.connect({ ...h.backend, read });
		const controller = new AbortController();
		const pending = client.read(identity, controller.signal);
		const rejection = expect(pending).rejects.toThrow('cancelled by test');
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		controller.abort(new Error('cancelled by test'));
		await rejection;
		await vi.waitFor(() => expect(storageSignal?.aborted).toBe(true));
	});

	it('closes pending requests on terminal service close and on timeout', async () => {
		const h = harness();
		const cache = {
			...h.backend,
			read: vi.fn(() => new Promise<Uint8Array | undefined>(() => {}))
		};
		const { client, service } = h.connect(cache);
		const pending = client.read(identity);
		const rejected = expect(pending).rejects.toThrow(/closed/);
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledOnce());
		service.close();
		await rejected;
		const timeoutClient = h.connect(cache, 10).client;
		await expect(timeoutClient.read(identity)).rejects.toThrow(/timed out/);
		await expect(timeoutClient.read(identity)).rejects.toThrow(/unavailable/);
	});
});
