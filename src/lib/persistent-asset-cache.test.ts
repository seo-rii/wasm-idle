// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearRuntimeAssetCache,
	configureRuntimeAssetCache,
	createRuntimeAssetCacheBackend,
	getRuntimeAssetCacheOptions,
	getRuntimeAssetCacheStats,
	loadPersistentRuntimeAsset,
	pruneRuntimeAssetCache,
	readPersistentRuntimeAsset,
	requestRuntimeAssetCachePersistence,
	resolveRuntimeAssetCacheOptions,
	writePersistentRuntimeAsset,
	type RuntimePersistentAssetIdentity
} from '../../packages/core/src/persistent-asset-cache.js';

const payload = (text: string) => new TextEncoder().encode(text);
const identity = (
	bytes: Uint8Array,
	version = '1.0.6',
	url = 'https://assets.test/compiler.wasm.gz'
): RuntimePersistentAssetIdentity => ({
	url,
	version,
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

/** Small asynchronous test adapter. Browser IDB/CacheStorage contracts are also covered by Chromium integration tests. */
function installStorage() {
	const databases = new Map<string, Map<string, unknown>>();
	const bodies = new Map<string, Map<string, Response>>();
	const keyOf = (key: string | Request) => (typeof key === 'string' ? key : key.url);
	const cacheOpen = vi.fn(async (name: string) => {
		let values = bodies.get(name);
		if (!values) {
			values = new Map();
			bodies.set(name, values);
		}
		return {
			match: async (key: string | Request) => values!.get(keyOf(key))?.clone(),
			put: async (key: string | Request, response: Response) => {
				values!.set(keyOf(key), response.clone());
			},
			delete: async (key: string | Request) => values!.delete(keyOf(key)),
			keys: async () => [...values!.keys()].map((key) => new Request(key))
		};
	});
	const databaseOpen = vi.fn((name: string) => {
		let values = databases.get(name);
		const upgrade = !values;
		if (!values) {
			values = new Map();
			databases.set(name, values);
		}
		const request: Record<string, any> = {};
		request.result = {
			close: vi.fn(),
			createObjectStore: vi.fn(),
			transaction: () => {
				const transaction: Record<string, any> = {};
				transaction.abort = () => transaction.onabort?.();
				const operation = (fn: () => unknown) => {
					const result: Record<string, unknown> = {};
					queueMicrotask(() => {
						result.result = structuredClone(fn());
						transaction.oncomplete?.();
					});
					return result;
				};
				transaction.objectStore = () => ({
					get: (key: string) => operation(() => values!.get(key)),
					getAll: () => operation(() => [...values!.values()]),
					put: (record: { sha256: string }) =>
						operation(() => {
							values!.set(record.sha256, structuredClone(record));
							return record.sha256;
						}),
					clear: () =>
						operation(() => {
							values!.clear();
						}),
					delete: (key: string) =>
						operation(() => {
							values!.delete(key);
						})
				});
				return transaction;
			}
		};
		queueMicrotask(() => {
			if (upgrade) request.onupgradeneeded?.();
			request.onsuccess?.();
		});
		return request;
	});
	let lockQueue = Promise.resolve<unknown>(undefined);
	const lockRequest = vi.fn(
		(_name: string, options: { signal: AbortSignal }, fn: () => Promise<unknown>) => {
			const task = lockQueue
				.catch(() => {})
				.then(() => {
					if (options.signal.aborted) throw options.signal.reason;
					return fn();
				});
			lockQueue = task;
			return task;
		}
	);
	const estimate = vi.fn(async () => ({ quota: 2 * 1024 ** 3, usage: 0 }));
	const persist = vi.fn(async () => true);
	vi.stubGlobal('caches', { open: cacheOpen });
	vi.stubGlobal('indexedDB', { open: databaseOpen });
	vi.stubGlobal('navigator', { locks: { request: lockRequest }, storage: { estimate, persist } });
	return { bodies, databases, cacheOpen, databaseOpen, lockRequest, estimate, persist };
}

describe('persistent runtime asset cache', () => {
	let storage: ReturnType<typeof installStorage>;
	beforeEach(() => {
		configureRuntimeAssetCache({});
		storage = installStorage();
	});
	afterEach(() => {
		configureRuntimeAssetCache({});
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('merges global, instance and call policies without accidentally re-enabling a disabled layer', () => {
		configureRuntimeAssetCache({ maxBytes: 100, namespace: 'host' });
		expect(
			resolveRuntimeAssetCacheOptions({ maxBytes: 80 }, { maxEntryBytes: 10 })
		).toMatchObject({ enabled: true, maxBytes: 80, maxEntryBytes: 10, namespace: 'host' });
		configureRuntimeAssetCache(false);
		expect(resolveRuntimeAssetCacheOptions({ maxBytes: 80 }).enabled).toBe(false);
		expect(resolveRuntimeAssetCacheOptions({ enabled: true }).enabled).toBe(true);
		expect(resolveRuntimeAssetCacheOptions({ enabled: true }, false).enabled).toBe(false);
		const snapshot = getRuntimeAssetCacheOptions();
		snapshot.enabled = true;
		expect(getRuntimeAssetCacheOptions().enabled).toBe(false);
	});

	it('binds producer backends to immutable policy and per-request receipt snapshots', async () => {
		configureRuntimeAssetCache({ namespace: 'producer', version: 'release-a' });
		const backend = createRuntimeAssetCacheBackend();
		expect(Object.isFrozen(backend)).toBe(true);
		configureRuntimeAssetCache(false);
		const original = payload('compiler-owned-by-producer');
		const bytes = original.slice();
		const key = {
			...identity(bytes),
			bytes: bytes.byteLength,
			validationKey: 'strict-producer'
		};
		const pinned = { ...key };
		const pending = backend.write(key, bytes);
		key.sha256 = '0'.repeat(64);
		bytes.fill(0);
		expect(await pending).toBe(true);
		expect(await backend.read(pinned)).toEqual(original);
		expect(
			await backend.read({ ...pinned, validationKey: 'different-policy' })
		).toBeUndefined();
		expect(
			await getRuntimeAssetCacheStats({ enabled: true, namespace: 'producer' })
		).toMatchObject({
			entries: 1,
			versions: ['release-a']
		});
	});

	it('keeps disabled producer backends storage-free after global re-enabling', async () => {
		const backend = createRuntimeAssetCacheBackend(false);
		configureRuntimeAssetCache({ enabled: true });
		const bytes = payload('off');
		const key = { ...identity(bytes), bytes: bytes.byteLength };
		expect(await backend.read(key)).toBeUndefined();
		expect(await backend.write(key, bytes)).toBe(false);
		expect(storage.cacheOpen).not.toHaveBeenCalled();
		expect(storage.databaseOpen).not.toHaveBeenCalled();
		expect(storage.lockRequest).not.toHaveBeenCalled();
		const controller = new AbortController();
		controller.abort(new Error('operation ended'));
		await expect(backend.read(key, controller.signal)).rejects.toThrow('operation ended');
	});

	it('rejects unsafe options before touching storage', () => {
		expect(() => configureRuntimeAssetCache({ maxBytes: -1 })).toThrow(TypeError);
		expect(() => configureRuntimeAssetCache({ namespace: '../other-app' })).toThrow(TypeError);
		expect(storage.cacheOpen).not.toHaveBeenCalled();
	});

	it('disabled loads work while all persistent reads, writes, deletion and permission requests stay off', async () => {
		configureRuntimeAssetCache(false);
		const bytes = payload('disabled');
		const key = identity(bytes);
		expect(
			await loadPersistentRuntimeAsset({ identity: key, load: async () => bytes })
		).toEqual(bytes);
		await clearRuntimeAssetCache();
		await pruneRuntimeAssetCache();
		expect(await requestRuntimeAssetCachePersistence()).toBe(false);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ available: false, bytes: 0 });
		expect(storage.cacheOpen).not.toHaveBeenCalled();
		expect(storage.databaseOpen).not.toHaveBeenCalled();
		expect(storage.lockRequest).not.toHaveBeenCalled();
		expect(storage.persist).not.toHaveBeenCalled();
	});

	it('caches verified bytes across loader instances, returns independent copies and deduplicates versions by hash', async () => {
		const bytes = payload('compiler-compressed');
		const load = vi.fn(async () => bytes);
		const first = await loadPersistentRuntimeAsset({ identity: identity(bytes), load });
		first.fill(0);
		const second = await loadPersistentRuntimeAsset({
			identity: identity(bytes, '1.0.7', 'https://new-cdn.test/compiler.wasm.gz'),
			load
		});
		expect(second).toEqual(bytes);
		expect(load).toHaveBeenCalledTimes(1);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({
			entries: 1,
			bytes: bytes.byteLength,
			versions: ['1.0.6', '1.0.7']
		});
		await clearRuntimeAssetCache({ version: '1.0.6' });
		expect(await getRuntimeAssetCacheStats()).toMatchObject({
			entries: 1,
			versions: ['1.0.7']
		});
		await clearRuntimeAssetCache({ version: '1.0.7' });
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
	});

	it('rejects corrupted downloads and never publishes them', async () => {
		const bytes = payload('expected');
		await expect(
			loadPersistentRuntimeAsset({
				identity: identity(bytes),
				load: async () => payload('different')
			})
		).rejects.toThrow(/mismatch/);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 0 });
	});

	it('does not reuse transport validation from a different URL or policy, but keeps bodies deduplicated', async () => {
		const bytes = payload('shared-content');
		const permissive = { ...identity(bytes), validationKey: 'allow-redirects' };
		const strict = { ...identity(bytes), validationKey: 'exact-url-and-mime' };
		await writePersistentRuntimeAsset({ identity: permissive, bytes });
		expect(await readPersistentRuntimeAsset({ identity: strict })).toBeUndefined();
		await writePersistentRuntimeAsset({ identity: strict, bytes });
		expect(
			await readPersistentRuntimeAsset({ identity: { ...strict, version: '1.0.7' } })
		).toEqual(bytes);
		expect(
			await readPersistentRuntimeAsset({
				identity: { ...strict, url: 'https://other.test/compiler.wasm.gz' }
			})
		).toBeUndefined();
		expect(await getRuntimeAssetCacheStats()).toMatchObject({
			entries: 1,
			bytes: bytes.byteLength
		});
	});

	it('does not accept a same-hash entry with a different pinned byte size', async () => {
		const bytes = payload('size-check');
		await writePersistentRuntimeAsset({ identity: identity(bytes), bytes });
		expect(
			await readPersistentRuntimeAsset({ identity: { ...identity(bytes), bytes: 2 } })
		).toBeUndefined();
		expect(await readPersistentRuntimeAsset({ identity: identity(bytes) })).toEqual(bytes);
	});

	it('revalidates hits, deletes corruption, and reloads the pinned source', async () => {
		const bytes = payload('expected');
		await writePersistentRuntimeAsset({ identity: identity(bytes), bytes });
		const stored = [...storage.bodies.values()][0];
		stored.set([...stored.keys()][0], new Response(payload('corrupt!')));
		const load = vi.fn(async () => bytes);
		expect(await loadPersistentRuntimeAsset({ identity: identity(bytes), load })).toEqual(
			bytes
		);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('never implicitly caches assets without a valid trusted hash', async () => {
		const bytes = payload('unversioned');
		const key = { ...identity(bytes), sha256: '' };
		expect(
			await loadPersistentRuntimeAsset({ identity: key, load: async () => bytes })
		).toEqual(bytes);
		expect(storage.cacheOpen).not.toHaveBeenCalled();
	});

	it('enforces byte, entry-size and entry-count budgets using LRU eviction', async () => {
		configureRuntimeAssetCache({ maxBytes: 8, maxEntryBytes: 5, maxEntries: 2 });
		let now = 100;
		vi.spyOn(Date, 'now').mockImplementation(() => now++);
		const a = payload('aaaa'),
			b = payload('bbbb'),
			c = payload('cccc');
		await writePersistentRuntimeAsset({ identity: identity(a), bytes: a });
		await writePersistentRuntimeAsset({ identity: identity(b), bytes: b });
		await readPersistentRuntimeAsset({ identity: identity(a) });
		await writePersistentRuntimeAsset({ identity: identity(c), bytes: c });
		expect(await readPersistentRuntimeAsset({ identity: identity(b) })).toBeUndefined();
		expect(await readPersistentRuntimeAsset({ identity: identity(a) })).toEqual(a);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 2, bytes: 8 });
		const oversized = payload('123456');
		expect(
			await writePersistentRuntimeAsset({ identity: identity(oversized), bytes: oversized })
		).toBe(false);
	});

	it('honors no-eviction policy and available origin quota', async () => {
		configureRuntimeAssetCache({ maxBytes: 8, eviction: 'none', storageReserveBytes: 2 });
		storage.estimate.mockResolvedValue({ quota: 10, usage: 4 });
		const a = payload('aaaa'),
			b = payload('bbbb');
		expect(await writePersistentRuntimeAsset({ identity: identity(a), bytes: a })).toBe(true);
		storage.estimate.mockResolvedValue({ quota: 10, usage: 8 });
		expect(await writePersistentRuntimeAsset({ identity: identity(b), bytes: b })).toBe(false);
		expect(await readPersistentRuntimeAsset({ identity: identity(a) })).toEqual(a);
	});

	it('serializes concurrent writers to keep aggregate budgets bounded', async () => {
		configureRuntimeAssetCache({ maxBytes: 8, maxEntries: 2 });
		await Promise.all(
			['aaaa', 'bbbb', 'cccc', 'dddd'].map(async (text) => {
				const bytes = payload(text);
				return writePersistentRuntimeAsset({ identity: identity(bytes), bytes });
			})
		);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 2, bytes: 8 });
	});

	it('recovers orphan bodies and limits explicit clearing to its own namespace', async () => {
		const a = payload('aaaa');
		await writePersistentRuntimeAsset({ identity: identity(a), bytes: a });
		await writePersistentRuntimeAsset({
			identity: identity(a),
			bytes: a,
			cache: { namespace: 'another-app' }
		});
		const stored = storage.bodies.get('wasm-idle-assets-v1:wasm-idle')!;
		stored.set('https://wasm-idle.invalid/orphan', new Response('orphan'));
		await pruneRuntimeAssetCache();
		expect(stored.size).toBe(1);
		await clearRuntimeAssetCache();
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 0 });
		expect(await getRuntimeAssetCacheStats({ namespace: 'another-app' })).toMatchObject({
			entries: 1
		});
	});

	it('falls back for unavailable/denied storage, preserves load errors, and never requests persistence automatically', async () => {
		storage.cacheOpen.mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
		const bytes = payload('fallback');
		expect(
			await loadPersistentRuntimeAsset({ identity: identity(bytes), load: async () => bytes })
		).toEqual(bytes);
		await expect(
			loadPersistentRuntimeAsset({
				identity: identity(bytes),
				load: async () => {
					throw new Error('network failed');
				}
			})
		).rejects.toThrow('network failed');
		expect(storage.persist).not.toHaveBeenCalled();
		vi.stubGlobal('navigator', { storage: { estimate: storage.estimate } });
		expect(await readPersistentRuntimeAsset({ identity: identity(bytes) })).toBeUndefined();
	});

	it('can explicitly reset corrupt metadata and orphan bodies without touching other apps', async () => {
		const bytes = payload('recover');
		await writePersistentRuntimeAsset({ identity: identity(bytes), bytes });
		storage.databases.get('wasm-idle-assets-v1:wasm-idle')!.set('broken', { broken: true });
		await clearRuntimeAssetCache();
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ available: true, entries: 0 });
		expect(storage.bodies.get('wasm-idle-assets-v1:wasm-idle')!.size).toBe(0);
	});

	it('makes persistence requests only through the explicit management method', async () => {
		expect(await requestRuntimeAssetCachePersistence()).toBe(true);
		expect(storage.persist).toHaveBeenCalledTimes(1);
	});

	it('preserves a caller-supplied null abort reason without accessing storage', async () => {
		const controller = new AbortController();
		controller.abort(null);
		await expect(
			readPersistentRuntimeAsset({
				identity: identity(payload('abort')),
				signal: controller.signal
			})
		).rejects.toBeNull();
		expect(storage.cacheOpen).not.toHaveBeenCalled();
	});

	it('does not swallow cancellation or corrupt another caller during cancellation', async () => {
		const bytes = payload('abort');
		const controller = new AbortController();
		controller.abort(new Error('caller cancelled'));
		const load = vi.fn(async () => bytes);
		await expect(
			loadPersistentRuntimeAsset({
				identity: identity(bytes),
				signal: controller.signal,
				load
			})
		).rejects.toThrow('caller cancelled');
		expect(load).not.toHaveBeenCalled();
		expect(await loadPersistentRuntimeAsset({ identity: identity(bytes), load })).toEqual(
			bytes
		);
	});
});
