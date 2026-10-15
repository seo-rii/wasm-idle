import { FsError, MemoryFileSystem, type SnapshotEntry } from '../fs/index.js';

export type WorkspaceBackupErrorCode = 'INVALID_ARCHIVE' | 'LIMIT' | 'INTEGRITY' | 'UNSUPPORTED';
export class WorkspaceBackupError extends Error {
  override readonly name = 'WorkspaceBackupError';
  constructor(readonly code: WorkspaceBackupErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}
export interface WorkspaceBackupOptions {
  /** Total encoded bytes, including metadata and checksum. Default: 96 MiB. */
  readonly maxArchiveBytes?: number;
  /** UTF-8 manifest limit, independent of file content. Default: 8 MiB. */
  readonly maxMetadataBytes?: number;
}
interface RecordEntry {
  path: string;
  type: 'directory' | 'file' | 'symlink';
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  target?: string;
  offset?: number;
  bytes?: number;
}
const encoder = new TextEncoder(), magic = encoder.encode('WIDLEWS1');
const invalid = (message: string): never => { throw new WorkspaceBackupError('INVALID_ARCHIVE', message); };
function limits(options: WorkspaceBackupOptions) {
  const archive = options.maxArchiveBytes ?? 96 * 1024 * 1024, metadata = options.maxMetadataBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(archive) || archive < 44 || archive > 512 * 1024 * 1024 || !Number.isSafeInteger(metadata) || metadata < 1 || metadata > 64 * 1024 * 1024) throw new WorkspaceBackupError('LIMIT', 'Invalid backup byte limits');
  return { archive, metadata };
}
async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new WorkspaceBackupError('UNSUPPORTED', 'Workspace backup requires Web Crypto');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}
const inside = (path: string) => path === '/workspace' || path.startsWith('/workspace/');

