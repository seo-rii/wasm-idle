import { ContainerError } from '../errors.js';
import { FsError, type FileStat, type FileType, type MemoryFileSystem } from '../fs/index.js';

/** Metadata the shell runtime needs for one path or open file. */
export interface ShellFileStat {
  readonly type: FileType;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}
export interface ShellOpenFlags {
  readonly read: boolean;
  readonly write: boolean;
  readonly create: boolean;
  readonly exclusive: boolean;
  readonly truncate: boolean;
  readonly append: boolean;
}
/**
 * Synchronous filesystem operations for a shell runtime mount. Paths are absolute
 * inside the mount: `/` is the mount point. Every operation completes against the
 * common container filesystem before returning, so other container processes and
 * editors see it immediately. Failures throw `FsError`.
 */
export interface ShellFilesystem {
  stat(path: string): ShellFileStat;
  lstat(path: string): ShellFileStat;
  readdir(path: string): { readonly name: string; readonly type: FileType }[];
  mkdir(path: string): void;
  rmdir(path: string): void;
  unlink(path: string): void;
  rename(from: string, to: string): void;
  readlink(path: string): string;
  open(path: string, flags: ShellOpenFlags): number;
  read(handle: number, offset: number, length: number): Uint8Array;
  write(handle: number, offset: number, bytes: Uint8Array): number;
  append(handle: number, bytes: Uint8Array): number;
  fstat(handle: number): ShellFileStat;
  truncate(handle: number, size: number): void;
  close(handle: number): void;
}
export interface ShellFilesystemOptions {
  /** Absolute container directory exposed as the mount root. Default `/workspace`. */
  readonly root?: string;
  /** Largest single read or write in bytes; 1..16 MiB, default 1 MiB. */
  readonly maxIoBytes?: number;
  /** Open handles retained for the shell at once; 1..4096, default 1024. */
  readonly maxHandles?: number;
}

const statOf = (stat: FileStat): ShellFileStat => Object.freeze({ type: stat.type, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });

/**
 * Expose part of the common container filesystem to a trusted shell runtime.
 * Operations run directly on the VFS, like editor writes; there is no snapshot
 * or copy. A snapshot adapter's writer lease makes mutations fail with `EBUSY`.
 */
export function createShellFilesystem(fs: MemoryFileSystem, options: ShellFilesystemOptions = {}): ShellFilesystem {
  const root = options.root ?? '/workspace', maxIo = options.maxIoBytes ?? 1024 * 1024, maxHandles = options.maxHandles ?? 1024;
  if (typeof root !== 'string' || !root.startsWith('/') || !Number.isSafeInteger(maxIo) || maxIo < 1 || maxIo > 16 * 1024 * 1024 ||
      !Number.isSafeInteger(maxHandles) || maxHandles < 1 || maxHandles > 4096) throw new ContainerError('INVALID_ARGUMENT', 'Invalid shell filesystem options');
  if (fs.stat(root).type !== 'directory') throw new ContainerError('INVALID_ARGUMENT', 'Shell filesystem root must be a directory');
  const context = { cwd: root, root };
  // The root capability confines every path and symlink to the mount.
  const local = (path: unknown) => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.length > 4096) throw new FsError('EINVAL', 'Invalid shell path');
    return '.' + path;
  };
  const handles = new Map<number, { fd: number; append: boolean }>();
  let nextHandle = 1;
  const handle = (value: unknown) => {
    const entry = typeof value === 'number' ? handles.get(value) : undefined;
    if (!entry) throw new FsError('EBADF', 'Unknown shell file handle');
    return entry;
  };
  const integer = (value: unknown, max: number) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new FsError('EINVAL', 'Invalid shell I/O number');
    return value;
  };
  const delegate: ShellFilesystem = {
    stat: (path) => statOf(fs.stat(local(path), context)),
    lstat: (path) => statOf(fs.lstat(local(path), context)),
    readdir: (path) => {
      const directory = local(path);
      return fs.readdir(directory, context).map(name => Object.freeze({ name, type: fs.lstat(`${directory}/${name}`, context).type }));
    },
    mkdir: (path) => { fs.mkdir(local(path), context); },
    rmdir: (path) => { fs.rmdir(local(path), context); },
    unlink: (path) => { fs.unlink(local(path), context); },
    rename: (from, to) => { fs.rename(local(from), local(to), context); },
    readlink: (path) => fs.readlink(local(path), context),
    open: (path, flags) => {
      if (handles.size >= maxHandles || nextHandle >= 0x7fffffff) throw new FsError('ENOSPC', 'Shell file handle budget exceeded');
      if (!flags || typeof flags !== 'object') throw new FsError('EINVAL', 'Invalid open flags');
      const fd = fs.open(local(path), { ...context, read: Boolean(flags.read), write: Boolean(flags.write), create: Boolean(flags.create),
        exclusive: Boolean(flags.exclusive), truncate: Boolean(flags.truncate), append: Boolean(flags.append) });
      const id = nextHandle++;
      handles.set(id, { fd, append: Boolean(flags.append) });
      return id;
    },
    read: (id, offset, length) => fs.pread(handle(id).fd, integer(length, maxIo), integer(offset, Number.MAX_SAFE_INTEGER)),
    write: (id, offset, bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.length > maxIo) throw new FsError('EINVAL', 'Invalid shell write');
      return fs.pwrite(handle(id).fd, bytes.slice(), integer(offset, Number.MAX_SAFE_INTEGER));
    },
    // The container descriptor's append mode places every write at the current end.
    append: (id, bytes) => {
      const entry = handle(id);
      if (!entry.append || !(bytes instanceof Uint8Array) || bytes.length > maxIo) throw new FsError('EINVAL', 'Invalid shell append');
      return fs.write(entry.fd, bytes.slice());
    },
    fstat: (id) => statOf(fs.fstat(handle(id).fd)),
    truncate: (id, size) => { fs.ftruncate(handle(id).fd, integer(size, Number.MAX_SAFE_INTEGER)); },
    close: (id) => { const entry = handle(id); handles.delete(id); fs.close(entry.fd); }
  };
  return Object.freeze(delegate);
}
