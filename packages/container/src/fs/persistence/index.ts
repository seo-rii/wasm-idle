import { MemoryFileSystem } from '../memory.js';
import type { FileSystemSnapshot, MemoryFileSystemOptions, SnapshotEntry } from '../types.js';

export type PersistentWorkspaceErrorCode = 'INVALID_ARGUMENT' | 'UNSUPPORTED' | 'BUSY' | 'CORRUPT' | 'STORAGE' | 'DISPOSED' | 'RESOURCE_LIMIT';
export class PersistentWorkspaceError extends Error {
  override readonly name = 'PersistentWorkspaceError';
  constructor(readonly code: PersistentWorkspaceErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}
export type PersistenceFaultPoint = 'after-blob-write' | 'before-root-publish' | 'after-root-publish' | 'before-garbage-delete';
export interface OpenPersistentWorkspaceOptions extends MemoryFileSystemOptions {
  readonly id: string;
  readonly maxMetadataBytes?: number;
  /** Deterministic crash-point injection for tests; never receives file content. */
  readonly fault?: (point: PersistenceFaultPoint) => void | Promise<void>;
}
export interface PersistentWorkspaceInspection {
  readonly id: string;
  readonly state: 'new' | 'saved' | 'dirty' | 'saving' | 'recovered' | 'error' | 'disposed';
  readonly generation: number;
  readonly committedGeneration: number | null;
  readonly committedSequence: number | null;
  readonly dirty: boolean;
  readonly recovered: boolean;
  readonly maintenance: boolean;
  readonly lastError?: PersistentWorkspaceErrorCode;
}
export interface PersistentWorkspaceGarbageCollectionOptions {
  /** Full directory enumeration is required before deletion; 1..65536, default 4096. */
  readonly maxScannedEntries?: number;
  /** 0..4096, default 128. Zero performs validation and a bounded scan without deletion. */
  readonly maxDeletedBlobs?: number;
  /** 0..1 GiB, default 64 MiB. A larger candidate remains untouched. */
  readonly maxDeletedBytes?: number;
  /** Unique retained content validated before any deletion; 1..1 GiB, default 128 MiB. */
  readonly maxReferencedBytes?: number;
}
export interface PersistentWorkspaceGarbageCollectionResult {
  readonly retainedRoots: number;
  readonly referencedBlobs: number;
  readonly scannedEntries: number;
  readonly candidateBlobs: number;
  readonly skippedEntries: number;
  readonly deletedBlobs: number;
  readonly deletedBytes: number;
  /** False means enumeration exceeded its budget; in that case nothing was deleted. */
  readonly scanComplete: boolean;
  /** False means a scan or deletion budget left candidates for an explicit later call. */
  readonly complete: boolean;
}
export interface PersistentWorkspace {
  readonly fs: MemoryFileSystem;
  flush(): Promise<PersistentWorkspaceInspection>;
  inspect(): PersistentWorkspaceInspection;
  /** Includes unsaved /workspace content and inode identities, without toolchain/cache data. */
  exportSnapshot(): FileSystemSnapshot;
  /** Explicit owner-locked maintenance; never runs automatically on flush or quota failure. */
  collectGarbage(options?: PersistentWorkspaceGarbageCollectionOptions): Promise<PersistentWorkspaceGarbageCollectionResult>;
  /** Does not implicitly flush, delete files, or touch runtime asset caches. */
  dispose(): Promise<void>;
}

interface StoredEntry extends Omit<SnapshotEntry, 'data'> { readonly blob?: { readonly sha256: string; readonly bytes: number }; }
interface RootManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sequence: number;
  readonly generation: number;
  readonly nextInode: number;
  readonly entries: readonly StoredEntry[];
}
interface RootRecord { readonly sequence: number; readonly manifest: string; readonly sha256: string; }
const namespace = 'wasm-idle-workspaces-v1';
const encoder = new TextEncoder();
const digestPattern = /^[a-f0-9]{64}$/u;
const dbName = (id: string) => `${namespace}:${id}`;
const hash = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  return Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('');
};
const corrupt = (message: string): never => { throw new PersistentWorkspaceError('CORRUPT', message); };

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (blocked) { request.transaction?.abort(); return; }
      request.result.createObjectStore('roots', { keyPath: 'sequence' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new PersistentWorkspaceError('BUSY', 'Workspace database upgrade is blocked')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function readRoots(db: IDBDatabase): Promise<RootRecord[]> {
  return new Promise((resolve, reject) => {
    const result: RootRecord[] = [];
    const transaction = db.transaction('roots', 'readonly');
    const request = transaction.objectStore('roots').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (result.length === 8) { transaction.abort(); return; }
      result.push(cursor.value as RootRecord); cursor.continue();
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new PersistentWorkspaceError('CORRUPT', 'Workspace journal is invalid or exceeds its root limit', { cause: transaction.error }));
  });
}

function publishRoot(db: IDBDatabase, record: RootRecord, previous?: RootRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('roots', 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore('roots');
    store.clear();
    if (previous) store.put(previous);
    store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Root publication aborted'));
  });
}

