import { MemoryFileSystem } from '../memory.js';
import type { FileSystemSnapshot, MemoryFileSystemOptions, SnapshotEntry } from '../types.js';

export type PersistentWorkspaceErrorCode = 'INVALID_ARGUMENT' | 'UNSUPPORTED' | 'BUSY' | 'CORRUPT' | 'STORAGE' | 'DISPOSED';
export class PersistentWorkspaceError extends Error {
  override readonly name = 'PersistentWorkspaceError';
  constructor(readonly code: PersistentWorkspaceErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}
export type PersistenceFaultPoint = 'after-blob-write' | 'before-root-publish' | 'after-root-publish';
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
  readonly lastError?: PersistentWorkspaceErrorCode;
}
export interface PersistentWorkspace {
  readonly fs: MemoryFileSystem;
  flush(): Promise<PersistentWorkspaceInspection>;
  inspect(): PersistentWorkspaceInspection;
  /** Includes unsaved /workspace content and inode identities, without toolchain/cache data. */
  exportSnapshot(): FileSystemSnapshot;
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
    let disposed = false;
    let disposal: Promise<void> | undefined;
    let pending: Promise<PersistentWorkspaceInspection> | undefined;

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
    const restore = async (record: RootRecord): Promise<MemoryFileSystem> => {
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
      for (let i = 0; i < value.entries.length; i++) {
        const entry = value.entries[i]!;
        if (entry.type === 'file') records[i] = { ...records[i]!, data: await readBlob(entry.blob!) };
      }
      return MemoryFileSystem.fromSnapshot({ ...snapshot, entries: [...base.entries.filter((entry) => entry.path !== '/workspace'), ...records] }, policy);
    };

    const roots = await readRoots(database);
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
        state: disposed ? 'disposed' : pending ? 'saving' : lastError ? 'error' : recovered ? 'recovered' : committedGeneration === null ? 'new' : dirty ? 'dirty' : 'saved',
        generation: fs.generation, committedGeneration, committedSequence: lastRoot?.sequence ?? null,
        dirty, recovered, ...(lastError ? { lastError } : {}) });
    };
    const checkOpen = () => { if (disposed) throw new PersistentWorkspaceError('DISPOSED', 'Workspace persistence owner has been disposed'); };
    return Object.freeze({
      fs,
      inspect,
      exportSnapshot() { return workspaceSnapshot(); },
      async flush() {
        checkOpen();
        if (pending) return Promise.reject(new PersistentWorkspaceError('BUSY', 'A workspace flush is already in progress'));
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
      dispose() {
        if (disposal) return disposal;
        disposed = true;
        disposal = (async () => {
          try { await pending; } catch { /* Failure remains visible through inspect/export. */ }
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
