import { verifyRuntimeAssetIntegrity } from './asset-integrity.js';
import { RUNTIME_ASSET_LOCK_VERSION } from './runtime-asset-lock.generated.js';

/** CacheStorage bodies and IndexedDB metadata share the host origin's storage quota. */
export type RuntimeAssetCacheOptions =
	| false
	| {
			enabled?: boolean;
			maxBytes?: number;
			maxEntryBytes?: number;
			maxEntries?: number;
			storageReserveBytes?: number;
			eviction?: 'lru' | 'none';
			namespace?: string;
			version?: string;
	  };

export interface ResolvedRuntimeAssetCacheOptions {
	enabled: boolean;
	maxBytes: number;
	maxEntryBytes: number;
	maxEntries: number;
	storageReserveBytes: number;
	eviction: 'lru' | 'none';
	namespace: string;
	version: string;
}

export interface RuntimePersistentAssetIdentity {
	url: string;
	sha256: string;
	bytes?: number;
	version?: string;
	/** A digest of caller-specific URL/redirect/MIME validation rules, when those affect eligibility. */
	validationKey?: string;
}

export interface RuntimePersistentAssetRequest {
	identity: RuntimePersistentAssetIdentity;
	cache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
}

/** Structural producer contract: no dependency on Core is required in nested runtime Workers. */
export interface RuntimeAssetCacheBackendIdentity {
	readonly url: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly validationKey?: string;
}

export interface RuntimeAssetCacheBackend {
	read(
		identity: RuntimeAssetCacheBackendIdentity,
		signal?: AbortSignal
	): Promise<Uint8Array | undefined>;
	write(
		identity: RuntimeAssetCacheBackendIdentity,
		bytes: Uint8Array,
		signal?: AbortSignal
	): Promise<boolean>;
}

/** Capture a policy once per operation; later global changes cannot alter in-flight cache decisions. */
export function createRuntimeAssetCacheBackend(
	cache?: RuntimeAssetCacheOptions
): RuntimeAssetCacheBackend {
	const policy = Object.freeze(resolveRuntimeAssetCacheOptions(cache));
	const snapshot = (
		identity: RuntimeAssetCacheBackendIdentity
	): RuntimePersistentAssetIdentity => ({
		url: identity.url,
		sha256: identity.sha256,
		bytes: identity.bytes,
		validationKey: identity.validationKey
	});
	return Object.freeze({
		read: (identity: RuntimeAssetCacheBackendIdentity, signal?: AbortSignal) =>
			readPersistentRuntimeAsset({ identity: snapshot(identity), cache: policy, signal }),
		write: (
			identity: RuntimeAssetCacheBackendIdentity,
			bytes: Uint8Array,
			signal?: AbortSignal
		) =>
			writePersistentRuntimeAsset({
				identity: snapshot(identity),
				bytes,
				cache: policy,
				signal
			})
	});
}

export interface RuntimeAssetCacheStats {
	available: boolean;
	entries: number;
	bytes: number;
	maxBytes: number;
	versions: string[];
	quotaBytes?: number;
	usageBytes?: number;
}

interface AssetRecord {
	sha256: string;
	bytes: number;
	lastUsed: number;
	references: { version: string; url: string; validationKey?: string }[];
}

const DEFAULTS: Readonly<ResolvedRuntimeAssetCacheOptions> = Object.freeze({
	enabled: true,
	maxBytes: 512 * 1024 * 1024,
	maxEntryBytes: 512 * 1024 * 1024,
	maxEntries: 4096,
	storageReserveBytes: 64 * 1024 * 1024,
	eviction: 'lru',
	namespace: 'wasm-idle',
	version: RUNTIME_ASSET_LOCK_VERSION
});
const STORAGE_TIMEOUT_MS = 3000;
let globalOptions: RuntimeAssetCacheOptions = {};

/** Replace global defaults. Pass {} to reset, or false to disable all persistent access. */
export function configureRuntimeAssetCache(options: RuntimeAssetCacheOptions): void {
	const next = options === false ? false : { ...options };
	resolveOptions([next]);
	globalOptions = next;
}

export function getRuntimeAssetCacheOptions(): ResolvedRuntimeAssetCacheOptions {
	return resolveOptions([globalOptions]);
}

/** Later layers override earlier ones; only enabled:true re-enables an explicitly disabled cache. */
export function resolveRuntimeAssetCacheOptions(
	...layers: (RuntimeAssetCacheOptions | undefined)[]
): ResolvedRuntimeAssetCacheOptions {
	return resolveOptions([globalOptions, ...layers]);
}

