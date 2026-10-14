export type FileType = 'file' | 'directory' | 'symlink';

export interface FileStat {
  readonly inode: number;
  readonly type: FileType;
  readonly size: number;
  /** Type bits are not included. Only the lower nine POSIX mode bits are stored. */
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

export interface PathOptions {
  /** Absolute working directory. Defaults to /workspace (or root for a narrower capability). */
  cwd?: string;
  /** Absolute directory capability. Absolute paths must remain under this root. */
  root?: string;
}

export interface OpenOptions extends PathOptions {
  read?: boolean;
  write?: boolean;
  create?: boolean;
  exclusive?: boolean;
  truncate?: boolean;
  append?: boolean;
  directory?: boolean;
  mode?: number;
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
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  readonly data?: Uint8Array;
  readonly target?: string;
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
