import { FsError } from './errors.js';
import type {
  FileStat, FileSystemLease, FileSystemSnapshot, FileType, MemoryFileSystemOptions,
  OpenOptions, PathOptions, SnapshotEntry,
} from './types.js';

interface Inode {
  inode: number;
  type: FileType;
  mode: number;
  mount: string;
  data: Uint8Array;
  target: string;
  children: Map<string, Inode>;
  references: number;
  linked: boolean;
  mtimeMs: number;
  ctimeMs: number;
}

interface Description {
  node: Inode;
  offset: number;
  read: boolean;
  write: boolean;
  append: boolean;
  root: string;
}

interface Resolved { node: Inode; path: string; }

const encoder = new TextEncoder();
const badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function checkPath(path: string): void {
  if (typeof path !== 'string' || !path || path.includes('\0') || badUnicode.test(path)) {
    throw new FsError('EINVAL', 'Paths must be nonempty UTF-8 strings without NUL');
  }
  if (encoder.encode(path).byteLength > 4096) throw new FsError('EINVAL', 'Path exceeds 4096 UTF-8 bytes');
  if (path.split('/').filter(Boolean).length > 128) throw new FsError('EINVAL', 'Path exceeds 128 components');
}

function components(path: string): string[] { return path.split('/').filter(Boolean); }
function absolute(parts: readonly string[]): string { return `/${parts.join('/')}`; }
function childPath(parent: string, name: string): string { return `${parent === '/' ? '' : parent}/${name}`; }
function within(path: string, root: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}
function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new FsError('EINVAL', `${label} must be a nonnegative safe integer`);
}
function checkMode(mode: number): void {
  integer(mode, 'mode');
  if (mode > 0o777) throw new FsError('EINVAL', 'Only permission mode bits are supported');
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function sameEntry(a: SnapshotEntry, b: SnapshotEntry): boolean {
  return a.type === b.type && a.mode === b.mode && a.target === b.target &&
    (a.type !== 'file' || sameBytes(a.data!, b.data!));
}

/** Synchronous memory VFS. Guests use an ABI adapter; no host filesystem is exposed. */
export class MemoryFileSystem {
  private root: Inode;
  private mounts = new Map<string, boolean>();
  private nodes = new Set<Inode>();
  private descriptors = new Map<number, Description>();
  private nextInode = 1;
  private nextFd = 3;
  private usedBytes = 0;
  private revision = 0;
  private lease: symbol | undefined;
  readonly maxBytes: number;
  readonly maxInodes: number;

  constructor(options: MemoryFileSystemOptions = {}) {
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.maxInodes = options.maxInodes ?? 16_384;
    integer(this.maxBytes, 'maxBytes');
    integer(this.maxInodes, 'maxInodes');
    this.mounts.set('/', true);
    this.root = this.allocate('directory', '/', 0o755);
    for (const path of ['/workspace', '/tmp', '/home', '/home/user', '/usr', '/usr/bin', '/usr/share', '/opt', '/dev']) {
      const parts = components(path);
      const name = parts.pop()!;
      const parent = this.walk(absolute(parts), '/', true).node;
      const writable = path === '/workspace' || path === '/tmp' || path === '/home/user';
      if (writable) this.mounts.set(path, false);
      parent.children.set(name, this.allocate('directory', writable ? path : parent.mount, 0o755));
    }
  }

  get generation(): number { return this.revision; }
  get byteLength(): number { return this.usedBytes; }
  get inodeCount(): number { return this.nodes.size; }

  private allocate(type: FileType, mount: string, mode: number): Inode {
    if (this.nodes.size >= this.maxInodes) throw new FsError('ENOSPC', 'Filesystem inode quota exceeded');
    checkMode(mode);
    const now = Date.now();
    const node: Inode = {
      inode: this.nextInode++, type, mode, mount, data: new Uint8Array(), target: '',
      children: new Map(), references: 0, linked: true, mtimeMs: now, ctimeMs: now,
    };
    this.nodes.add(node);
    return node;
  }

  private release(node: Inode): void {
    if (!node.linked && node.references === 0) {
      this.nodes.delete(node);
      this.usedBytes -= node.data.length + encoder.encode(node.target).length;
    }
  }

  private writable(node: Inode): void {
    if (this.lease) throw new FsError('EBUSY', 'A snapshot process holds the filesystem writer lease');
    if (this.mounts.get(node.mount) !== false) throw new FsError('EROFS', 'The resolved mount is readonly');
  }

  private changed(...nodes: Inode[]): void {
    this.revision++;
    const now = Date.now();
    for (const node of nodes) node.mtimeMs = node.ctimeMs = now;
  }

  /** Walk components before reducing .. so symlink/../file has POSIX semantics. */
  private walk(path: string, root: string, followFinal: boolean, cwd = root): Resolved {
    checkPath(path);
    const floor = components(root);
    const start = path.startsWith('/') ? path : `${cwd}/${path}`;
    const queue = components(start);
    for (let i = 0; i < floor.length; i++) {
      if (queue[i] !== floor[i]) throw new FsError('EACCES', 'Path is outside the directory capability');
    }
    const stack: Inode[] = [this.root];
    const names: string[] = [];
    let hops = 0;
    while (queue.length > 0) {
      const part = queue.shift()!;
      const current = stack[stack.length - 1]!;
      if (current.type !== 'directory') throw new FsError('ENOTDIR', 'Path component is not a directory');
      if (part === '.') continue;
      if (part === '..') {
        if (names.length <= floor.length) {
          if (floor.length !== 0) throw new FsError('EACCES', 'Path escapes the directory capability');
        } else { names.pop(); stack.pop(); }
        continue;
      }
      const child = current.children.get(part);
      if (!child) throw new FsError('ENOENT', 'Path does not exist');
      if (child.type === 'symlink' && (followFinal || queue.length > 0 || path.endsWith('/'))) {
        if (++hops > 40) throw new FsError('ELOOP', 'Too many symbolic links');
        if (child.target.startsWith('/')) {
          const target = components(child.target);
          if (floor.some((name, i) => target[i] !== name)) throw new FsError('EACCES', 'Symlink escapes the directory capability');
          names.length = 0;
          stack.length = 1;
          queue.unshift(...target);
        } else queue.unshift(...components(child.target));
      } else { names.push(part); stack.push(child); }
    }
    const node = stack[stack.length - 1]!;
    if (path.endsWith('/') && node.type !== 'directory') throw new FsError('ENOTDIR', 'Trailing slash requires a directory');
    const result = absolute(names);
    if (!within(result, root)) throw new FsError('EACCES', 'Path escapes the directory capability');
    return { node, path: result };
  }

  private context(options: PathOptions): { root: string; cwd: string } {
    const rawRoot = options.root ?? '/';
    checkPath(rawRoot);
    if (!rawRoot.startsWith('/')) throw new FsError('EINVAL', 'Capability root must be absolute');
    const resolvedRoot = this.walk(rawRoot, '/', true);
    if (resolvedRoot.node.type !== 'directory') throw new FsError('ENOTDIR', 'Capability root must be a directory');
    const rawCwd = options.cwd ?? (resolvedRoot.path === '/' ? '/workspace' : resolvedRoot.path);
    checkPath(rawCwd);
    if (!rawCwd.startsWith('/')) throw new FsError('EINVAL', 'Working directory must be absolute');
    const cwd = this.walk(rawCwd, resolvedRoot.path, true);
    if (cwd.node.type !== 'directory') throw new FsError('ENOTDIR', 'Working directory must be a directory');
    return { root: resolvedRoot.path, cwd: cwd.path };
  }

  private resolve(path: string, options: PathOptions = {}, followFinal = true): Resolved {
    const { root, cwd } = this.context(options);
    return this.walk(path, root, followFinal, cwd);
  }

  private parent(path: string, options: PathOptions): { node: Inode; path: string; name: string } {
    checkPath(path);
    const parts = path.split('/');
    while (parts.at(-1) === '') parts.pop();
    const name = parts.pop();
    if (!name || name === '.' || name === '..') throw new FsError('EINVAL', 'Operation requires an ordinary final path component');
    const parent = this.resolve(parts.join('/') || (path.startsWith('/') ? '/' : '.'), options);
    if (parent.node.type !== 'directory') throw new FsError('ENOTDIR', 'Parent is not a directory');
    return { ...parent, name };
  }

  /** Find a create destination through a dangling final symlink without replacing it. */
  private createParent(path: string, options: PathOptions): { node: Inode; path: string; name: string } {
    let candidate = path;
    let context = options;
    for (let hops = 0; hops <= 40; hops++) {
      const parent = this.parent(candidate, context);
      const existing = parent.node.children.get(parent.name);
      if (existing?.type !== 'symlink') {
        if (!existing && candidate.endsWith('/')) throw new FsError('ENOTDIR', 'File destination has a trailing slash');
        return parent;
      }
      candidate = existing.target;
      context = { ...options, cwd: parent.path };
    }
    throw new FsError('ELOOP', 'Too many symbolic links');
  }

  private file(node: Inode): void {
    if (node.type === 'directory') throw new FsError('EISDIR', 'Operation requires a regular file');
    if (node.type !== 'file') throw new FsError('EINVAL', 'Operation requires a regular file');
  }

  private info(node: Inode): FileStat {
    return {
      inode: node.inode, type: node.type, mode: node.mode,
      size: node.type === 'file' ? node.data.length : node.type === 'symlink' ? encoder.encode(node.target).length : 0,
      mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs,
    };
  }

  /**
   * Every reachable canonical path must stay within the checkPath limits. A cwd-relative
   * name or a moved subtree can otherwise exceed them, leaving entries that path lookups
   * cannot name and that exportSnapshot/fromSnapshot cannot round-trip.
   */
  private checkPlacement(path: string, node?: Inode): void {
    let depth = 0, size = 0;
    const visit = (current: Inode, parentDepth: number, parentSize: number): void => {
      for (const [name, child] of current.children) {
        const childDepth = parentDepth + 1, childSize = parentSize + 1 + encoder.encode(name).byteLength;
        depth = Math.max(depth, childDepth);
        size = Math.max(size, childSize);
        visit(child, childDepth, childSize);
      }
    };
    if (node) visit(node, 0, 0);
    if (encoder.encode(path).byteLength + size > 4096 || components(path).length + depth > 128) {
      throw new FsError('EINVAL', 'Resulting path exceeds 4096 UTF-8 bytes or 128 components');
    }
  }

  stat(path: string, options: PathOptions = {}): FileStat { return this.info(this.resolve(path, options).node); }
  lstat(path: string, options: PathOptions = {}): FileStat { return this.info(this.resolve(path, options, false).node); }
  realpath(path: string, options: PathOptions = {}): string { return this.resolve(path, options).path; }

  readdir(path: string, options: PathOptions = {}): string[] {
    const { node } = this.resolve(path, options);
    if (node.type !== 'directory') throw new FsError('ENOTDIR', 'Path is not a directory');
    return [...node.children.keys()].sort();
  }

  readlink(path: string, options: PathOptions = {}): string {
    const { node } = this.resolve(path, options, false);
    if (node.type !== 'symlink') throw new FsError('EINVAL', 'Path is not a symbolic link');
    return node.target;
  }

  readFile(path: string, options: PathOptions = {}): Uint8Array {
    const { node } = this.resolve(path, options);
    this.file(node);
    return node.data.slice();
  }

  /** Validate capacity before replacing data; a failed write never truncates the old file. */
  writeFile(path: string, bytes: Uint8Array, options: PathOptions & { mode?: number } = {}): void {
    if (!(bytes instanceof Uint8Array)) throw new FsError('EINVAL', 'File content must be Uint8Array');
    if (options.mode !== undefined) checkMode(options.mode);
    let node: Inode;
    try { node = this.resolve(path, options).node; }
    catch (error) {
      if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error;
      const parent = this.createParent(path, options);
      this.writable(parent.node);
      if (parent.node.children.has(parent.name)) throw error;
      if (path.endsWith('/')) throw new FsError('ENOTDIR', 'File path ends with a slash');
      this.checkPlacement(childPath(parent.path, parent.name));
      if (this.usedBytes + bytes.length > this.maxBytes) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
      const copied = bytes.slice();
      node = this.allocate('file', parent.node.mount, options.mode ?? 0o644);
      node.data = copied;
      this.usedBytes += copied.length;
      parent.node.children.set(parent.name, node);
      this.changed(parent.node, node);
      return;
    }
    this.writable(node);
    this.file(node);
    if (this.usedBytes - node.data.length + bytes.length > this.maxBytes) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
    const copied = bytes.slice();
    this.usedBytes += copied.length - node.data.length;
    node.data = copied;
    this.changed(node);
  }

  mkdir(path: string, options: PathOptions & { recursive?: boolean; mode?: number } = {}): void {
    if (options.mode !== undefined) checkMode(options.mode);
    if (options.recursive) {
      checkPath(path);
      const parts = components(path);
      let prefix = path.startsWith('/') ? '' : '.';
      for (const part of parts) {
        prefix += `/${part}`;
        try {
          if (this.stat(prefix, options).type !== 'directory') throw new FsError('ENOTDIR', 'Path component is not a directory');
        } catch (error) {
          if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error;
          this.mkdir(prefix, { ...options, recursive: false });
        }
      }
      return;
    }
    const parent = this.parent(path, options);
    this.writable(parent.node);
    if (parent.node.children.has(parent.name)) throw new FsError('EEXIST', 'Path already exists');
    this.checkPlacement(childPath(parent.path, parent.name));
    parent.node.children.set(parent.name, this.allocate('directory', parent.node.mount, options.mode ?? 0o755));
    this.changed(parent.node);
  }

  symlink(target: string, path: string, options: PathOptions = {}): void {
    checkPath(target);
    const parent = this.parent(path, options);
    this.writable(parent.node);
    if (parent.node.children.has(parent.name)) throw new FsError('EEXIST', 'Path already exists');
    if (path.endsWith('/')) throw new FsError('ENOENT', 'Symlink destination has a trailing slash');
    this.checkPlacement(childPath(parent.path, parent.name));
    const size = encoder.encode(target).length;
    if (this.usedBytes + size > this.maxBytes) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
    const node = this.allocate('symlink', parent.node.mount, 0o777);
    node.target = target;
    this.usedBytes += size;
    parent.node.children.set(parent.name, node);
    this.changed(parent.node);
  }

  unlink(path: string, options: PathOptions = {}): void {
    const parent = this.parent(path, options);
    const node = parent.node.children.get(parent.name);
    if (!node) throw new FsError('ENOENT', 'Path does not exist');
    this.writable(parent.node);
    if (node.type === 'directory') throw new FsError('EISDIR', 'Use rmdir for directories');
    if (path.endsWith('/')) throw new FsError('ENOTDIR', 'Trailing slash requires a directory');
    parent.node.children.delete(parent.name);
    node.linked = false;
    this.release(node);
    this.changed(parent.node);
  }

  rmdir(path: string, options: PathOptions = {}): void {
    const parent = this.parent(path, options);
    const node = parent.node.children.get(parent.name);
    if (!node) throw new FsError('ENOENT', 'Path does not exist');
    this.writable(parent.node);
    if (node.type !== 'directory') throw new FsError('ENOTDIR', 'Path is not a directory');
    if (node.mount !== parent.node.mount) throw new FsError('EBUSY', 'Cannot remove a mount root');
    if (node.children.size) throw new FsError('ENOTEMPTY', 'Directory is not empty');
    parent.node.children.delete(parent.name);
    node.linked = false;
    this.release(node);
    this.changed(parent.node);
  }

  rename(from: string, to: string, options: PathOptions = {}): void {
    const source = this.parent(from, options);
    const destination = this.parent(to, options);
    const node = source.node.children.get(source.name);
    if (!node) throw new FsError('ENOENT', 'Source does not exist');
    if (node.mount !== source.node.mount) throw new FsError('EBUSY', 'Cannot rename a mount root');
    if (source.node.mount !== destination.node.mount) throw new FsError('EXDEV', 'Cannot rename across mounts');
    this.writable(source.node);
    this.writable(destination.node);
    if (source.node === destination.node && source.name === destination.name) return;
    const old = destination.node.children.get(destination.name);
    if ((from.endsWith('/') || to.endsWith('/')) && node.type !== 'directory') throw new FsError('ENOTDIR', 'Trailing slash requires a directory');
    const sourcePath = childPath(source.path, source.name);
    if (node.type === 'directory' && within(destination.path, sourcePath)) throw new FsError('EINVAL', 'Cannot move a directory inside itself');
    this.checkPlacement(childPath(destination.path, destination.name), node);
    if (old) {
      if (old.mount !== destination.node.mount) throw new FsError('EBUSY', 'Cannot replace a mount root');
      if (old.type === 'directory' && node.type !== 'directory') throw new FsError('EISDIR', 'Destination is a directory');
      if (old.type !== 'directory' && node.type === 'directory') throw new FsError('ENOTDIR', 'Destination is not a directory');
      if (old.children.size) throw new FsError('ENOTEMPTY', 'Destination directory is not empty');
      old.linked = false;
      this.release(old);
    }
    source.node.children.delete(source.name);
    destination.node.children.set(destination.name, node);
    this.changed(source.node, destination.node, node);
  }

  open(path: string, options: OpenOptions = {}): number {
    if (this.lease) throw new FsError('EBUSY', 'Host descriptors cannot open during a snapshot writer lease');
    const read = options.read ?? !options.write;
    const write = options.write ?? false;
    if (!read && !write) throw new FsError('EINVAL', 'Open must request read or write access');
    if ((options.truncate || options.append) && !write) throw new FsError('EINVAL', 'Truncate/append require write access');
    const { root } = this.context(options);
    if (options.create && options.exclusive) {
      try {
        this.resolve(path, options, false);
        throw new FsError('EEXIST', 'Path already exists');
      } catch (error) {
        if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error;
      }
    }
    let resolved: Resolved;
    try {
      resolved = this.resolve(path, options);
      if (options.create && options.exclusive) throw new FsError('EEXIST', 'Path already exists');
    } catch (error) {
      if (!(error instanceof FsError) || error.code !== 'ENOENT' || !options.create || options.directory) throw error;
      this.writeFile(path, new Uint8Array(), options);
      resolved = this.resolve(path, options);
    }
    const { node } = resolved;
    if (options.directory && node.type !== 'directory') throw new FsError('ENOTDIR', 'A directory descriptor was requested');
    if (write) { this.writable(node); this.file(node); }
    if (options.truncate) this.resize(node, 0);
    const fd = this.nextFd++;
    node.references++;
    this.descriptors.set(fd, { node, offset: 0, read, write, append: options.append ?? false, root });
    return fd;
  }

  private descriptor(fd: number): Description {
    const descriptor = this.descriptors.get(fd);
    if (!descriptor) throw new FsError('EBADF', 'Invalid or closed file descriptor');
    return descriptor;
  }

  fstat(fd: number): FileStat { return this.info(this.descriptor(fd).node); }
  tell(fd: number): number { return this.descriptor(fd).offset; }

  /** Resolve a directory's current name after rename; unlinked directories are unavailable. */
  getDirectoryPath(fd: number): string {
    const description = this.descriptor(fd);
    if (description.node.type !== 'directory') throw new FsError('ENOTDIR', 'Descriptor is not a directory');
    const visit = (node: Inode, path: string): string | undefined => {
      if (node === description.node) return path;
      for (const [name, child] of node.children) {
        if (child.type !== 'directory') continue;
        const found = visit(child, `${path === '/' ? '' : path}/${name}`);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const path = visit(this.root, '/');
    if (path === undefined) throw new FsError('ENOENT', 'Directory descriptor has been unlinked');
    if (!within(path, description.root)) throw new FsError('EACCES', 'Directory moved outside its capability');
    return path;
  }

  dup(fd: number): number {
    const description = this.descriptor(fd);
    const duplicate = this.nextFd++;
    description.node.references++;
    this.descriptors.set(duplicate, description);
    return duplicate;
  }

  close(fd: number): void {
    const { node } = this.descriptor(fd);
    this.descriptors.delete(fd);
    node.references--;
    this.release(node);
  }

  read(fd: number, length: number): Uint8Array {
    const description = this.descriptor(fd);
    const result = this.pread(fd, length, description.offset);
    description.offset += result.length;
    return result;
  }

  pread(fd: number, length: number, offset: number): Uint8Array {
    integer(length, 'length');
    integer(offset, 'offset');
    const description = this.descriptor(fd);
    if (!description.read) throw new FsError('EBADF', 'Descriptor is not readable');
    this.file(description.node);
    return description.node.data.slice(offset, Math.min(description.node.data.length, offset + length));
  }

  write(fd: number, bytes: Uint8Array): number {
    const description = this.descriptor(fd);
    const offset = description.append ? description.node.data.length : description.offset;
    const written = this.pwrite(fd, bytes, offset);
    if (written !== 0) description.offset = offset + written;
    return written;
  }

  pwrite(fd: number, bytes: Uint8Array, offset: number): number {
    integer(offset, 'offset');
    if (!(bytes instanceof Uint8Array)) throw new FsError('EINVAL', 'File content must be Uint8Array');
    const description = this.descriptor(fd);
    if (!description.write) throw new FsError('EBADF', 'Descriptor is not writable');
    const { node } = description;
    this.writable(node);
    this.file(node);
    if (bytes.length === 0) return 0;
    integer(offset + bytes.length, 'write end');
    if (offset + bytes.length > node.data.length) this.resize(node, offset + bytes.length);
    node.data.set(bytes, offset);
    this.changed(node);
    return bytes.length;
  }

  seek(fd: number, offset: number, whence: 'set' | 'cur' | 'end' = 'set'): number {
    if (!Number.isSafeInteger(offset)) throw new FsError('EINVAL', 'Offset must be a safe integer');
    const description = this.descriptor(fd);
    this.file(description.node);
    if (!['set', 'cur', 'end'].includes(whence)) throw new FsError('EINVAL', 'Invalid seek origin');
    const next = offset + (whence === 'cur' ? description.offset : whence === 'end' ? description.node.data.length : 0);
    integer(next, 'resulting offset');
    return description.offset = next;
  }

  private resize(node: Inode, length: number): void {
    integer(length, 'length');
    this.writable(node);
    this.file(node);
    if (this.usedBytes - node.data.length + length > this.maxBytes) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
    const resized = new Uint8Array(length);
    resized.set(node.data.subarray(0, length));
    this.usedBytes += length - node.data.length;
    node.data = resized;
    this.changed(node);
  }

  truncate(path: string, length = 0, options: PathOptions = {}): void { this.resize(this.resolve(path, options).node, length); }
  ftruncate(fd: number, length = 0): void {
    const description = this.descriptor(fd);
    if (!description.write) throw new FsError('EBADF', 'Descriptor is not writable');
    this.resize(description.node, length);
  }

  exportSnapshot(): FileSystemSnapshot {
    const entries: SnapshotEntry[] = [];
    const visit = (node: Inode, path: string): void => {
      entries.push({ path, type: node.type, mode: node.mode,
        ...(node.type === 'file' ? { data: node.data.slice() } : {}),
        ...(node.type === 'symlink' ? { target: node.target } : {}),
      });
      for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
        visit(child, `${path === '/' ? '' : path}/${name}`);
      }
    };
    visit(this.root, '/');
    return { generation: this.revision, mounts: [...this.mounts].map(([path, readonly]) => ({ path, readonly })), entries };
  }

  private publish(candidate: MemoryFileSystem): void {
    const adopt = (next: Inode, old?: Inode): void => {
      if (old?.type === next.type) {
        next.inode = old.inode;
        if (old.mode === next.mode && old.target === next.target && sameBytes(old.data, next.data) &&
          old.children.size === next.children.size && [...old.children.keys()].every(name => next.children.has(name))) {
          next.mtimeMs = old.mtimeMs;
          next.ctimeMs = old.ctimeMs;
        }
      } else next.inode = this.nextInode++;
      for (const [name, child] of next.children) adopt(child, old?.children.get(name));
    };
    adopt(candidate.root, this.root);
    this.root = candidate.root;
    this.nodes = candidate.nodes;
    this.mounts = candidate.mounts;
    this.usedBytes = candidate.usedBytes;
    this.revision++;
  }

  /** Decode a structured-clone snapshot only after validating the entire namespace. */
  static fromSnapshot(snapshot: FileSystemSnapshot, options: MemoryFileSystemOptions = {}): MemoryFileSystem {
    if (!snapshot || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.mounts)) throw new FsError('EINVAL', 'Malformed filesystem snapshot');
    integer(snapshot.generation, 'generation');
    const fs = new MemoryFileSystem(options);
    if (snapshot.entries.length > fs.maxInodes) throw new FsError('ENOSPC', 'Snapshot exceeds inode quota');
    const records = new Map<string, SnapshotEntry>();
    let bytes = 0;
    for (const entry of snapshot.entries) {
      if (!entry || typeof entry !== 'object') throw new FsError('EINVAL', 'Invalid snapshot entry');
      checkPath(entry.path);
      if (!entry.path.startsWith('/') || absolute(components(entry.path)) !== entry.path || components(entry.path).some(part => part === '.' || part === '..')) {
        throw new FsError('EINVAL', 'Snapshot paths must be canonical and absolute');
      }
      if (records.has(entry.path)) throw new FsError('EINVAL', 'Duplicate snapshot path');
      checkMode(entry.mode);
      if (!['file', 'directory', 'symlink'].includes(entry.type)) throw new FsError('EINVAL', 'Invalid snapshot entry type');
      if (entry.type === 'file') {
        if (!(entry.data instanceof Uint8Array) || entry.target !== undefined) throw new FsError('EINVAL', 'Invalid file entry');
        bytes += entry.data.length;
      } else if (entry.type === 'symlink') {
        checkPath(entry.target!);
        if (entry.data !== undefined) throw new FsError('EINVAL', 'Invalid symlink entry');
        bytes += encoder.encode(entry.target).length;
      } else if (entry.data !== undefined || entry.target !== undefined) throw new FsError('EINVAL', 'Invalid directory entry');
      if (bytes > fs.maxBytes) throw new FsError('ENOSPC', 'Snapshot exceeds byte quota');
      records.set(entry.path, entry);
    }
    if (records.get('/')?.type !== 'directory') throw new FsError('EINVAL', 'Snapshot needs a root directory');
    const mounts = new Map<string, boolean>();
    for (const mount of snapshot.mounts) {
      if (!mount || typeof mount.path !== 'string' || typeof mount.readonly !== 'boolean' || mounts.has(mount.path) || records.get(mount.path)?.type !== 'directory') {
        throw new FsError('EINVAL', 'Invalid or duplicate snapshot mount');
      }
      mounts.set(mount.path, mount.readonly);
    }
    if (mounts.get('/') !== true) throw new FsError('EINVAL', 'Root mount must be readonly');
    for (const [path, entry] of records) {
      if (path === '/') continue;
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (records.get(parent)?.type !== 'directory') throw new FsError('ENOTDIR', 'Snapshot parent is missing or not a directory');
      if (entry.type === 'directory' && components(path).length > 128) throw new FsError('EINVAL', 'Snapshot exceeds directory depth limit');
    }
    fs.nodes.clear();
    fs.mounts = mounts;
    const built = new Map<string, Inode>();
    const orderedMounts = [...mounts.keys()].sort((a, b) => b.length - a.length);
    for (const [path, entry] of [...records].sort(([a], [b]) => components(a).length - components(b).length)) {
      const mount = orderedMounts.find(candidate => within(path, candidate))!;
      const node = fs.allocate(entry.type, mount, entry.mode);
      node.data = entry.data?.slice() ?? new Uint8Array();
      node.target = entry.target ?? '';
      built.set(path, node);
      if (path === '/') fs.root = node;
      else {
        const end = path.lastIndexOf('/');
        built.get(path.slice(0, end) || '/')!.children.set(path.slice(end + 1), node);
      }
    }
    fs.usedBytes = bytes;
    fs.revision = snapshot.generation;
    return fs;
  }

  acquireSnapshot(): FileSystemLease {
    if (this.lease || this.descriptors.size) throw new FsError('EBUSY', 'Snapshot requires no active lease or open host descriptors');
    const token = Symbol('filesystem-lease');
    const generation = this.revision;
    const snapshot = this.exportSnapshot();
    this.lease = token;
    let finished = false;
    return {
      snapshot,
      discard: () => {
        if (!finished) { finished = true; if (this.lease === token) this.lease = undefined; }
      },
      commit: (result) => {
        if (finished || this.lease !== token) throw new FsError('ECONFLICT', 'Snapshot lease is no longer active');
        if (this.revision !== generation) throw new FsError('ECONFLICT', 'Filesystem generation changed');
        const candidate = MemoryFileSystem.fromSnapshot(result, { maxBytes: this.maxBytes, maxInodes: this.maxInodes });
        if (candidate.mounts.size !== this.mounts.size || [...this.mounts].some(([path, readonly]) => candidate.mounts.get(path) !== readonly)) {
          throw new FsError('EROFS', 'Snapshot cannot change the mount table');
        }
        const before = new Map(this.exportSnapshot().entries.map(entry => [entry.path, entry]));
        const after = new Map(candidate.exportSnapshot().entries.map(entry => [entry.path, entry]));
        const mountPaths = [...this.mounts.keys()].sort((a, b) => b.length - a.length);
        for (const path of new Set([...before.keys(), ...after.keys()])) {
          const mount = mountPaths.find(candidatePath => within(path, candidatePath))!;
          const old = before.get(path), next = after.get(path);
          if ((this.mounts.get(mount) || this.mounts.has(path)) && (!old || !next || !sameEntry(old, next))) {
            throw new FsError('EROFS', 'Snapshot changed a readonly entry or mount root');
          }
        }
        // All allocations and checks happen before publication. No host descriptors are
        // admitted during the lease, so replacing private nodes cannot strand a handle.
        this.publish(candidate);
        this.lease = undefined;
        finished = true;
      },
    };
  }

  /** Publish a complete readonly tree after namespace, quota and symlink validation. */
  mountReadonly(path: string, entries: readonly SnapshotEntry[]): void {
    if (this.lease || this.descriptors.size) throw new FsError('EBUSY', 'Mount changes require no active lease or descriptors');
    checkPath(path);
    if (!path.startsWith('/') || absolute(components(path)) !== path || components(path).some(part => part === '.' || part === '..') || path === '/') {
      throw new FsError('EINVAL', 'Mount path must be canonical and absolute');
    }
    if ([...this.mounts.keys()].some(mount => mount !== '/' && (within(path, mount) || within(mount, path)))) {
      throw new FsError('EBUSY', 'Cannot overlap an existing mount');
    }
    const original = this.exportSnapshot();
    const records = new Map(original.entries.map(entry => [entry.path, entry]));
    if ([...records.keys()].some(existing => within(existing, path) && existing !== path)) throw new FsError('EBUSY', 'Mount destination is not empty');
    if (records.has(path) && records.get(path)!.type !== 'directory') throw new FsError('ENOTDIR', 'Mount destination is not a directory');
    let prefix = '';
    for (const part of components(path)) {
      prefix += `/${part}`;
      if (records.has(prefix) && records.get(prefix)!.type !== 'directory') throw new FsError('ENOTDIR', 'Mount parent is not a directory');
      if (!records.has(prefix)) records.set(prefix, { path: prefix, type: 'directory', mode: 0o755 });
    }
    const supplied = new Set<string>();
    for (const entry of entries) {
      checkPath(entry.path);
      if (entry.path.startsWith('/') || components(entry.path).join('/') !== entry.path || components(entry.path).some(part => part === '.' || part === '..') || supplied.has(entry.path)) {
        throw new FsError('EINVAL', 'Package entries need unique canonical relative paths');
      }
      supplied.add(entry.path);
      records.set(`${path}/${entry.path}`, { ...entry, path: `${path}/${entry.path}` });
    }
    const candidate = MemoryFileSystem.fromSnapshot({
      generation: this.revision + 1,
      mounts: [...original.mounts, { path, readonly: true }], entries: [...records.values()],
    }, { maxBytes: this.maxBytes, maxInodes: this.maxInodes });
    for (const entry of entries) {
      if (entry.type !== 'symlink') continue;
      try { candidate.resolve(`${path}/${entry.path}`, { root: path }); }
      catch (error) {
        // Dangling in-package links are legal; escapes and loops are not.
        if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error;
      }
    }
    this.publish(candidate);
  }
}