function resolveOptions(
	layers: (RuntimeAssetCacheOptions | undefined)[]
): ResolvedRuntimeAssetCacheOptions {
	const result = { ...DEFAULTS };
	for (const layer of layers) {
		if (layer === false) result.enabled = false;
		else if (layer) {
			for (const [key, value] of Object.entries(layer)) {
				if (value !== undefined && Object.hasOwn(DEFAULTS, key)) {
					(result as unknown as Record<string, unknown>)[key] = value;
				}
			}
		}
	}
	for (const key of ['maxBytes', 'maxEntryBytes', 'maxEntries', 'storageReserveBytes'] as const) {
		if (!Number.isSafeInteger(result[key]) || result[key] < 0)
			throw new TypeError(`Invalid asset cache ${key}`);
	}
	if (typeof result.enabled !== 'boolean' || !['lru', 'none'].includes(result.eviction)) {
		throw new TypeError('Invalid asset cache policy');
	}
	if (typeof result.namespace !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/u.test(result.namespace))
		throw new TypeError('Invalid asset cache namespace');
	if (typeof result.version !== 'string' || !result.version || result.version.length > 256) {
		throw new TypeError('Invalid asset cache version');
	}
	return result;
}

function checkAbort(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason !== undefined
			? signal.reason
			: new DOMException('Aborted', 'AbortError');
	}
}

function validIdentity(identity: RuntimePersistentAssetIdentity): boolean {
	return (
		typeof identity.url === 'string' &&
		identity.url.length > 0 &&
		identity.url.length <= 8192 &&
		/^[a-f0-9]{64}$/u.test(identity.sha256) &&
		(identity.bytes === undefined ||
			(Number.isSafeInteger(identity.bytes) && identity.bytes >= 0)) &&
		(identity.validationKey === undefined ||
			(typeof identity.validationKey === 'string' &&
				identity.validationKey.length <= 8192)) &&
		(identity.version === undefined ||
			(typeof identity.version === 'string' &&
				identity.version.length > 0 &&
				identity.version.length <= 256))
	);
}

function storageName(options: ResolvedRuntimeAssetCacheOptions): string {
	return `wasm-idle-assets-v1:${options.namespace}`;
}

function bodyKey(options: ResolvedRuntimeAssetCacheOptions, sha256: string): string {
	return `https://wasm-idle.invalid/.runtime-assets/${options.namespace}/${sha256}`;
}

function canStore(options: ResolvedRuntimeAssetCacheOptions): boolean {
	// Without a cross-tab lock, do not perform quota-sensitive writes or garbage collection.
	try {
		return (
			options.enabled &&
			options.maxBytes > 0 &&
			options.maxEntryBytes > 0 &&
			options.maxEntries > 0 &&
			typeof globalThis.caches !== 'undefined' &&
			typeof globalThis.indexedDB !== 'undefined' &&
			typeof globalThis.navigator?.locks?.request === 'function'
		);
	} catch {
		return false;
	}
}

function openDatabase(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let finished = false;
		const request = indexedDB.open(name, 1);
		const timer = setTimeout(() => {
			finished = true;
			reject(new Error('Asset cache database open timed out'));
		}, STORAGE_TIMEOUT_MS);
		request.onupgradeneeded = () =>
			request.result.createObjectStore('assets', { keyPath: 'sha256' });
		request.onsuccess = () => {
			clearTimeout(timer);
			if (finished) request.result.close();
			else {
				finished = true;
				resolve(request.result);
			}
		};
		request.onerror = () => {
			clearTimeout(timer);
			finished = true;
			reject(request.error);
		};
	});
}

function transact<T>(
	db: IDBDatabase,
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction('assets', mode);
		const timer = setTimeout(() => {
			try {
				transaction.abort();
			} catch {
				/* The transaction may have just completed. */
			}
		}, STORAGE_TIMEOUT_MS);
		let request: IDBRequest<T>;
		try {
			request = operation(transaction.objectStore('assets'));
		} catch (error) {
			clearTimeout(timer);
			try {
				transaction.abort();
			} catch {
				/* Already inactive. */
			}
			reject(error);
			return;
		}
		transaction.oncomplete = () => {
			clearTimeout(timer);
			resolve(request.result);
		};
		transaction.onabort = transaction.onerror = () => {
			clearTimeout(timer);
			reject(transaction.error ?? new Error('Asset cache database transaction failed'));
		};
	});
}