/** Copy one synchronous memory revision; later async hashing cannot mix file generations. */
export async function createWorkspaceBackup(fs: MemoryFileSystem, options: WorkspaceBackupOptions = {}): Promise<Uint8Array> {
  const budget = limits(options), entries: RecordEntry[] = [], contents: Uint8Array[] = [];
  let offset = 0;
  const visit = (path: string) => {
    const stat = fs.lstat(path, { root: '/workspace' });
    const entry: RecordEntry = { path, type: stat.type, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
    if (entry.type === 'file') {
      if (offset + stat.size + 44 > budget.archive) throw new WorkspaceBackupError('LIMIT', 'Workspace content exceeds backup limit');
      entry.offset = offset; entry.bytes = stat.size; offset += stat.size;
      contents.push(fs.readFile(path, { root: '/workspace' }));
    } else if (entry.type === 'symlink') entry.target = fs.readlink(path, { root: '/workspace' });
    entries.push(entry);
    if (entry.type === 'directory') for (const name of fs.readdir(path, { root: '/workspace' }).sort()) visit(`${path}/${name}`);
  };
  visit('/workspace');
  const metadata = encoder.encode(JSON.stringify({ schemaVersion: 1, generation: fs.generation, entries }));
  if (metadata.length > budget.metadata || metadata.length + offset + 44 > budget.archive) throw new WorkspaceBackupError('LIMIT', 'Workspace metadata exceeds backup limit');
  const archive = new Uint8Array(12 + metadata.length + offset + 32);
  archive.set(magic); new DataView(archive.buffer).setUint32(8, metadata.length, true); archive.set(metadata, 12);
  let position = 12 + metadata.length;
  for (const bytes of contents) { archive.set(bytes, position); position += bytes.length; }
  archive.set(await digest(archive.subarray(0, position)), position);
  return archive;
}

/** Explicit replacement, never a merge. Validation completes before taking the writer lease. */
export async function restoreWorkspaceBackup(fs: MemoryFileSystem, input: Uint8Array, options: WorkspaceBackupOptions & { readonly replace: true }): Promise<{ readonly generation: number; readonly sourceGeneration: number; readonly entries: number }> {
  if (!options || options.replace !== true) invalid('Restoring a workspace requires explicit replace: true');
  const budget = limits(options);
  if (!(input instanceof Uint8Array) || input.length < 44) invalid('Truncated workspace archive');
  if (input.length > budget.archive) throw new WorkspaceBackupError('LIMIT', 'Archive exceeds its byte limit');
  const archive = Uint8Array.from(input);
  if (!magic.every((byte, index) => archive[index] === byte)) invalid('Unsupported workspace archive format');
  const metadataLength = new DataView(archive.buffer).getUint32(8, true), end = archive.length - 32;
  if (metadataLength > budget.metadata) throw new WorkspaceBackupError('LIMIT', 'Archive metadata exceeds its byte limit');
  if (metadataLength > end - 12) invalid('Manifest exceeds archive bounds');
  const actual = await digest(archive.subarray(0, end));
  if (!actual.every((byte, index) => archive[end + index] === byte)) throw new WorkspaceBackupError('INTEGRITY', 'Workspace archive checksum does not match');
  let value: { schemaVersion: number; generation: number; entries: RecordEntry[] };
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(12, 12 + metadataLength))); }
  catch { return invalid('Workspace manifest is not valid UTF-8 JSON'); }
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.entries) || !value.entries.length) invalid('Invalid workspace manifest');
  if (value.entries.length > fs.maxInodes) throw new WorkspaceBackupError('LIMIT', 'Archive exceeds filesystem inode limit');
  const names = new Set<string>(); let offset = 0;
  const records: Omit<SnapshotEntry, 'inode'>[] = value.entries.map(entry => {
    if (!entry || typeof entry.path !== 'string' || !inside(entry.path) || entry.path.split('/').slice(1).some(part => !part || part === '.' || part === '..') || names.has(entry.path)) invalid('Archive path is invalid, duplicate or outside /workspace');
    names.add(entry.path);
    if (!['directory', 'file', 'symlink'].includes(entry.type) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 || !Number.isFinite(entry.mtimeMs) || entry.mtimeMs < 0 || !Number.isFinite(entry.ctimeMs) || entry.ctimeMs < 0) invalid('Invalid workspace entry metadata');
    const result: Omit<SnapshotEntry, 'inode'> = { path: entry.path, type: entry.type, mode: entry.mode, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs };
    if (entry.type === 'file') {
      if (entry.target !== undefined || entry.offset !== offset || !Number.isSafeInteger(entry.bytes) || entry.bytes! < 0 || entry.bytes! > end - 12 - metadataLength - offset) invalid('File body overlaps or exceeds archive bounds');
      const start = 12 + metadataLength + offset; offset += entry.bytes!;
      return { ...result, data: archive.subarray(start, start + entry.bytes!) };
    }
    if (entry.offset !== undefined || entry.bytes !== undefined || entry.type === 'directory' && entry.target !== undefined || entry.type === 'symlink' && typeof entry.target !== 'string') invalid('Invalid directory or symlink body');
    return entry.type === 'symlink' ? { ...result, target: entry.target } : result;
  });
  if (offset !== end - 12 - metadataLength || records.find(entry => entry.path === '/workspace')?.type !== 'directory') invalid('Archive contains unreferenced bytes or no workspace root');
  // Validate the complete inert tree using the same path, prefix, UTF-8 and quota
  // rules as the VFS. No imported symlink is followed while restoring names.
  const empty = new MemoryFileSystem({ maxBytes: fs.maxBytes, maxInodes: fs.maxInodes }).exportSnapshot();
  let next = empty.nextInode;
  try {
    MemoryFileSystem.fromSnapshot({ ...empty, nextInode: next + records.length - 1, entries: [
      ...empty.entries,
      ...records.filter(entry => entry.path !== '/workspace').map(entry => ({ ...entry, inode: next++ }))
    ] }, { maxBytes: fs.maxBytes, maxInodes: fs.maxInodes });
  } catch (error) {
    // Target quota stays a filesystem error; any other rejection is archive structure.
    if (!(error instanceof FsError) || error.code === 'ENOSPC') throw error;
    throw new WorkspaceBackupError('INVALID_ARCHIVE', `Workspace manifest violates filesystem rules: ${error.code}`, { cause: error });
  }
  const lease = fs.acquireSnapshot();
  try {
    next = lease.snapshot.nextInode;
    const entries = lease.snapshot.entries.filter(entry => !entry.path.startsWith('/workspace/'));
    entries.push(...records.filter(entry => entry.path !== '/workspace').map(entry => ({ ...entry, inode: next++ })));
    lease.commit({ ...lease.snapshot, nextInode: next, entries });
    return Object.freeze({ generation: fs.generation, sourceGeneration: value.generation, entries: records.length });
  } finally { lease.discard(); }
}
