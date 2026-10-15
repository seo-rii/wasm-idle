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
  /** Canonical absolute path in snapshots, relative path in mountReadonly input. */
  readonly path: string;
  readonly type: FileType;
  readonly mode: number;
  readonly data?: Uint8Array;
  readonly target?: string;
}

export interface FileSystemSnapshot {
  readonly generation: number;
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