/** An owner holds this Web Lock until dispose/reload; if unavailable, no writer is admitted. */
async function ownWorkspace(id: string): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let acquired!: () => void, rejected!: (error: unknown) => void;
  const ownership = new Promise<void>((resolve, reject) => { acquired = resolve; rejected = reject; });
  const lifetime = navigator.locks.request(dbName(id), { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) { rejected(new PersistentWorkspaceError('BUSY', 'Workspace already has a writer')); return; }
    acquired(); await held;
  });
  void lifetime.catch(rejected);
  await ownership;
  return async () => { release(); await lifetime; };
}

/** Independent persistence owner. No automatic Container integration or autosave is implied. */
export async function openPersistentWorkspace(options: OpenPersistentWorkspaceOptions): Promise<PersistentWorkspace> {
  if (!options || typeof options.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(options.id)) {
    throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Workspace id must be a bounded storage-safe identifier');
  }
  const id = options.id;
  const maxMetadataBytes = options.maxMetadataBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1024 || maxMetadataBytes > 64 * 1024 * 1024) {
    throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Invalid workspace metadata budget');
  }
  const fault = options.fault;
  const policy = Object.freeze({ maxBytes: options.maxBytes, maxInodes: options.maxInodes });
  let fs = new MemoryFileSystem(policy);
  const base = fs.exportSnapshot();
  if (!globalThis.isSecureContext || !globalThis.navigator?.locks?.request || !globalThis.navigator?.storage?.getDirectory || !globalThis.indexedDB || !globalThis.crypto?.subtle) {
    throw new PersistentWorkspaceError('UNSUPPORTED', 'Persistent workspace requires a secure context, OPFS, IndexedDB, Web Locks and Web Crypto');
  }
  const release = await ownWorkspace(id);
  let db: IDBDatabase | undefined;
  try {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle(namespace, { create: true });
    const directory = await parent.getDirectoryHandle(id, { create: true });
    db = await openDatabase(dbName(id));
    const database = db;
    let lastRoot: RootRecord | undefined;
    let committedGeneration: number | null = null;
    let sequence = 0;
    let recovered = false;
    let lastError: PersistentWorkspaceErrorCode | undefined;
    let maintenanceError: PersistentWorkspaceErrorCode | undefined;
    let disposed = false;
    let disposal: Promise<void> | undefined;
    let pending: Promise<PersistentWorkspaceInspection> | undefined;
    let maintenance: Promise<PersistentWorkspaceGarbageCollectionResult> | undefined;

    const workspaceSnapshot = (): FileSystemSnapshot => {
      const snapshot = fs.exportSnapshot();
      const workspace = snapshot.entries.filter((entry) => entry.path === '/workspace' || entry.path.startsWith('/workspace/'));
      return {
        generation: snapshot.generation, nextInode: snapshot.nextInode, mounts: base.mounts,
        entries: [...base.entries.filter((entry) => entry.path !== '/workspace'), ...workspace]
      };
    };
    const readBlob = async (identity: { sha256: string; bytes: number }): Promise<Uint8Array> => {
      if (!identity || !digestPattern.test(identity.sha256) || !Number.isSafeInteger(identity.bytes) || identity.bytes < 0 || identity.bytes > fs.maxBytes) corrupt('Invalid workspace blob reference');
      const handle = await directory.getFileHandle(identity.sha256);
      const file = await handle.getFile();
      if (file.size !== identity.bytes) corrupt('Workspace blob size does not match its root');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (await hash(bytes) !== identity.sha256) corrupt('Workspace blob digest does not match its root');
      return bytes;
    };
    const decodeRoot = async (record: RootRecord) => {
      if (!record || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || typeof record.manifest !== 'string' || record.manifest.length > maxMetadataBytes || !digestPattern.test(record.sha256)) corrupt('Malformed workspace root record');
      const manifestBytes = encoder.encode(record.manifest);
      if (manifestBytes.length > maxMetadataBytes || await hash(manifestBytes) !== record.sha256) corrupt('Workspace root digest does not match');
      let value: RootManifest;
      try { value = JSON.parse(record.manifest) as RootManifest; } catch { return corrupt('Workspace root is not JSON'); }
      if (!value || typeof value !== 'object') corrupt('Workspace root must be an object');
      if (value.schemaVersion !== 1 || value.id !== id || value.sequence !== record.sequence || !Array.isArray(value.entries) || value.entries.length > fs.maxInodes) corrupt('Workspace root belongs to an unsupported profile');
      let total = 0;
      const records: SnapshotEntry[] = value.entries.map((entry) => {
        if (!entry || typeof entry.path !== 'string' || !(entry.path === '/workspace' || entry.path.startsWith('/workspace/'))) corrupt('Workspace root references a non-user mount');
        if (entry.type === 'file') {
          const blob = entry.blob;
          if (!blob || typeof blob.sha256 !== 'string' || !digestPattern.test(blob.sha256) || !Number.isSafeInteger(blob.bytes) || blob.bytes < 0) return corrupt('Invalid workspace file reference');
          total += blob.bytes;
          if (total > fs.maxBytes) corrupt('Workspace root exceeds its byte budget');
        } else if (entry.blob !== undefined) corrupt('Non-file entry references blob data');
        return { inode: entry.inode, path: entry.path, type: entry.type, mode: entry.mode, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs,
          ...(entry.type === 'file' ? { data: new Uint8Array() } : {}),
          ...(entry.type === 'symlink' ? { target: entry.target } : {}) };
      });
      const snapshot = {
        generation: value.generation, nextInode: value.nextInode, mounts: base.mounts,
        entries: [...base.entries.filter((entry) => entry.path !== '/workspace'), ...records]
      };
      // Check namespace, IDs, directory shape and metadata quotas before opening any blob.
      MemoryFileSystem.fromSnapshot(snapshot, policy);
      return { value, records, snapshot };
    };
    const restore = async (record: RootRecord): Promise<MemoryFileSystem> => {
      const { value, records, snapshot } = await decodeRoot(record);
      for (let i = 0; i < value.entries.length; i++) {
        const entry = value.entries[i]!;
        if (entry.type === 'file') records[i] = { ...records[i]!, data: await readBlob(entry.blob!) };
      }
      return MemoryFileSystem.fromSnapshot({ ...snapshot, entries: [...base.entries.filter((entry) => entry.path !== '/workspace'), ...records] }, policy);
    };

    const roots = await readRoots(database);
    let retainedJournal = roots;
    for (const record of roots) {
      if (Number.isSafeInteger(record?.sequence) && record.sequence > sequence) sequence = record.sequence;
      try {
        const restored = await restore(record);
        if (!lastRoot) { fs = restored; lastRoot = record; committedGeneration = fs.generation; }
      } catch { if (!lastRoot) recovered = true; }
      // Only the latest valid root is loaded; earlier journal roots remain unmodified.
      if (lastRoot) break;
    }
    if (roots.length && !lastRoot) corrupt('No committed workspace root can be recovered; stored data was preserved');
    if (!Number.isSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) corrupt('Workspace journal sequence is exhausted');

    const inspect = (): PersistentWorkspaceInspection => {
      const dirty = committedGeneration === null || fs.generation !== committedGeneration;
      return Object.freeze({ id,
        state: disposed ? 'disposed' : pending ? 'saving' : lastError || maintenanceError ? 'error' : recovered ? 'recovered' : committedGeneration === null ? 'new' : dirty ? 'dirty' : 'saved',
        generation: fs.generation, committedGeneration, committedSequence: lastRoot?.sequence ?? null,
        dirty, recovered, maintenance: maintenance !== undefined, ...(lastError || maintenanceError ? { lastError: lastError ?? maintenanceError } : {}) });
    };
    const checkOpen = () => { if (disposed) throw new PersistentWorkspaceError('DISPOSED', 'Workspace persistence owner has been disposed'); };
    return Object.freeze({
      fs,
      inspect,
      exportSnapshot() { return workspaceSnapshot(); },
      async flush() {
        checkOpen();
        if (pending || maintenance) return Promise.reject(new PersistentWorkspaceError('BUSY', 'Workspace storage work is already in progress'));
        if (sequence >= Number.MAX_SAFE_INTEGER - 1) return Promise.reject(new PersistentWorkspaceError('STORAGE', 'Workspace journal sequence exhausted'));
        const snapshot = workspaceSnapshot();
        const next = sequence + 1;
        lastError = undefined;
        const persist = async () => {
          const entries: StoredEntry[] = [];
          for (const entry of snapshot.entries) {
            if (!(entry.path === '/workspace' || entry.path.startsWith('/workspace/'))) continue;
            const { data, ...metadata } = entry;
            if (entry.type !== 'file') { entries.push(metadata); continue; }
            const blob = { sha256: await hash(data!), bytes: data!.length };
            let valid = false;
            try { await readBlob(blob); valid = true; } catch { /* Write and verify the current, owned file bytes. */ }
            if (!valid) {
              const handle = await directory.getFileHandle(blob.sha256, { create: true });
              const writer = await handle.createWritable();
              try { await writer.write(Uint8Array.from(data!)); await writer.close(); }
              catch (error) { try { await writer.abort(); } catch {} throw error; }
              await readBlob(blob);
              await fault?.('after-blob-write');
            }
            entries.push({ ...metadata, blob });
          }
          const manifest = JSON.stringify({ schemaVersion: 1, id, sequence: next, generation: snapshot.generation, nextInode: snapshot.nextInode, entries } satisfies RootManifest);
          const bytes = encoder.encode(manifest);
          if (bytes.length > maxMetadataBytes) throw new PersistentWorkspaceError('STORAGE', 'Workspace root exceeds its metadata budget');
          const record: RootRecord = { sequence: next, manifest, sha256: await hash(bytes) };
          await fault?.('before-root-publish');
          await publishRoot(database, record, lastRoot);
          retainedJournal = lastRoot ? [record, lastRoot] : [record];
          lastRoot = record; committedGeneration = snapshot.generation; sequence = next; recovered = false;
          await fault?.('after-root-publish');
        };
        pending = persist().then(() => { pending = undefined; return inspect(); }, (cause: unknown) => {
          pending = undefined;
          lastError = cause instanceof PersistentWorkspaceError ? cause.code : 'STORAGE';
          throw cause instanceof PersistentWorkspaceError ? cause : new PersistentWorkspaceError('STORAGE', 'Workspace flush failed; inspect the committed generation and export unsaved data', { cause });
        });
        return pending;
      },
      async collectGarbage(settings: PersistentWorkspaceGarbageCollectionOptions = {}) {
        checkOpen();
        if (pending || maintenance) throw new PersistentWorkspaceError('BUSY', 'Workspace storage work is already in progress');
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Invalid maintenance budgets');
        const maxScannedEntries = settings.maxScannedEntries ?? 4096;
        const maxDeletedBlobs = settings.maxDeletedBlobs ?? 128;
        const maxDeletedBytes = settings.maxDeletedBytes ?? 64 * 1024 * 1024;
        const maxReferencedBytes = settings.maxReferencedBytes ?? 128 * 1024 * 1024;
        for (const [value, minimum, maximum] of [[maxScannedEntries, 1, 65536], [maxDeletedBlobs, 0, 4096],
          [maxDeletedBytes, 0, 1024 * 1024 * 1024], [maxReferencedBytes, 1, 1024 * 1024 * 1024]] as const) {
          if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new PersistentWorkspaceError('INVALID_ARGUMENT', 'Invalid maintenance budgets');
        }
        const collect = async (): Promise<PersistentWorkspaceGarbageCollectionResult> => {
          const roots = await readRoots(database);
          const references = new Map<string, { sha256: string; bytes: number }>();
          let referenceBytes = 0;
          // Every retained recovery root must be sound, including older roots that
          // ordinary open does not need to restore after finding the latest one.
          for (const record of roots) {
            const { value } = await decodeRoot(record);
            for (const entry of value.entries) {
              if (entry.type !== 'file') continue;
              const blob = entry.blob!, previous = references.get(blob.sha256);
              if (previous && previous.bytes !== blob.bytes) corrupt('Retained roots disagree about a content blob');
              if (!previous) {
                referenceBytes += blob.bytes;
                if (!Number.isSafeInteger(referenceBytes) || referenceBytes > maxReferencedBytes) throw new PersistentWorkspaceError('RESOURCE_LIMIT', 'Retained root validation exceeds its maintenance byte budget; no blobs were removed');
                references.set(blob.sha256, blob);
              }
            }
          }
          // Losing either a current or recovery root is not evidence that its
          // blobs are orphaned. The owner itself is the only admitted publisher.
          if (roots.length !== retainedJournal.length || roots.some((record, index) => {
            const known = retainedJournal[index]!;
            return record.sequence !== known.sequence || record.manifest !== known.manifest || record.sha256 !== known.sha256;
          })) {
            corrupt('Workspace journal changed outside its persistence owner; no blobs were removed');
          }
          for (const blob of references.values()) {
            try { await readBlob(blob); }
            catch (cause) { throw new PersistentWorkspaceError('CORRUPT', 'A retained workspace blob could not be verified; no blobs were removed', { cause }); }
          }
          let scannedEntries = 0, skippedEntries = 0, deletedBlobs = 0, deletedBytes = 0;
          const candidates: { name: string; bytes: number }[] = [];
          const result = (scanComplete: boolean): PersistentWorkspaceGarbageCollectionResult => Object.freeze({
            retainedRoots: roots.length, referencedBlobs: references.size, scannedEntries, candidateBlobs: candidates.length,
            skippedEntries, deletedBlobs, deletedBytes, scanComplete, complete: scanComplete && deletedBlobs === candidates.length
          });
          // DOM async iteration is not present in every TypeScript DOM library.
          const listing = directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
          for await (const [name, handle] of listing.entries()) {
            if (scannedEntries === maxScannedEntries) return result(false);
            scannedEntries++;
            // Never recurse, remove journal records, or touch unknown owner files.
            if (handle.kind !== 'file' || !digestPattern.test(name)) { skippedEntries++; continue; }
            if (references.has(name)) continue;
            const bytes = (await (await directory.getFileHandle(name)).getFile()).size;
            if (!Number.isSafeInteger(bytes) || bytes < 0) corrupt('Invalid orphan blob size; no blobs were removed');
            candidates.push({ name, bytes });
          }
          candidates.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
          for (const candidate of candidates) {
            if (deletedBlobs === maxDeletedBlobs || candidate.bytes > maxDeletedBytes - deletedBytes) continue;
            await fault?.('before-garbage-delete');
            await directory.removeEntry(candidate.name);
            deletedBlobs++; deletedBytes += candidate.bytes;
          }
          return result(true);
        };
        // Set the owner operation before the first await, excluding flush and
        // other collectors. Disposal waits for this operation under the same lock.
        maintenance = collect().then(result => { maintenance = undefined; maintenanceError = undefined; return result; }, (cause: unknown) => {
          maintenance = undefined;
          maintenanceError = cause instanceof PersistentWorkspaceError ? cause.code : 'STORAGE';
          throw cause instanceof PersistentWorkspaceError ? cause : new PersistentWorkspaceError('STORAGE', 'Workspace maintenance failed; committed roots and current memory were preserved', { cause });
        });
        return maintenance;
      },
      dispose() {
        if (disposal) return disposal;
        disposed = true;
        disposal = (async () => {
          try { await pending; } catch { /* Failure remains visible through inspect/export. */ }
          try { await maintenance; } catch { /* Maintenance cannot make disposal lose its lock. */ }
          database.close(); await release();
        })();
        return disposal;
      }
    });
  } catch (cause) {
    db?.close(); await release();
    if (cause instanceof PersistentWorkspaceError) throw cause;
    throw new PersistentWorkspaceError('STORAGE', 'Workspace storage could not open; existing data was preserved', { cause });
  }
}
