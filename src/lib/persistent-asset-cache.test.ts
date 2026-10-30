// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearRuntimeAssetCache,
	configureRuntimeAssetCache,
	createRuntimeAssetCacheBackend,
	createRuntimeGeneratedAssetCacheBackend,
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
				let finished = false;
				let pendingRequests = 0;
				transaction.abort = () => {
					if (finished) return;
					finished = true;
					queueMicrotask(() => transaction.onabort?.());
				};
				const operation = (fn: () => unknown) => {
					const result: Record<string, any> = {};
					pendingRequests++;
					queueMicrotask(() => {
						if (finished) return;
						result.result = structuredClone(fn());
						result.onsuccess?.();
						if (--pendingRequests === 0) {
							finished = true;
							transaction.oncomplete?.();
						}
					});
					return result;
				};
				transaction.objectStore = () => ({
					transaction,
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
		vi.useRealTimers();
		configureRuntimeAssetCache({});
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('closes a database opened after cancellation without starting metadata work', async () => {
		const started = Promise.withResolvers<void>();
		const close = vi.fn();
		const transaction = vi.fn();
		const request: Record<string, any> = { result: { close, transaction } };
		storage.databaseOpen.mockImplementationOnce(() => {
			started.resolve();
			return request;
		});
		const controller = new AbortController();
		const reason = new Error('cancel database opening');
		const pending = readPersistentRuntimeAsset({
			identity: identity(payload('late')),
			signal: controller.signal
		});
		const rejected = expect(pending).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		request.onsuccess();
		expect(close).toHaveBeenCalledOnce();
		expect(transaction).not.toHaveBeenCalled();
		expect(storage.cacheOpen).not.toHaveBeenCalled();
	});

	it('aborts an active metadata transaction and waits for its abort before reusing storage', async () => {
		const bytes = payload('metadata');
		const key = identity(bytes);
		await writePersistentRuntimeAsset({ identity: key, bytes });
		const open = storage.databaseOpen.getMockImplementation()!;
		const started = Promise.withResolvers<void>();
		const aborted = vi.fn();
		storage.databaseOpen.mockImplementationOnce((name) => {
			const request = open(name);
			request.result.transaction = () => {
				const transaction: Record<string, any> = {
					objectStore: () => ({
						get: () => {
							started.resolve();
							return {};
						}
					}),
					abort: () => {
						aborted();
						queueMicrotask(() => transaction.onabort());
					}
				};
				return transaction;
			};
			return request;
		});
		const controller = new AbortController();
		const reason = new Error('cancel metadata');
		const pending = readPersistentRuntimeAsset({ identity: key, signal: controller.signal });
		const rejected = expect(pending).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		expect(await readPersistentRuntimeAsset({ identity: key })).toEqual(bytes);
		expect(aborted).toHaveBeenCalledOnce();
	});

	it('bounds cache opening after acquiring the lock and releases it for a later reader', async () => {
		vi.useFakeTimers();
		const open = storage.cacheOpen.getMockImplementation()!;
		const started = Promise.withResolvers<void>();
		storage.cacheOpen.mockImplementationOnce(() => {
			started.resolve();
			return new Promise(() => {});
		});
		const pending = readPersistentRuntimeAsset({ identity: identity(payload('open')) });
		await started.promise;
		await vi.advanceTimersByTimeAsync(3001);
		expect(await pending).toBeUndefined();
		storage.cacheOpen.mockImplementation(open);
		const bytes = payload('retry');
		expect(await writePersistentRuntimeAsset({ identity: identity(bytes), bytes })).toBe(true);
		expect(await readPersistentRuntimeAsset({ identity: identity(bytes) })).toEqual(bytes);
	});

	it('aborts a stalled cache lookup after lock acquisition without deleting verified content', async () => {
		const bytes = payload('match');
		const key = identity(bytes);
		await writePersistentRuntimeAsset({ identity: key, bytes });
		const open = storage.cacheOpen.getMockImplementation()!;
		const started = Promise.withResolvers<void>();
		storage.cacheOpen.mockImplementationOnce(async (name) => ({
			...(await open(name)),
			match: () => {
				started.resolve();
				return new Promise(() => {});
			}
		}));
		const controller = new AbortController();
		const reason = new Error('stop stalled lookup');
		const pending = readPersistentRuntimeAsset({ identity: key, signal: controller.signal });
		const rejected = expect(pending).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		expect(await readPersistentRuntimeAsset({ identity: key })).toEqual(bytes);
	});

	it('cancels a stalled body reader without waiting for its cancellation promise', async () => {
		const bytes = payload('body');
		const key = identity(bytes);
		await writePersistentRuntimeAsset({ identity: key, bytes });
		const open = storage.cacheOpen.getMockImplementation()!;
		const started = Promise.withResolvers<void>();
		const cancel = vi.fn(() => new Promise<void>(() => {}));
		storage.cacheOpen.mockImplementationOnce(async (name) => {
			const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
			const getReader = response.body!.getReader.bind(response.body);
			vi.spyOn(response.body!, 'getReader').mockImplementation(() => {
				const reader = getReader();
				const read = reader.read.bind(reader);
				vi.spyOn(reader, 'read').mockImplementation(() => {
					started.resolve();
					return read();
				});
				return reader;
			});
			return { ...(await open(name)), match: async () => response };
		});
		const controller = new AbortController();
		const reason = new Error('stop stalled body');
		const pending = readPersistentRuntimeAsset({ identity: key, signal: controller.signal });
		const rejected = expect(pending).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		expect(await readPersistentRuntimeAsset({ identity: key })).toEqual(bytes);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('retains a lock for a cancelled native write, fences its metadata, and recovers orphan bodies', async () => {
		vi.useFakeTimers();
		const bytes = payload('old write');
		const open = storage.cacheOpen.getMockImplementation()!;
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		storage.cacheOpen.mockImplementationOnce(async (name) => {
			const cache = await open(name);
			return {
				...cache,
				put: async (key, response) => {
					started.resolve();
					await release.promise;
					await cache.put(key, response);
				}
			};
		});
		const controller = new AbortController();
		const reason = new Error('stop native write');
		const first = writePersistentRuntimeAsset({
			identity: identity(bytes),
			bytes,
			signal: controller.signal
		});
		const rejected = expect(first).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		const second = readPersistentRuntimeAsset({ identity: identity(bytes) });
		await vi.advanceTimersByTimeAsync(30_001);
		expect(await second).toBeUndefined();
		// Once a wait expired, later calls do not pay the full lock wait again for the same holder.
		let thirdSettled = false;
		const third = readPersistentRuntimeAsset({ identity: identity(bytes) }).finally(() => {
			thirdSettled = true;
		});
		await vi.advanceTimersByTimeAsync(3001);
		expect(thirdSettled).toBe(true);
		expect(await third).toBeUndefined();
		expect(storage.cacheOpen).toHaveBeenCalledTimes(1);
		release.resolve();
		const replacement = payload('new write');
		expect(
			await writePersistentRuntimeAsset({
				identity: identity(replacement),
				bytes: replacement
			})
		).toBe(true);
		expect(await readPersistentRuntimeAsset({ identity: identity(bytes) })).toBeUndefined();
		expect(await readPersistentRuntimeAsset({ identity: identity(replacement) })).toEqual(
			replacement
		);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({
			entries: 1,
			bytes: replacement.byteLength
		});
		expect([...storage.bodies.values()][0].size).toBe(1);
		// Acquiring the lock again restores the full wait for a busy holder.
		const held = storage.lockRequest(
			'wasm-idle-assets-v1:wasm-idle',
			{ signal: new AbortController().signal },
			() => new Promise<void>((resolve) => setTimeout(resolve, 5000))
		);
		const queued = readPersistentRuntimeAsset({ identity: identity(replacement) });
		await vi.advanceTimersByTimeAsync(5001);
		await held;
		expect(await queued).toEqual(replacement);
	});

	it('waits for another holder of the namespace lock instead of reporting a false miss', async () => {
		const bytes = payload('queued');
		await writePersistentRuntimeAsset({ identity: identity(bytes), bytes });
		vi.useFakeTimers();
		// Another tab or worker keeps the lock for longer than one operation's deadline.
		const held = storage.lockRequest(
			'wasm-idle-assets-v1:wasm-idle',
			{ signal: new AbortController().signal },
			() => new Promise<void>((resolve) => setTimeout(resolve, 5000))
		);
		const pending = readPersistentRuntimeAsset({ identity: identity(bytes) });
		await vi.advanceTimersByTimeAsync(5001);
		await held;
		expect(await pending).toEqual(bytes);
	});

	it('persists generated artifacts for a new backend and isolates exact configuration keys', async () => {
		const first = createRuntimeGeneratedAssetCacheBackend();
		const bytes = payload('a generated PCH');
		expect(await first.write('compiler+sysroot+headers+args:a', bytes)).toBe(true);
		bytes.fill(0);
		const reloaded = createRuntimeGeneratedAssetCacheBackend();
		expect(await reloaded.read('compiler+sysroot+headers+args:a')).toEqual(
			payload('a generated PCH')
		);
		expect(await reloaded.read('compiler+sysroot+headers+args:b')).toBeUndefined();
		const hit = (await reloaded.read('compiler+sysroot+headers+args:a'))!;
		hit.fill(0);
		expect(await reloaded.read('compiler+sysroot+headers+args:a')).toEqual(
			payload('a generated PCH')
		);
	});

	it('retains a generated body reused by a new version when its producer version is cleared', async () => {
		const first = createRuntimeGeneratedAssetCacheBackend({ version: 'v1' });
		const second = createRuntimeGeneratedAssetCacheBackend({ version: 'v2' });
		const bytes = payload('shared generated PCH');
		expect(await first.write('same-compiler-and-headers', bytes)).toBe(true);
		expect(await second.read('same-compiler-and-headers')).toEqual(bytes);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({
			entries: 1,
			versions: ['v1', 'v2']
		});
		await clearRuntimeAssetCache({ version: 'v1' });
		expect(await second.read('same-compiler-and-headers')).toEqual(bytes);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ entries: 1, versions: ['v2'] });
		await clearRuntimeAssetCache({ version: 'v2' });
		expect(await second.read('same-compiler-and-headers')).toBeUndefined();
	});

	it('applies shared LRU bounds and replaces or removes a rejected generated configuration', async () => {
		const policy = { maxBytes: 8, maxEntryBytes: 8, maxEntries: 2, storageReserveBytes: 0 };
		const downloaded = payload('123456');
		expect(
			await writePersistentRuntimeAsset({
				identity: identity(downloaded),
				bytes: downloaded,
				cache: policy
			})
		).toBe(true);
		const generated = createRuntimeGeneratedAssetCacheBackend(policy);
		expect(await generated.write('pch-a', payload('abcd'))).toBe(true);
		expect(
			await readPersistentRuntimeAsset({ identity: identity(downloaded), cache: policy })
		).toBeUndefined();
		expect(await generated.write('pch-a', payload('efghij'))).toBe(true);
		expect(await generated.read('pch-a')).toEqual(payload('efghij'));
		expect(await getRuntimeAssetCacheStats(policy)).toMatchObject({ entries: 1, bytes: 6 });
		await generated.remove('pch-a');
		expect(await generated.read('pch-a')).toBeUndefined();
		expect(await getRuntimeAssetCacheStats(policy)).toMatchObject({ entries: 0, bytes: 0 });
		expect(await generated.write('oversized', payload('123456789'))).toBe(false);
	});

	it('deletes corrupt generated bodies and treats unavailable storage and quota errors as misses', async () => {
		const generated = createRuntimeGeneratedAssetCacheBackend();
		expect(await generated.write('pch-a', payload('abcd'))).toBe(true);
		const bodies = [...storage.bodies.values()][0];
		const key = [...bodies.keys()][0];
		bodies.set(key, new Response(payload('evil')));
		expect(await generated.read('pch-a')).toBeUndefined();
		expect(bodies.size).toBe(0);
		const originalCache = await storage.cacheOpen('wasm-idle-assets-v1:wasm-idle');
		storage.cacheOpen.mockResolvedValue({
			...originalCache,
			put: async () => {
				throw new DOMException('full', 'QuotaExceededError');
			}
		});
		expect(await generated.write('pch-a', payload('abcd'))).toBe(false);
		expect(await generated.read('pch-a')).toBeUndefined();
		storage.databaseOpen.mockImplementation(() => {
			throw new Error('storage denied');
		});
		expect(await generated.read('pch-a')).toBeUndefined();
		expect(await generated.write('pch-a', payload('abcd'))).toBe(false);
	});

	it('honors disabled generated cache policies without accessing storage and isolates namespaces', async () => {
		configureRuntimeAssetCache(false);
		const disabled = createRuntimeGeneratedAssetCacheBackend({ maxBytes: 1024 });
		expect(await disabled.read('pch-a')).toBeUndefined();
		expect(await disabled.write('pch-a', payload('abcd'))).toBe(false);
		await disabled.remove('pch-a');
		expect(storage.databaseOpen).not.toHaveBeenCalled();
		expect(storage.cacheOpen).not.toHaveBeenCalled();
		const enabled = createRuntimeGeneratedAssetCacheBackend({
			enabled: true,
			namespace: 'pch-host'
		});
		expect(await enabled.write('pch-a', payload('abcd'))).toBe(true);
		expect(await enabled.read('pch-a')).toEqual(payload('abcd'));
		expect(
			await createRuntimeGeneratedAssetCacheBackend({
				enabled: true,
				namespace: 'other-host'
			}).read('pch-a')
		).toBeUndefined();
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

	it.each([
		{ sha256: '' },
		{ sha256: 'not-a-sha256' },
		{ url: '' },
		{ url: 'asset\0.wasm' },
		{ bytes: -1 },
		{ bytes: NaN },
		{ bytes: Infinity },
		{ bytes: 0.5 },
		{ bytes: Number.MAX_SAFE_INTEGER + 1 },
		{ version: '' },
		{ validationKey: 1 }
	])('rejects invalid integrity metadata before storage or download: %j', async (invalid) => {
		const bytes = payload('unversioned');
		const key = { ...identity(bytes), ...invalid } as RuntimePersistentAssetIdentity;
		const load = vi.fn(async () => bytes);
		for (const cache of [undefined, false] as const) {
			await expect(
				loadPersistentRuntimeAsset({ identity: key, cache, load })
			).rejects.toThrow(TypeError);
			await expect(readPersistentRuntimeAsset({ identity: key, cache })).rejects.toThrow(
				TypeError
			);
			await expect(
				writePersistentRuntimeAsset({ identity: key, bytes, cache })
			).rejects.toThrow(TypeError);
		}
		expect(load).not.toHaveBeenCalled();
		expect(storage.cacheOpen).not.toHaveBeenCalled();
		expect(storage.databaseOpen).not.toHaveBeenCalled();
		expect(storage.lockRequest).not.toHaveBeenCalled();
	});

	it.each(['disabled', 'unavailable'])(
		'still verifies downloaded bytes when caching is %s',
		async (mode) => {
			if (mode === 'disabled') configureRuntimeAssetCache(false);
			else vi.stubGlobal('caches', undefined);
			await expect(
				loadPersistentRuntimeAsset({
					identity: identity(payload('good')),
					load: async () => payload('evil')
				})
			).rejects.toThrow(/mismatch/);
		}
	);

	it('snapshots trusted metadata before an asynchronous download', async () => {
		const bytes = payload('good');
		const key = identity(bytes);
		await expect(
			loadPersistentRuntimeAsset({
				identity: key,
				cache: false,
				load: async () => {
					Object.assign(key, identity(payload('evil')));
					return bytes;
				}
			})
		).resolves.toEqual(bytes);
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

	it('drops one corrupt metadata record without disabling writes for the namespace', async () => {
		const kept = payload('kept');
		await writePersistentRuntimeAsset({ identity: identity(kept), bytes: kept });
		const metadata = storage.databases.get('wasm-idle-assets-v1:wasm-idle')!;
		const bodies = storage.bodies.get('wasm-idle-assets-v1:wasm-idle')!;
		const corrupt = identity(payload('corrupt')).sha256;
		metadata.set(corrupt, { sha256: corrupt, bytes: -1, lastUsed: 0, references: [] });
		bodies.set(
			`https://wasm-idle.invalid/.runtime-assets/wasm-idle/${corrupt}`,
			new Response(payload('corrupt'))
		);
		const next = payload('next');
		expect(await writePersistentRuntimeAsset({ identity: identity(next), bytes: next })).toBe(
			true
		);
		expect(await createRuntimeGeneratedAssetCacheBackend().write('pch', payload('pch'))).toBe(
			true
		);
		expect(metadata.has(corrupt)).toBe(false);
		expect(bodies.size).toBe(3);
		expect(await readPersistentRuntimeAsset({ identity: identity(kept) })).toEqual(kept);
		expect(await readPersistentRuntimeAsset({ identity: identity(next) })).toEqual(next);
		expect(await getRuntimeAssetCacheStats()).toMatchObject({ available: true, entries: 3 });
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