async function withStorage<T>(
	options: ResolvedRuntimeAssetCacheOptions,
	signal: AbortSignal | undefined,
	operation: (cache: Cache, db: IDBDatabase) => Promise<T>
): Promise<T | undefined> {
	checkAbort(signal);
	if (!canStore(options)) return undefined;
	const lockAbort = new AbortController();
	const abortLock = () => lockAbort.abort(signal?.reason);
	signal?.addEventListener('abort', abortLock, { once: true });
	const timer = setTimeout(() => lockAbort.abort(), STORAGE_TIMEOUT_MS);
	try {
		return await navigator.locks.request(
			storageName(options),
			{ signal: lockAbort.signal },
			async () => {
				clearTimeout(timer);
				checkAbort(signal);
				const db = await openDatabase(storageName(options));
				try {
					const cache = await caches.open(storageName(options));
					checkAbort(signal);
					const result = await operation(cache, db);
					checkAbort(signal);
					return result;
				} finally {
					db.close();
				}
			}
		);
	} catch {
		// Storage denial, quota exhaustion, unsupported APIs and lock timeouts are cache misses.
		checkAbort(signal);
		return undefined;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abortLock);
	}
}

function addReference(
	record: AssetRecord,
	identity: RuntimePersistentAssetIdentity,
	options: ResolvedRuntimeAssetCacheOptions
): void {
	const version = identity.version ?? options.version;
	if (
		!record.references.some(
			(reference) =>
				reference.version === version &&
				reference.url === identity.url &&
				reference.validationKey === identity.validationKey
		)
	) {
		// Bound metadata independently of body sizes. Dropping a reference is never safe for version GC.
		if (record.references.length >= 4096)
			throw new Error('Asset cache reference limit reached');
		record.references.push({
			version,
			url: identity.url,
			validationKey: identity.validationKey
		});
	}
	record.lastUsed = Date.now();
}

function validRecord(value: AssetRecord): boolean {
	return (
		!!value &&
		/^[a-f0-9]{64}$/u.test(value.sha256) &&
		Number.isSafeInteger(value.bytes) &&
		value.bytes >= 0 &&
		Number.isFinite(value.lastUsed) &&
		Array.isArray(value.references) &&
		value.references.length <= 4096 &&
		value.references.every(
			(reference) =>
				typeof reference?.version === 'string' &&
				typeof reference.url === 'string' &&
				(reference.validationKey === undefined ||
					typeof reference.validationKey === 'string')
		)
	);
}

async function records(db: IDBDatabase): Promise<AssetRecord[]> {
	const result = await transact<AssetRecord[]>(db, 'readonly', (store) => store.getAll());
	if (!result.every(validRecord)) throw new Error('Invalid asset cache metadata');
	return result;
}

async function removeRecord(
	cache: Cache,
	db: IDBDatabase,
	options: ResolvedRuntimeAssetCacheOptions,
	record: AssetRecord
): Promise<void> {
	await cache.delete(bodyKey(options, record.sha256));
	await transact(db, 'readwrite', (store) => store.delete(record.sha256));
}

