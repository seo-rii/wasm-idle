import { FsError } from './errors.js';
import { createFileSystemWatch } from './watch.js';
import type {
  FileStat, FileSystemLease, FileSystemSnapshot, FileType, MemoryFileSystemOptions,
  OpenOptions, PathOptions, SnapshotEntry, FileSystemChange, FileSystemWatchOptions, FileVersion, FileTimes, FileSystemMutationObserver,
} from './types.js';

interface Inode {
  inode: number;
  type: FileType;
  mode: number;
  mount: string;
  /** Logical file bytes; the owned backing buffer may have spare growth capacity. */
  data: Uint8Array;
  target: string;
  children: Map<string, Inode>;
  /** One namespace name per inode; hardlinks are not supported. Root has no parent. */
  parent?: Inode;
  name: string;
  references: number;
  linked: boolean;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  command?: true;
  version: FileVersion;
}

interface Description {
  node: Inode;
  offset: number;
  read: boolean;
  write: boolean;
  resize: boolean;
  append: boolean;
  root: string;
  preserveSnapshot: boolean;
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
function sameEntry(a: SnapshotEntry, b: SnapshotEntry, compareTimes: boolean): boolean {
  return a.inode === b.inode && a.type === b.type && a.mode === b.mode && a.target === b.target && a.command === b.command &&
    (!compareTimes || a.atimeMs === b.atimeMs && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs) &&
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
  private mutationSource: unknown;
  private mutationObservers = new Set<{ generation: number; sources: Set<unknown>; overflow: boolean }>();
  private versionSequence = 0n;
  private versions = new WeakMap<FileVersion, Inode>();
  private lease: symbol | undefined;
  private liveUsers = 0;
  private watchers = new Set<{ root: string; push(change: FileSystemChange): void }>();
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
      this.attach(parent, name, this.allocate('directory', writable ? path : parent.mount, 0o755));
    }
    // A reserved identity keeps existing persisted workspace inode numbers stable
    // when their readonly base namespace is recreated by a newer host.
    this.attach(this.walk('/dev', '/', true).node, 'null', this.allocate('character-device', '/', 0o666));
  }

  get generation(): number { return this.revision; }

  /** Attribute only the synchronous part of a trusted owner operation; never an await. */
  withMutationSource<T>(source: unknown, operation: () => T): T {
    const previous = this.mutationSource;
    this.mutationSource = source;
    try { return operation(); } finally { this.mutationSource = previous; }
  }

  observeMutations(): FileSystemMutationObserver {
    if (this.mutationObservers.size >= 64) throw new FsError('ENOSPC', 'Filesystem mutation observer limit reached');
    const observer = { generation: this.revision, sources: new Set<unknown>(), overflow: false };
    this.mutationObservers.add(observer);
    let disposed = false;
    return {
      hasChangesOutside: sources => disposed || observer.overflow || observer.generation !== this.revision ||
        [...observer.sources].some(source => !sources.has(source)),
      dispose: () => { disposed = true; observer.sources.clear(); this.mutationObservers.delete(observer); }
    };
  }

  private advanceGeneration(): void {
    this.revision++;
    for (const observer of this.mutationObservers) {
      observer.generation = this.revision;
      if (observer.sources.size < 64 || observer.sources.has(this.mutationSource)) observer.sources.add(this.mutationSource);
      else observer.overflow = true;
    }
  }

  get byteLength(): number { return this.usedBytes; }
  get inodeCount(): number { return this.nodes.size; }
  get watcherCount(): number { return this.watchers.size; }

  watch(options: FileSystemWatchOptions = {}): ReadableStream<FileSystemChange> {
    const capacity = options.maxQueuedEvents ?? 32;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new FsError('EINVAL', 'Watch queue must contain 1..256 events');
    if (this.watchers.size >= 64) throw new FsError('ENOSPC', 'Filesystem watcher limit reached');
    const resolved = this.resolve(options.path ?? '/workspace');
    if (resolved.node.type !== 'directory') throw new FsError('ENOTDIR', 'Watch scope must be a directory');
    const entry = { root: resolved.path, push: (_change: FileSystemChange) => {} };
    const watch = createFileSystemWatch(entry.root, capacity, options.signal, () => { this.watchers.delete(entry); });
    entry.push = watch.push;
    if (!watch.closed) this.watchers.add(entry);
    return watch.stream;
  }

  private notify(change: Omit<FileSystemChange, 'generation'>): void {
    if (!this.watchers.size) return;
    const event = Object.freeze({ ...change, generation: this.revision });
    for (const watcher of this.watchers) {
      if (event.kind === 'rescan' || within(watcher.root, event.path) && watcher.root !== event.path || event.previousPath && within(watcher.root, event.previousPath)) {
        watcher.push(Object.freeze({ kind: 'rescan', path: watcher.root, generation: this.revision }));
      } else if (within(event.path, watcher.root) || event.previousPath && within(event.previousPath, watcher.root)) watcher.push(event);
    }
  }

  private nodePath(target: Inode): string | undefined {
    // Reconstruct current names without scanning unrelated directory entries.
    // Renaming an ancestor updates one link and is visible to all descendants.
    if (target === this.root) return '/';
    const names: string[] = [];
    let node = target;
    while (node !== this.root) {
      if (!node.linked || !node.parent) return undefined;
      names.push(node.name);
      node = node.parent;
    }
    return absolute(names.reverse());
  }

  private attach(parent: Inode, name: string, node: Inode): void {
    parent.children.set(name, node);
    node.parent = parent;
    node.name = name;
  }

  private notifyFile(node: Inode): void {
    // An unlinked open file has no namespace path, so its writes change no view.
    if (!this.watchers.size || !node.linked) return;
    const path = this.nodePath(node);
    this.notify(path === undefined ? { kind: 'rescan', path: '/' } : { kind: 'modify', path, inode: node.inode });
  }

  private allocate(type: FileType, mount: string, mode: number): Inode {
    if (this.nodes.size >= this.maxInodes) throw new FsError('ENOSPC', 'Filesystem inode quota exceeded');
    if (this.nextInode >= Number.MAX_SAFE_INTEGER) throw new FsError('ENOSPC', 'Filesystem inode identities exhausted');
    checkMode(mode);
    const now = Date.now();
    const inode = type === 'character-device' ? 0 : this.nextInode++;
    const node: Inode = {
      inode, type, mode, mount, data: new Uint8Array(), target: '',
      children: new Map(), name: '', references: 0, linked: true, atimeMs: now, mtimeMs: now, ctimeMs: now,
      version: Object.freeze({ inode, revision: ++this.versionSequence }),
    };
    this.versions.set(node.version, node);
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
    this.advanceGeneration();
    const now = Date.now();
    for (const node of nodes) {
      node.mtimeMs = node.ctimeMs = now;
      this.invalidateVersion(node);
    }
  }

  private invalidateVersion(node: Inode, descendants = false): void {
    node.version = Object.freeze({ inode: node.inode, revision: ++this.versionSequence });
    this.versions.set(node.version, node);
    if (descendants) for (const child of node.children.values()) this.invalidateVersion(child, true);
  }

  /** Trusted owner bookkeeping. A token cannot be forged or used in another filesystem. */
  captureFileVersion(pathOrFd: string | number, options: PathOptions = {}): FileVersion {
    const node = typeof pathOrFd === 'number' ? this.descriptor(pathOrFd).node : this.resolve(pathOrFd, options).node;
    this.file(node);
    return node.version;
  }

  /** Returns a copy only while the exact linked inode revision remains current. */
  readFileVersion(version: FileVersion): { path: string; mode: number; bytes: Uint8Array } | undefined {
    const node = this.versions.get(version);
    if (!node || !this.nodes.has(node) || !node.linked || node.version !== version || node.command) return;
    const path = this.nodePath(node);
    if (path === undefined) return;
    return { path, mode: node.mode, bytes: node.data.slice() };
  }

  /** Owner-only post-validation grant; no guest chmod or RPC operation exposes this. */
  grantExecutable(version: FileVersion): boolean {
    const node = this.versions.get(version);
    if (!node || !this.nodes.has(node) || !node.linked || node.version !== version || node.command) return false;
    this.writable(node);
    const mode = node.mode | ((node.mode & 0o444) >> 2);
    if (mode !== node.mode) { node.mode = mode; this.changed(node); this.notifyFile(node); }
    return true;
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
        const target = components(child.target);
        // A slash in the target requires that target to resolve to a directory,
        // even through another symlink and before any remaining caller suffix.
        if (child.target.endsWith('/')) target.push('.');
        if (child.target.startsWith('/')) {
          if (floor.some((name, i) => target[i] !== name)) throw new FsError('EACCES', 'Symlink escapes the directory capability');
          names.length = 0;
          stack.length = 1;
        }
        queue.unshift(...target);
      } else { names.push(part); stack.push(child); }
    }
    const node = stack[stack.length - 1]!;
    if (path.endsWith('/') && node.type !== 'directory') throw new FsError('ENOTDIR', 'Trailing slash requires a directory');
    const result = absolute(names);
    checkPath(result);
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
    checkPath(`${parent.path === '/' ? '' : parent.path}/${name}`);
    return { ...parent, name };
  }

  /** Find a create destination through a dangling final symlink without replacing it. */
  private createParent(path: string, options: PathOptions): { node: Inode; path: string; name: string } {
    let candidate = path;
    let context = options;
    let requiresDirectory = false;
    for (let hops = 0; hops <= 40; hops++) {
      requiresDirectory ||= candidate.endsWith('/');
      const parent = this.parent(candidate, context);
      const existing = parent.node.children.get(parent.name);
      if (existing?.type !== 'symlink') {
        if (!existing && requiresDirectory) throw new FsError('ENOTDIR', 'File destination has a trailing slash');
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
      atimeMs: node.atimeMs, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs,
      ...(node.command ? { command: true as const } : {}),
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

  /** Metadata updates preserve file contents, descriptor positions and quota usage. */
  setTimes(path: string, times: FileTimes, options: PathOptions = {}, followSymlinks = true): void {
    this.updateTimes(this.resolve(path, options, followSymlinks).node, times);
  }

  fsetTimes(fd: number, times: FileTimes): void { this.updateTimes(this.descriptor(fd).node, times); }

  private updateTimes(node: Inode, times: FileTimes): void {
    if (!times || typeof times !== 'object' || Array.isArray(times)) throw new FsError('EINVAL', 'Invalid timestamp update');
    const values: { atimeMs?: number | 'now'; mtimeMs?: number | 'now' } = Object.create(null);
    for (const [key, value] of Object.entries(times)) {
      if (key !== 'atimeMs' && key !== 'mtimeMs') throw new FsError('EINVAL', 'Unsupported timestamp field');
      if (value !== undefined && value !== 'now') integer(value, key);
      values[key] = value;
    }
    if (values.atimeMs === undefined && values.mtimeMs === undefined) return;
    this.writable(node);
    const now = Date.now();
    if (values.atimeMs !== undefined) node.atimeMs = values.atimeMs === 'now' ? now : values.atimeMs;
    if (values.mtimeMs !== undefined) node.mtimeMs = values.mtimeMs === 'now' ? now : values.mtimeMs;
    node.ctimeMs = now;
    this.advanceGeneration();
    this.invalidateVersion(node);
    this.notifyFile(node);
  }

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
    if (node.command) throw new FsError('ENOTSUP', 'Virtual command entries have no readable executable body');
    if (node.type === 'character-device') return new Uint8Array();
    this.file(node);
    return node.data.slice();
  }

  /** Resolved mount policy for trusted adapters; follows the same path capability. */
  isReadonly(path: string, options: PathOptions = {}): boolean {
    return this.mounts.get(this.resolve(path, options).node.mount) !== false;
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
      const copied = Uint8Array.from(bytes);
      node = this.allocate('file', parent.node.mount, options.mode ?? 0o644);
      node.data = copied;
      this.usedBytes += copied.length;
      this.attach(parent.node, parent.name, node);
      this.changed(parent.node, node);
      this.notify({ kind: 'create', path: `${parent.path === '/' ? '' : parent.path}/${parent.name}`, inode: node.inode });
      return;
    }
    if (node.type === 'character-device') return;
    this.writable(node);
    this.file(node);
    if (this.usedBytes - node.data.length + bytes.length > this.maxBytes) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
    const copied = Uint8Array.from(bytes);
    this.usedBytes += copied.length - node.data.length;
    node.data = copied;
    this.changed(node);
    this.notifyFile(node);
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
    const last = path.split('/').filter(Boolean).at(-1);
    if (last === undefined || last === '.' || last === '..') {
      // "/", "." and ".." name a directory that exists once it resolves (POSIX EEXIST).
      checkPath(path);
      this.resolve(path, options);
      throw new FsError('EEXIST', 'Path already exists');
    }
    const parent = this.parent(path, options);
    // An existing entry is reported before a read-only parent, as Linux does.
    if (parent.node.children.has(parent.name)) throw new FsError('EEXIST', 'Path already exists');
    this.writable(parent.node);
    this.checkPlacement(childPath(parent.path, parent.name));
    const node = this.allocate('directory', parent.node.mount, options.mode ?? 0o755);
    this.attach(parent.node, parent.name, node);
    this.changed(parent.node);
    this.notify({ kind: 'create', path: `${parent.path === '/' ? '' : parent.path}/${parent.name}`, inode: node.inode });
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
    this.attach(parent.node, parent.name, node);
    this.changed(parent.node);
    this.notify({ kind: 'create', path: `${parent.path === '/' ? '' : parent.path}/${parent.name}`, inode: node.inode });
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
    node.parent = undefined;
    this.invalidateVersion(node);
    this.release(node);
    this.changed(parent.node);
    this.notify({ kind: 'remove', path: `${parent.path === '/' ? '' : parent.path}/${parent.name}`, inode: node.inode });
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
    node.parent = undefined;
    this.invalidateVersion(node);
    this.release(node);
    this.changed(parent.node);
    this.notify({ kind: 'remove', path: `${parent.path === '/' ? '' : parent.path}/${parent.name}`, inode: node.inode });
  }

  rename(from: string, to: string, options: PathOptions = {}): void {
    const source = this.parent(from, options);
    const destination = this.parent(to, options);
    const node = source.node.children.get(source.name);
    if (!node) throw new FsError('ENOENT', 'Source does not exist');
    if (node.mount !== source.node.mount) throw new FsError('EBUSY', 'Cannot rename a mount root');
    if (source.node.mount !== destination.node.mount) throw new FsError('EXDEV', 'Cannot rename across mounts');
    const pending = [{ node, path: `${destination.path === '/' ? '' : destination.path}/${destination.name}` }];
    while (pending.length) {
      const entry = pending.pop()!; checkPath(entry.path);
      for (const [name, child] of entry.node.children) pending.push({ node: child, path: `${entry.path}/${name}` });
    }
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
      old.parent = undefined;
      this.invalidateVersion(old, true);
      this.release(old);
    }
    source.node.children.delete(source.name);
    this.attach(destination.node, destination.name, node);
    this.changed(source.node, destination.node, node);
    // Moving a directory away and back must invalidate captured descendant paths too.
    for (const child of node.children.values()) this.invalidateVersion(child, true);
    this.notify({ kind: 'rename', path: `${destination.path === '/' ? '' : destination.path}/${destination.name}`, previousPath: sourcePath, inode: node.inode });
  }

  open(path: string, options: OpenOptions = {}): number {
    if (this.lease) throw new FsError('EBUSY', 'Host descriptors cannot open during a snapshot writer lease');
    if (options.snapshot !== undefined && options.snapshot !== 'preserve') throw new FsError('EINVAL', 'Invalid snapshot descriptor policy');
    const read = options.read ?? !(options.write || options.resize);
    const write = options.write ?? false;
    const resize = options.resize ?? false;
    if (!read && !write && !resize) throw new FsError('EINVAL', 'Open must request read, write or resize access');
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
    if (node.command) throw new FsError('ENOTSUP', 'Virtual commands execute through the registered backend');
    if (options.directory && node.type !== 'directory') throw new FsError('ENOTDIR', 'A directory descriptor was requested');
    if (write && node.type !== 'character-device') { this.writable(node); this.file(node); }
    if (resize && node.type === 'file') this.writable(node);
    if (options.truncate && node.type !== 'character-device') this.resize(node, 0);
    const fd = this.nextFd++;
    node.references++;
    this.descriptors.set(fd, { node, offset: 0, read, write, resize, append: options.append ?? false, root, preserveSnapshot: options.snapshot === 'preserve' });
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
    const path = this.nodePath(description.node);
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
    if (description.node.type === 'character-device') return new Uint8Array();
    this.file(description.node);
    return description.node.data.slice(offset, Math.min(description.node.data.length, offset + length));
  }

  write(fd: number, bytes: Uint8Array): number {
    const description = this.descriptor(fd);
    const offset = description.append ? description.node.data.length : description.offset;
    const written = this.pwrite(fd, bytes, offset);
    if (written !== 0 && description.node.type !== 'character-device') description.offset = offset + written;
    return written;
  }

  pwrite(fd: number, bytes: Uint8Array, offset: number): number {
    integer(offset, 'offset');
    if (!(bytes instanceof Uint8Array)) throw new FsError('EINVAL', 'File content must be Uint8Array');
    const description = this.descriptor(fd);
    if (!description.write) throw new FsError('EBADF', 'Descriptor is not writable');
    const { node } = description;
    if (node.type === 'character-device') return bytes.length;
    this.writable(node);
    this.file(node);
    if (bytes.length === 0) return 0;
    integer(offset + bytes.length, 'write end');
    if (offset + bytes.length > node.data.length) this.resize(node, offset + bytes.length, false);
    node.data.set(bytes, offset);
    this.changed(node);
    this.notifyFile(node);
    return bytes.length;
  }

  seek(fd: number, offset: number, whence: 'set' | 'cur' | 'end' = 'set'): number {
    if (!Number.isSafeInteger(offset)) throw new FsError('EINVAL', 'Offset must be a safe integer');
    const description = this.descriptor(fd);
    if (!['set', 'cur', 'end'].includes(whence)) throw new FsError('EINVAL', 'Invalid seek origin');
    if (description.node.type === 'character-device') return description.offset = 0;
    this.file(description.node);
    const next = offset + (whence === 'cur' ? description.offset : whence === 'end' ? description.node.data.length : 0);
    integer(next, 'resulting offset');
    return description.offset = next;
  }

  private resize(node: Inode, length: number, notify = true): void {
    integer(length, 'length');
    this.file(node);
    this.writable(node);
    const previousLength = node.data.length;
    const available = this.maxBytes - this.usedBytes + previousLength;
    if (length > available) throw new FsError('ENOSPC', 'Filesystem byte quota exceeded');
    let resized = node.data;
    if (length < previousLength) {
      // Release spare capacity on truncation and discard bytes that must never
      // reappear if the file grows again.
      resized = node.data.slice(0, length);
    } else if (length > previousLength) {
      const capacity = node.data.buffer.byteLength - node.data.byteOffset;
      if (length > capacity) {
        // Geometric growth amortizes incremental writes without changing the
        // logical length used by reads, snapshots, EOF or the byte quota.
        const storage = new Uint8Array(Math.min(available, Math.max(length, capacity * 2)));
        storage.set(node.data);
        resized = storage.subarray(0, length);
      } else {
        resized = new Uint8Array(node.data.buffer, node.data.byteOffset, length);
        resized.fill(0, previousLength);
      }
    }
    this.usedBytes += length - previousLength;
    node.data = resized;
    if (notify) { this.changed(node); this.notifyFile(node); }
  }

  truncate(path: string, length = 0, options: PathOptions = {}): void { this.resize(this.resolve(path, options).node, length); }
  ftruncate(fd: number, length = 0): void {
    const description = this.descriptor(fd);
    if (!description.write && !description.resize) throw new FsError('EBADF', 'Descriptor cannot resize files');
    this.resize(description.node, length);
  }

  /**
   * Copy all entries by default. Selection happens before file bytes are copied;
   * partial snapshots retain global metadata and need a complete namespace
   * assembled by the caller before they can be passed to fromSnapshot.
   */
  exportSnapshot(options: { includePath?: (path: string) => boolean } = {}): FileSystemSnapshot {
    const entries: SnapshotEntry[] = [];
    const visit = (node: Inode, path: string): void => {
      if (!options.includePath || options.includePath(path)) {
        entries.push({ inode: node.inode, path, type: node.type, mode: node.mode, atimeMs: node.atimeMs, mtimeMs: node.mtimeMs, ctimeMs: node.ctimeMs,
          ...(node.command ? { command: true as const } : {}),
          ...(node.type === 'file' ? { data: node.data.slice() } : {}),
          ...(node.type === 'symlink' ? { target: node.target } : {}),
        });
      }
      for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
        visit(child, `${path === '/' ? '' : path}/${name}`);
      }
    };
    visit(this.root, '/');
    return { generation: this.revision, nextInode: this.nextInode, mounts: [...this.mounts].map(([path, readonly]) => ({ path, readonly })), entries };
  }

  private publish(candidate: MemoryFileSystem): void {
    const previous = new Map([...this.nodes].map(node => [node.inode, node]));
    const nextNodes = new Map([...candidate.nodes].map(node => [node.inode, node]));
    const descriptions = [...new Set(this.descriptors.values())];
    for (const { node } of descriptions) {
      // Private snapshots do not serialize unlinked inode contents. Keeping the
      // old bytes after a guest modifies then unlinks that file would lose data.
      if (node.linked && !nextNodes.has(node.inode)) throw new FsError('ECONFLICT', 'Snapshot removed an inode with an open host descriptor');
    }
    const retained = [...this.nodes].filter(node => !node.linked && node.references > 0);
    const retainedBytes = retained.reduce((total, node) => total + node.data.length + encoder.encode(node.target).length, 0);
    if (candidate.nodes.size + retained.length > this.maxInodes || candidate.usedBytes + retainedBytes > this.maxBytes) {
      throw new FsError('ENOSPC', 'Snapshot exceeds quota including retained open files');
    }
    const rebound = descriptions.map(description => ({ description, node: nextNodes.get(description.node.inode) ?? description.node }));
    for (const next of candidate.nodes) next.references = previous.get(next.inode)?.references ?? 0;
    const nodes = new Set([...candidate.nodes, ...retained]);
    // Every check and allocation above precedes publication. Rebinding retains
    // shared offsets/flags for dup(), and existing unlinked handles stay private.
    for (const node of candidate.nodes) this.invalidateVersion(node);
    // An obsolete file-version token must not retain the retired tree via parents.
    for (const node of this.nodes) node.parent = undefined;
    for (const { description, node } of rebound) description.node = node;
    this.root = candidate.root;
    this.nodes = nodes;
    this.mounts = candidate.mounts;
    this.usedBytes = candidate.usedBytes + retainedBytes;
    this.nextInode = candidate.nextInode;
    this.advanceGeneration();
    this.notify({ kind: 'rescan', path: '/' });
  }

  /** Decode a structured-clone snapshot only after validating the entire namespace. */
  static fromSnapshot(snapshot: FileSystemSnapshot, options: MemoryFileSystemOptions = {}): MemoryFileSystem {
    if (!snapshot || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.mounts)) throw new FsError('EINVAL', 'Malformed filesystem snapshot');
    integer(snapshot.generation, 'generation');
    integer(snapshot.nextInode, 'nextInode');
    if (snapshot.nextInode < 1) throw new FsError('EINVAL', 'Snapshot nextInode must be positive');
    const fs = new MemoryFileSystem(options);
    if (snapshot.entries.length > fs.maxInodes) throw new FsError('ENOSPC', 'Snapshot exceeds inode quota');
    const records = new Map<string, SnapshotEntry>();
    const identities = new Set<number>();
    let bytes = 0;
    for (const entry of snapshot.entries) {
      if (!entry || typeof entry !== 'object') throw new FsError('EINVAL', 'Invalid snapshot entry');
      integer(entry.inode, 'inode');
      if ((entry.inode === 0 && entry.type !== 'character-device') || entry.inode >= snapshot.nextInode || identities.has(entry.inode)) {
        throw new FsError('EINVAL', 'Snapshot inode identities must be unique and below nextInode');
      }
      identities.add(entry.inode);
      checkPath(entry.path);
      if (!entry.path.startsWith('/') || absolute(components(entry.path)) !== entry.path || components(entry.path).some(part => part === '.' || part === '..')) {
        throw new FsError('EINVAL', 'Snapshot paths must be canonical and absolute');
      }
      if (records.has(entry.path)) throw new FsError('EINVAL', 'Duplicate snapshot path');
      checkMode(entry.mode);
      if (entry.atimeMs !== undefined) integer(entry.atimeMs, 'atimeMs');
      if (entry.mtimeMs !== undefined) integer(entry.mtimeMs, 'mtimeMs');
      if (entry.ctimeMs !== undefined) integer(entry.ctimeMs, 'ctimeMs');
      if (!['file', 'directory', 'symlink', 'character-device'].includes(entry.type)) throw new FsError('EINVAL', 'Invalid snapshot entry type');
      if (entry.type === 'character-device' && (entry.path !== '/dev/null' || entry.inode !== 0 || entry.mode !== 0o666)) {
        throw new FsError('EINVAL', 'Only the immutable /dev/null character device is supported');
      }
      if (entry.command !== undefined && (entry.command !== true || entry.type !== 'file' || entry.mode !== 0o555 || entry.data?.length !== 0)) {
        throw new FsError('EINVAL', 'Invalid virtual command entry');
      }
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
    fs.nextInode = 1;
    fs.mounts = mounts;
    const built = new Map<string, Inode>();
    const orderedMounts = [...mounts.keys()].sort((a, b) => b.length - a.length);
    for (const [path, entry] of [...records].sort(([a], [b]) => components(a).length - components(b).length)) {
      const mount = orderedMounts.find(candidate => within(path, candidate))!;
      if ((entry.command || entry.type === 'character-device') && !mounts.get(mount)) throw new FsError('EINVAL', 'Virtual commands and devices require a readonly mount');
      const node = fs.allocate(entry.type, mount, entry.mode);
      node.command = entry.command;
      node.inode = entry.inode;
      fs.invalidateVersion(node);
      if (entry.mtimeMs !== undefined) node.mtimeMs = entry.mtimeMs;
      if (entry.ctimeMs !== undefined) node.ctimeMs = entry.ctimeMs;
      node.atimeMs = entry.atimeMs ?? node.mtimeMs;
      node.data = entry.data ? Uint8Array.from(entry.data) : new Uint8Array();
      node.target = entry.target ?? '';
      built.set(path, node);
      if (path === '/') fs.root = node;
      else {
        const end = path.lastIndexOf('/');
        fs.attach(built.get(path.slice(0, end) || '/')!, path.slice(end + 1), node);
      }
    }
    fs.usedBytes = bytes;
    fs.revision = snapshot.generation;
    fs.nextInode = snapshot.nextInode;
    return fs;
  }

  /** Live users share operations immediately; a private snapshot cannot replace their tree. */
  acquireLive(): { release(): void } {
    if (this.lease) throw new FsError('EBUSY', 'A snapshot process holds the filesystem writer lease');
    this.liveUsers++;
    let released = false;
    return { release: () => { if (!released) { released = true; this.liveUsers--; } } };
  }

  acquireSnapshot(): FileSystemLease {
    if (this.lease || this.liveUsers || [...this.descriptors.values()].some(description => !description.preserveSnapshot)) {
      throw new FsError('EBUSY', 'Snapshot requires no live process, active lease or unpreserved host descriptor');
    }
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
        if (candidate.nextInode < this.nextInode) throw new FsError('ECONFLICT', 'Snapshot cannot rewind inode allocation');
        const previous = new Map([...this.nodes].map(node => [node.inode, node]));
        const supplied = new Map(result.entries.map(entry => [entry.inode, entry]));
        for (const next of candidate.nodes) {
          const old = previous.get(next.inode);
          if ((!old || !old.linked) && next.inode < this.nextInode) throw new FsError('ECONFLICT', 'Snapshot reused a retired inode identity');
          if (old && (old.type !== next.type || old.mount !== next.mount)) {
            throw new FsError('ECONFLICT', 'Snapshot cannot change an inode type or mount identity');
          }
          // Older adapters did not serialize access time. Their omission must
          // not reset an existing explicit atime during an otherwise valid commit.
          if (old && supplied.get(next.inode)!.atimeMs === undefined) next.atimeMs = old.atimeMs;
        }
        if (candidate.mounts.size !== this.mounts.size || [...this.mounts].some(([path, readonly]) => candidate.mounts.get(path) !== readonly)) {
          throw new FsError('EROFS', 'Snapshot cannot change the mount table');
        }
        const before = new Map(this.exportSnapshot().entries.map(entry => [entry.path, entry]));
        const after = new Map(candidate.exportSnapshot().entries.map(entry => [entry.path, entry]));
        const mountPaths = [...this.mounts.keys()].sort((a, b) => b.length - a.length);
        for (const path of new Set([...before.keys(), ...after.keys()])) {
          const mount = mountPaths.find(candidatePath => within(path, candidatePath))!;
          const old = before.get(path), next = after.get(path);
          // Writable mount roots retain their identity but their child changes update timestamps.
          if ((this.mounts.get(mount) || this.mounts.has(path)) && (!old || !next || !sameEntry(old, next, this.mounts.get(mount)!))) {
            throw new FsError('EROFS', 'Snapshot changed a readonly entry or mount root');
          }
        }
        // Existing opted-in descriptions follow their inode identity. No new
        // descriptors or writes are admitted during the lease.
        this.publish(candidate);
        this.lease = undefined;
        finished = true;
      },
    };
  }

  /** Publish a complete readonly tree after namespace, quota and symlink validation. */
  mountReadonly(path: string, entries: readonly Omit<SnapshotEntry, 'inode'>[]): void {
    this.mountReadonlyPackages([{ path, entries }]);
  }

  /** Publish metadata for trusted backend registrations, never placeholder binaries. */
  mountCommands(path: string, names: readonly string[]): void {
    if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length ||
        names.some(name => typeof name !== 'string' || !name || name.includes('/') || name === '.' || name === '..')) {
      throw new FsError('EINVAL', 'Virtual commands require distinct file names');
    }
    this.mountReadonly(path, names.map(name => ({ path: name, type: 'file', mode: 0o555, command: true, data: new Uint8Array() })));
  }

  /** Stage a dependency closure and publish it as one filesystem generation, or nothing. */
  mountReadonlyPackages(packages: readonly { readonly path: string; readonly entries: readonly Omit<SnapshotEntry, 'inode'>[] }[]): void {
    if (!Array.isArray(packages)) throw new FsError('EINVAL', 'Packages must be an array');
    if (packages.length === 0) return;
    if (packages.length > this.maxInodes) throw new FsError('ENOSPC', 'Package count exceeds inode quota');
    if (this.lease) throw new FsError('EBUSY', 'Mount changes require no snapshot lease');
    const original = this.exportSnapshot();
    const mounts = [...original.mounts];
    let nextInode = this.nextInode;
    const identity = () => {
      if (nextInode >= Number.MAX_SAFE_INTEGER) throw new FsError('ENOSPC', 'Filesystem inode identities exhausted');
      return nextInode++;
    };
    const records = new Map(original.entries.map(entry => [entry.path, entry]));
    for (const pkg of packages) {
      if (!pkg || !Array.isArray(pkg.entries)) throw new FsError('EINVAL', 'Invalid readonly package');
      const { path, entries } = pkg;
      checkPath(path);
      if (!path.startsWith('/') || absolute(components(path)) !== path || components(path).some(part => part === '.' || part === '..') || path === '/') {
        throw new FsError('EINVAL', 'Mount path must be canonical and absolute');
      }
      if (mounts.some(({ path: mount }) => mount !== '/' && (within(path, mount) || within(mount, path)))) {
        throw new FsError('EBUSY', 'Cannot overlap an existing or staged mount');
      }
      if ([...records.keys()].some(existing => within(existing, path) && existing !== path)) throw new FsError('EBUSY', 'Mount destination is not empty');
      if (records.has(path) && records.get(path)!.type !== 'directory') throw new FsError('ENOTDIR', 'Mount destination is not a directory');
      let prefix = '';
      for (const part of components(path)) {
        prefix += `/${part}`;
        if (records.has(prefix) && records.get(prefix)!.type !== 'directory') throw new FsError('ENOTDIR', 'Mount parent is not a directory');
        if (!records.has(prefix)) records.set(prefix, { inode: identity(), path: prefix, type: 'directory', mode: 0o755 });
        if (records.size > this.maxInodes) throw new FsError('ENOSPC', 'Package tree exceeds inode quota');
      }
      if (entries.length > this.maxInodes - records.size) throw new FsError('ENOSPC', 'Package tree exceeds inode quota');
      const supplied = new Set<string>();
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new FsError('EINVAL', 'Invalid readonly package entry');
        checkPath(entry.path);
        if (entry.path.startsWith('/') || components(entry.path).join('/') !== entry.path || components(entry.path).some(part => part === '.' || part === '..') || supplied.has(entry.path)) {
          throw new FsError('EINVAL', 'Package entries need unique canonical relative paths');
        }
        supplied.add(entry.path);
        records.set(`${path}/${entry.path}`, { ...entry, inode: identity(), path: `${path}/${entry.path}` });
      }
      mounts.push({ path, readonly: true });
    }
    const candidate = MemoryFileSystem.fromSnapshot({
      generation: this.revision + 1,
      nextInode,
      mounts, entries: [...records.values()],
    }, { maxBytes: this.maxBytes, maxInodes: this.maxInodes });
    for (const { path, entries } of packages) {
      for (const entry of entries) {
        if (entry.type !== 'symlink') continue;
        try { candidate.resolve(`${path}/${entry.path}`, { root: path }); }
        catch (error) {
          // Dangling in-package links are legal; escapes and loops are not.
          if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error;
        }
      }
    }
    // Mounting is additive. Preserve inode objects and open descriptions, including
    // unlinked open files that exportSnapshot deliberately does not serialize.
    const previous = new Map([...this.nodes].map(node => [node.inode, node]));
    const retained = [...this.nodes].filter(node => !node.linked);
    const retainedBytes = retained.reduce((total, node) => total + node.data.length + encoder.encode(node.target).length, 0);
    if (candidate.nodes.size + retained.length > this.maxInodes || candidate.usedBytes + retainedBytes > this.maxBytes) throw new FsError('ENOSPC', 'Package exceeds quota including open unlinked files');
    const adopted = new Map([...candidate.nodes].map(node => [node.inode, previous.get(node.inode) ?? node]));
    for (const node of adopted.values()) if (!previous.has(node.inode)) this.invalidateVersion(node);
    const staged = [...candidate.nodes].map(node => ({
      node: adopted.get(node.inode)!, mount: node.mount,
      parent: node.parent === undefined ? undefined : adopted.get(node.parent.inode)!, name: node.name,
      children: new Map([...node.children].map(([name, child]) => [name, adopted.get(child.inode)!]))
    }));
    const nodes = new Set([...adopted.values(), ...retained]);
    // No allocation, await, or validation after publication begins.
    for (const entry of staged) {
      entry.node.children = entry.children; entry.node.mount = entry.mount;
      entry.node.parent = entry.parent; entry.node.name = entry.name;
    }
    this.root = adopted.get(candidate.root.inode)!;
    this.nodes = nodes; this.mounts = candidate.mounts;
    this.usedBytes = candidate.usedBytes + retainedBytes; this.nextInode = candidate.nextInode;
    this.advanceGeneration();
    this.notify({ kind: 'rescan', path: '/' });
  }
}
