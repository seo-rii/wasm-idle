export type FileType = 'file' | 'directory' | 'symlink' | 'character-device';

export interface FileStat {
  /** The immutable built-in /dev/null reserves inode 0; other identities are positive. */
  readonly inode: number;
  readonly type: FileType;
  readonly size: number;
  /** Type bits are not included. Only the lower nine POSIX mode bits are stored. */
  readonly mode: number;
  /** Explicit access time; reads use a noatime policy. */
  readonly atimeMs: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  /** Readonly virtual command entry: executable by a registered backend, no file body. */
  readonly command?: true;
}

/** Owner-only identity for one inode revision; never serialized into guest messages. */
export interface FileVersion {
  readonly inode: number;
  readonly revision: bigint;
}

export interface PathOptions {
  /** Absolute working directory. Defaults to /workspace (or root for a narrower capability). */
  cwd?: string;
  /** Absolute directory capability. Absolute paths must remain under this root. */
  root?: string;
}

/** Omitted fields are unchanged; `now` is sampled once by the filesystem owner. */
export interface FileTimes {
  readonly atimeMs?: number | 'now';
  readonly mtimeMs?: number | 'now';
}

export interface OpenOptions extends PathOptions {
  read?: boolean;
  write?: boolean;
  /** Allow ftruncate without granting byte writes. Inapplicable to directories/devices. */
  resize?: boolean;
  create?: boolean;
  exclusive?: boolean;
  truncate?: boolean;
  append?: boolean;
  directory?: boolean;
  mode?: number;
  /**
   * Opt in to retaining this open description across snapshot commits. Writes
   * still fail during the lease; a commit removing its linked inode conflicts.
   * Omit to keep the default exclusion of snapshots while the fd is open.
   */
  snapshot?: 'preserve';
}

export interface MemoryFileSystemOptions {
  /** Includes retained, unlinked files until their final descriptor closes. */
  maxBytes?: number;
  /** Includes directories, symlinks, readonly packages, and retained unlinked nodes. */
  maxInodes?: number;
}

export interface SnapshotEntry {
  /** Stable identity within this filesystem; restores must not renumber a moved inode. */
  readonly inode: number;
  /** Canonical absolute path in snapshots, relative path in mountReadonly input. */
  readonly path: string;
  readonly type: FileType;
  readonly mode: number;
  /** Omitted only for host-created package entries or older snapshot inputs. */
  readonly atimeMs?: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  readonly data?: Uint8Array;
  readonly target?: string;
  /** Trusted virtual executable metadata, valid only on a readonly file entry. */
  readonly command?: true;
}

export interface FileSystemSnapshot {
  readonly generation: number;
  /** Monotonic allocation high-water mark, including identities deleted before export. */
  readonly nextInode: number;
  readonly mounts: readonly { readonly path: string; readonly readonly: boolean }[];
  readonly entries: readonly SnapshotEntry[];
}

export interface FileSystemLease {
  readonly snapshot: FileSystemSnapshot;
  /** Commit only on an ordinary guest exit, including nonzero guest exit. */
  commit(result: FileSystemSnapshot): void;
  /** Discard on cancellation or runtime failure. Idempotent. */
  discard(): void;
}

/** Change hints describe committed operations, not a replayable historical snapshot. */
export interface FileSystemChange {
  readonly generation: number;
  readonly kind: 'create' | 'modify' | 'remove' | 'rename' | 'rescan';
  readonly path: string;
  readonly previousPath?: string;
  readonly inode?: number;
}
export interface FileSystemWatchOptions {
  /** Existing directory, resolved once at subscription. Defaults to /workspace. */
  readonly path?: string;
  /** Buffered hints per watcher, 1..256 (default 32). Overflow emits one rescan hint. */
  readonly maxQueuedEvents?: number;
  readonly signal?: AbortSignal;
}