async function estimateStorage(): Promise<StorageEstimate | undefined> {
	try {
		return await navigator.storage?.estimate?.();
	} catch {
		return undefined;
	}
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new Error('Cached asset exceeds expected size');
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function effectiveBudget(
	options: ResolvedRuntimeAssetCacheOptions,
	existingBytes: number
): Promise<number> {
	const estimate = await estimateStorage();
	if (
		typeof estimate?.quota !== 'number' ||
		typeof estimate.usage !== 'number' ||
		!Number.isFinite(estimate.quota) ||
		!Number.isFinite(estimate.usage)
	)
		return options.maxBytes;
	return Math.max(
		0,
		Math.min(
			options.maxBytes,
			estimate.quota - estimate.usage + existingBytes - options.storageReserveBytes
		)
	);
}

async function makeRoom(
	cache: Cache,
	db: IDBDatabase,
	options: ResolvedRuntimeAssetCacheOptions,
	all: AssetRecord[],
	incomingBytes: number,
	incomingEntries: number,
	keepHash?: string
): Promise<boolean> {
	let bytes = all.reduce((sum, record) => sum + record.bytes, 0);
	let count = all.length;
	const budget = await effectiveBudget(options, bytes);
	if (incomingBytes > budget || incomingEntries > options.maxEntries) return false;
	const fits = () =>
		bytes + incomingBytes <= budget && count + incomingEntries <= options.maxEntries;
	if (fits()) return true;
	if (options.eviction === 'none') return false;
	for (const record of [...all].sort(
		(a, b) => a.lastUsed - b.lastUsed || a.sha256.localeCompare(b.sha256)
	)) {
		if (record.sha256 === keepHash) continue;
		await removeRecord(cache, db, options, record);
		bytes -= record.bytes;
		count--;
		if (fits()) return true;
	}
	return fits();
}

/** Only an expected digest supplied by a trusted release/custom manifest can yield a hit. */
export async function readPersistentRuntimeAsset(
	request: RuntimePersistentAssetRequest
): Promise<Uint8Array | undefined> {
	const options = resolveRuntimeAssetCacheOptions(request.cache);
	checkAbort(request.signal);
	if (
		!options.enabled ||
		!validIdentity(request.identity) ||
		(request.identity.bytes !== undefined &&
			request.identity.bytes > Math.min(options.maxBytes, options.maxEntryBytes))
	)
		return undefined;
	return withStorage(options, request.signal, async (cache, db) => {
		const record = await transact<AssetRecord | undefined>(db, 'readonly', (store) =>
			store.get(request.identity.sha256)
		);
		if (
			!record ||
			!validRecord(record) ||
			record.sha256 !== request.identity.sha256 ||
			record.bytes > Math.min(options.maxBytes, options.maxEntryBytes) ||
			(request.identity.bytes !== undefined && request.identity.bytes !== record.bytes)
		)
			return undefined;
		if (
			request.identity.validationKey !== undefined &&
			!record.references.some(
				(reference) =>
					reference.url === request.identity.url &&
					reference.validationKey === request.identity.validationKey
			)
		)
			return undefined;
		const response = await cache.match(bodyKey(options, request.identity.sha256));
		if (!response) {
			await transact(db, 'readwrite', (store) => store.delete(record.sha256));
			return undefined;
		}
		let bytes: Uint8Array;
		try {
			bytes = await readBoundedBody(
				response,
				Math.min(record.bytes, options.maxBytes, options.maxEntryBytes)
			);
			await verifyRuntimeAssetIntegrity({
				asset: request.identity.url,
				bytes,
				expected: {
					sha256: request.identity.sha256,
					bytes: request.identity.bytes ?? record.bytes
				}
			});
		} catch {
			await removeRecord(cache, db, options, record);
			return undefined;
		}
		checkAbort(request.signal);
		try {
			addReference(record, request.identity, options);
			await transact(db, 'readwrite', (store) => store.put(record));
		} catch {
			// A bookkeeping/quota failure must not hide already verified offline bytes.
		}
		return bytes;
	});
}

/** Verify before publishing. Storage failures return false; integrity/abort failures reject. */
export async function writePersistentRuntimeAsset(
	request: RuntimePersistentAssetRequest & { bytes: Uint8Array }
): Promise<boolean> {
	const options = resolveRuntimeAssetCacheOptions(request.cache);
	checkAbort(request.signal);
	if (
		!options.enabled ||
		!validIdentity(request.identity) ||
		!canStore(options) ||
		request.bytes.byteLength > Math.min(options.maxBytes, options.maxEntryBytes)
	)
		return false;
	const bytes = Uint8Array.from(request.bytes);
	await verifyRuntimeAssetIntegrity({
		asset: request.identity.url,
		bytes,
		expected: { sha256: request.identity.sha256, bytes: request.identity.bytes }
	});
	checkAbort(request.signal);
	return (
		(await withStorage(options, request.signal, async (cache, db) => {
			const all = await records(db);
			// Recover bodies orphaned by a browser crash before the metadata commit.
			const known = new Set(all.map((record) => bodyKey(options, record.sha256)));
			for (const key of await cache.keys()) if (!known.has(key.url)) await cache.delete(key);
			const existing = all.find((record) => record.sha256 === request.identity.sha256);
			const record: AssetRecord = existing ?? {
				sha256: request.identity.sha256,
				bytes: bytes.byteLength,
				lastUsed: 0,
				references: []
			};
			if (record.bytes !== bytes.byteLength) return false;
			addReference(record, request.identity, options);
			if (
				!(await makeRoom(
					cache,
					db,
					options,
					all,
					existing ? 0 : bytes.byteLength,
					existing ? 0 : 1,
					record.sha256
				))
			)
				return false;
			checkAbort(request.signal);
			await cache.put(
				bodyKey(options, record.sha256),
				new Response(bytes, {
					headers: {
						'Content-Type': 'application/octet-stream',
						'Content-Length': String(bytes.byteLength)
					}
				})
			);
			try {
				await transact(db, 'readwrite', (store) => store.put(record));
			} catch (error) {
				// Do not leave unaccounted large bodies behind after a metadata/quota failure.
				if (!existing) await cache.delete(bodyKey(options, record.sha256));
				throw error;
			}
			return true;
		})) ?? false
	);
}

/** The load callback's own network, validation and cancellation errors are never swallowed. */
export async function loadPersistentRuntimeAsset(
	request: RuntimePersistentAssetRequest & { load: () => Promise<Uint8Array> }
): Promise<Uint8Array> {
	const cache = resolveRuntimeAssetCacheOptions(request.cache);
	const hit = await readPersistentRuntimeAsset({ ...request, cache });
	if (hit) return hit;
	checkAbort(request.signal);
	const bytes = Uint8Array.from(await request.load());
	checkAbort(request.signal);
	// Validate downloads even if the user disabled caching or storage is unavailable.
	if (validIdentity(request.identity)) {
		await verifyRuntimeAssetIntegrity({
			asset: request.identity.url,
			bytes,
			expected: { sha256: request.identity.sha256, bytes: request.identity.bytes }
		});
	}
	await writePersistentRuntimeAsset({ ...request, cache, bytes });
	checkAbort(request.signal);
	return bytes;
}

export async function getRuntimeAssetCacheStats(
	cache?: RuntimeAssetCacheOptions
): Promise<RuntimeAssetCacheStats> {
	const options = resolveRuntimeAssetCacheOptions(cache);
	const empty: RuntimeAssetCacheStats = {
		available: false,
		entries: 0,
		bytes: 0,
		maxBytes: options.maxBytes,
		versions: []
	};
	return (
		(await withStorage(options, undefined, async (_cache, db) => {
			const all = await records(db);
			const estimate = await estimateStorage();
			return {
				available: true,
				entries: all.length,
				bytes: all.reduce((sum, record) => sum + record.bytes, 0),
				maxBytes: options.maxBytes,
				versions: [
					...new Set(
						all.flatMap((record) =>
							record.references.map((reference) => reference.version)
						)
					)
				].sort(),
				quotaBytes: estimate?.quota,
				usageBytes: estimate?.usage
			};
		})) ?? empty
	);
}

/** Clear only this library's selected namespace; a version clear preserves other versions' bodies. */
export async function clearRuntimeAssetCache(
	request: { cache?: RuntimeAssetCacheOptions; version?: string } = {}
): Promise<void> {
	const options = resolveRuntimeAssetCacheOptions(request.cache);
	await withStorage(options, undefined, async (cache, db) => {
		if (request.version === undefined) {
			// This reset also works if metadata itself is corrupt; never inspect another namespace.
			for (const key of await cache.keys()) await cache.delete(key);
			await transact(db, 'readwrite', (store) => store.clear());
			return;
		}
		for (const record of await records(db)) {
			record.references = record.references.filter(
				(reference) => reference.version !== request.version
			);
			if (!record.references.length) await removeRecord(cache, db, options, record);
			else await transact(db, 'readwrite', (store) => store.put(record));
		}
	});
}

export async function pruneRuntimeAssetCache(cache?: RuntimeAssetCacheOptions): Promise<void> {
	const options = resolveRuntimeAssetCacheOptions(cache);
	await withStorage(options, undefined, async (storage, db) => {
		const all = await records(db);
		const known = new Set(all.map((record) => bodyKey(options, record.sha256)));
		for (const key of await storage.keys()) if (!known.has(key.url)) await storage.delete(key);
		await makeRoom(storage, db, options, all, 0, 0);
	});
}

/** Explicit opt-in only: ordinary loads never ask the browser for persistent-storage permission. */
export async function requestRuntimeAssetCachePersistence(
	cache?: RuntimeAssetCacheOptions
): Promise<boolean> {
	if (!resolveRuntimeAssetCacheOptions(cache).enabled) return false;
	try {
		return (await globalThis.navigator?.storage?.persist?.()) ?? false;
	} catch {
		return false;
	}
}
