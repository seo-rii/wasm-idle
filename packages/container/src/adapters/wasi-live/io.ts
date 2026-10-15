import { FsError, type FsErrorCode, type MemoryFileSystem, type PathOptions, type OpenOptions, type FileVersion } from '../../fs/index.js';
import { createPipe, pipeReadable, PipeError } from '../../fd/pipe.js';
import { ContainerError } from '../../errors.js';
import { Operation, RPC_BYTES, type RpcCall, type RpcReply } from '../../transport/rpc.js';
import type { RuntimeLimits } from '../types.js';
import type { DelegatedReader, DelegatedStdio, DelegatedWriter } from '../../types.js';
import type { WasiFileSystem, WasiPathReference, WasiDirectoryEntry } from '../wasi/host.js';
import type { WasiStdio } from '../wasi/stdio.js';

export function createRemoteFileSystem(call: RpcCall): WasiFileSystem {
  return {
    paths: {
      open: (reference, options, follow) => call(Operation.PathOpen, [reference, options, follow]).value as number,
      stat: (reference, follow) => call(Operation.PathStat, [reference, follow]).value as ReturnType<WasiFileSystem['stat']>,
      mkdir: reference => { call(Operation.PathMkdir, [reference]); },
      unlink: reference => { call(Operation.PathUnlink, [reference]); },
      rmdir: reference => { call(Operation.PathRmdir, [reference]); },
      readlink: reference => call(Operation.PathReadlink, [reference]).value as string,
      symlink: (target, reference) => { call(Operation.PathSymlink, [target, reference]); },
      rename: (from, to) => { call(Operation.PathRename, [from, to]); },
      entries: directory => call(Operation.DirectoryEntries, [directory]).value as WasiDirectoryEntry[]
    },
    open: (path, options) => call(Operation.Open, [path, options ?? {}]).value as number,
    close: (fd) => { call(Operation.Close, [fd]); },
    stat: (path, options) => call(Operation.Stat, [path, options ?? {}]).value as ReturnType<WasiFileSystem['stat']>,
    lstat: (path, options) => call(Operation.Lstat, [path, options ?? {}]).value as ReturnType<WasiFileSystem['lstat']>,
    fstat: (fd) => call(Operation.Fstat, [fd]).value as ReturnType<WasiFileSystem['fstat']>,
    getDirectoryPath: (fd) => call(Operation.DirectoryPath, [fd]).value as string,
    read: (fd, length) => call(Operation.Read, [fd, Math.min(length, RPC_BYTES)]).bytes!,
    pread: (fd, length, offset) => call(Operation.Pread, [fd, Math.min(length, RPC_BYTES), offset]).bytes!,
    write: (fd, bytes) => call(Operation.Write, [fd], bytes.subarray(0, RPC_BYTES)).value as number,
    pwrite: (fd, bytes, offset) => call(Operation.Pwrite, [fd, offset], bytes.subarray(0, RPC_BYTES)).value as number,
    seek: (fd, offset, whence) => call(Operation.Seek, [fd, offset, whence ?? 'set']).value as number,
    tell: (fd) => call(Operation.Tell, [fd]).value as number,
    ftruncate: (fd, size) => { call(Operation.Truncate, [fd, size]); },
    realpath: (path, options) => call(Operation.Realpath, [path, options ?? {}]).value as string,
    readdir: (path, options) => call(Operation.Readdir, [path, options ?? {}]).value as string[],
    mkdir: (path, options) => { call(Operation.Mkdir, [path, options ?? {}]); },
    unlink: (path, options) => { call(Operation.Unlink, [path, options ?? {}]); },
    rmdir: (path, options) => { call(Operation.Rmdir, [path, options ?? {}]); },
    readlink: (path, options) => call(Operation.Readlink, [path, options ?? {}]).value as string,
    symlink: (target, path, options) => { call(Operation.Symlink, [target, path, options ?? {}]); },
    rename: (oldPath, newPath, options) => { call(Operation.Rename, [oldPath, newPath, options ?? {}]); }
  };
}

export function createRemoteStdio(call: RpcCall, initialOpen: readonly number[] = [0, 1, 2]): WasiStdio {
  if (!Array.isArray(initialOpen) || initialOpen.length > 3 || new Set(initialOpen).size !== initialOpen.length ||
      initialOpen.some(fd => !Number.isInteger(fd) || fd < 0 || fd > 2)) throw new FsError('EINVAL', 'Invalid initial stdio descriptors');
  const open = new Set(initialOpen);
  const check = (fd: number) => { if (!open.has(fd)) throw new FsError('EBADF', 'Standard descriptor is closed'); };
  return {
    isOpen: fd => open.has(fd),
    read: (length) => { check(0); return call(Operation.Stdin, [Math.min(length, RPC_BYTES)]).bytes!; },
    write: (fd, bytes) => { check(fd); return call(Operation.Stdout, [fd], bytes.subarray(0, RPC_BYTES)).value as number; },
    close: (fd) => { check(fd); open.delete(fd); call(Operation.StdioClose, [fd]); },
    capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() })
  };
}

const delegatedCodes = new Set<string>(['EINVAL', 'EBADF', 'EACCES', 'EISDIR', 'ENOTSUP', 'EPIPE', 'EIO']);
/** Report a caller endpoint failure to the guest as one of its own errno values. */
function delegatedError(error: unknown): FsError {
  const code = (error as { code?: unknown } | null)?.code;
  return new FsError(typeof code === 'string' && delegatedCodes.has(code) ? code as FsErrorCode : 'EIO', 'Delegated descriptor failed');
}

/** All descriptors and pending I/O belong to this invocation, even in a shared VFS. */
export function createLiveIo(fs: MemoryFileSystem, limits: RuntimeLimits, capacity: number, onFailure: (error: unknown) => void, stdio?: DelegatedStdio,
  onFileChange?: (kind: 'write' | 'rename', version: FileVersion, previous?: FileVersion) => void) {
  const input = createPipe(capacity), output = createPipe(capacity), errorOutput = createPipe(capacity);
  const descriptors = new Map<number, { fd: number; root: string }>(), closedStdio = new Set<number>();
  // Caller-owned endpoints replace the container pipe for that channel.
  const delegated = new Map<number, DelegatedReader | DelegatedWriter>();
  let nextFd = 3, disposed = false, inputClosed = false, inputBytes = 0, outputBytes = 0;
  const closeInput = () => { if (!inputClosed) { inputClosed = true; input.writer.close(); } };
  const closeStdio = (fd: number) => {
    if (closedStdio.has(fd)) throw new FsError('EBADF', 'Standard descriptor closed');
    closedStdio.add(fd);
    const endpoint = delegated.get(fd);
    if (endpoint) {
      delegated.delete(fd);
      try { endpoint.close(); } catch (error) { throw delegatedError(error); }
      return;
    }
    if (fd === 0) input.reader.close(); else (fd === 1 ? output : errorOutput).writer.close();
  };
  for (const [fd, name] of [[0, 'stdin'], [1, 'stdout'], [2, 'stderr']] as const) {
    if (!stdio || !(name in stdio)) continue;
    const endpoint = stdio[name];
    // The container stream for this channel ends immediately; the guest uses the endpoint.
    if (fd === 0) { inputClosed = true; input.writer.close(); input.reader.close(); }
    else (fd === 1 ? output : errorOutput).writer.close();
    if (endpoint) delegated.set(fd, endpoint); else closedStdio.add(fd);
  }
  const number = (n: unknown, signed = false) => {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || !signed && n < 0) throw new FsError('EINVAL', 'Invalid I/O number');
    return n;
  };
  const path = (p: unknown) => { if (typeof p !== 'string' || p.length > 4096 || p.includes('\0')) throw new FsError('EINVAL', 'Invalid I/O path'); return p; };
  const options = (value: unknown, open = false, anchored = false): OpenOptions => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FsError('EINVAL', 'Invalid path options');
    for (const [key, item] of Object.entries(value)) {
      if (!anchored && (key === 'cwd' || key === 'root')) path(item);
      else if (open && key === 'mode') number(item);
      else if (open && ['read', 'write', 'create', 'exclusive', 'truncate', 'append', 'directory'].includes(key) && typeof item === 'boolean') continue;
      else throw new FsError('EINVAL', 'Unsupported path option');
    }
    return value as OpenOptions;
  };
  const descriptor = (n: unknown) => {
    const descriptor = descriptors.get(number(n));
    if (descriptor === undefined) throw new FsError('EBADF', 'Descriptor does not belong to this process');
    return descriptor;
  };
  const fd = (n: unknown) => descriptor(n).fd;
  const reference = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 3 || !Object.keys(value).every(key => ['directory', 'path', 'root'].includes(key))) throw new FsError('EINVAL', 'Invalid path reference');
    const ref = value as WasiPathReference, owner = descriptor(ref.directory), name = path(ref.path);
    if (name.startsWith('/') || path(ref.root) !== owner.root) throw new FsError('EACCES', 'Path exceeds directory capability');
    return { path: name, cwd: fs.getDirectoryPath(owner.fd), root: owner.root };
  };
  const follow = (value: unknown) => { if (typeof value !== 'boolean') throw new FsError('EINVAL', 'Invalid lookup flags'); return value; };
  const open = (name: string, flags: OpenOptions, root: string, allowSymlink = true) => {
    if (descriptors.size >= 256 || nextFd >= 0x7fffffff) throw new FsError('ENOSPC', 'Descriptor budget exceeded');
    if (!allowSymlink) {
      try { if (fs.lstat(name, flags).type === 'symlink') throw new FsError('ELOOP', 'Final symlink requires follow permission'); }
      catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; }
    }
    let before: FileVersion | undefined;
    if (onFileChange && !flags.directory && (flags.create || flags.truncate)) {
      try { before = fs.captureFileVersion(name, flags); }
      catch (error) { if (!(error instanceof FsError) || !['ENOENT', 'EISDIR'].includes(error.code)) throw error; }
    }
    const opened = fs.open(name, flags), local = nextFd++;
    descriptors.set(local, { fd: opened, root });
    if (onFileChange && !flags.directory && (flags.create || flags.truncate) && fs.fstat(opened).type === 'file') {
      const after = fs.captureFileVersion(opened);
      if (after !== before) onFileChange('write', after, before);
    }
    return local;
  };
  const fileVersion = (name: string, context: PathOptions) => onFileChange && fs.lstat(name, context).type === 'file'
    ? fs.captureFileVersion(name, context) : undefined;
  const renamed = (name: string, context: PathOptions, before?: FileVersion) => {
    if (before) onFileChange!('rename', fs.captureFileVersion(name, context), before);
  };
  const length = (n: unknown) => { const size = number(n); if (size > RPC_BYTES) throw new FsError('EINVAL', 'I/O exceeds channel'); return size; };
  const stdout = pipeReadable(output.reader), stderr = pipeReadable(errorOutput.reader);
  const stdin = new WritableStream<Uint8Array>({
    start(controller) { controller.signal.addEventListener('abort', closeInput, { once: true }); },
    async write(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'stdin requires bytes');
      if (inputBytes + bytes.length > limits.maxInputBytes) {
        const error = new ContainerError('RESOURCE_LIMIT', 'Live stdin exceeds configured limit'); onFailure(error); throw error;
      }
      inputBytes += bytes.length;
      // Snapshot the caller's write before the first asynchronous wait.
      const owned = Uint8Array.from(bytes);
      let offset = 0;
      while (offset < owned.length) offset += await input.writer.write(owned.subarray(offset));
    },
    close: closeInput, abort: closeInput
  }, { highWaterMark: 1 });
  return {
    stdin, stdout, stderr,
    /** Only an explicitly null delegated endpoint starts closed; stdin EOF stays open. */
    openStdio: Object.freeze([0, 1, 2].filter(fd => !closedStdio.has(fd))),
    dispose() {
      if (disposed) return;
      disposed = true;
      // Delegated endpoints remain open: their caller owns them. Their
      // container pipe ends were already closed when the channel was delegated.
      for (const fd of delegated.keys()) closedStdio.add(fd);
      delegated.clear();
      for (const n of [0, 1, 2]) if (!closedStdio.has(n)) closeStdio(n);
      for (const descriptor of descriptors.values()) fs.close(descriptor.fd);
      descriptors.clear();
    },
    async dispatch(op: Operation, args: unknown[], bytes: Uint8Array): Promise<RpcReply> {
      if (disposed) throw new FsError('EBADF', 'Process I/O is closed');
      const arities: Record<Operation, number> = {
        [Operation.Open]: 2, [Operation.Close]: 1, [Operation.Stat]: 2, [Operation.Lstat]: 2, [Operation.Fstat]: 1,
        [Operation.DirectoryPath]: 1, [Operation.Read]: 2, [Operation.Pread]: 3, [Operation.Write]: 1, [Operation.Pwrite]: 2,
        [Operation.Seek]: 3, [Operation.Tell]: 1, [Operation.Truncate]: 2, [Operation.Realpath]: 2, [Operation.Readdir]: 2,
        [Operation.Mkdir]: 2, [Operation.Unlink]: 2, [Operation.Rmdir]: 2, [Operation.Readlink]: 2, [Operation.Symlink]: 3,
        [Operation.Rename]: 3, [Operation.Stdin]: 1, [Operation.Stdout]: 1, [Operation.StdioClose]: 1,
        [Operation.PathOpen]: 3, [Operation.PathStat]: 2, [Operation.PathMkdir]: 1, [Operation.PathUnlink]: 1,
        [Operation.PathRmdir]: 1, [Operation.PathReadlink]: 1, [Operation.PathSymlink]: 2,
        [Operation.PathRename]: 2, [Operation.DirectoryEntries]: 1
      };
      if (args.length !== arities[op] || bytes.length > RPC_BYTES || bytes.length && ![Operation.Write, Operation.Pwrite, Operation.Stdout].includes(op)) throw new FsError('EINVAL', 'Invalid I/O arguments');
      const [a, b, c] = args;
      let value: unknown = null;
      try {
        switch (op) {
          case Operation.Open: {
            const flags = options(b, true), root = fs.realpath(flags.root ?? '/');
            value = open(path(a), flags, root); break;
          }
          case Operation.Close: fs.close(fd(a)); descriptors.delete(number(a)); break;
          case Operation.Stat: value = fs.stat(path(a), options(b)); break;
          case Operation.Lstat: value = fs.lstat(path(a), options(b)); break;
          case Operation.Fstat: value = fs.fstat(fd(a)); break;
          case Operation.DirectoryPath: value = fs.getDirectoryPath(fd(a)); break;
          case Operation.Read: return { bytes: fs.read(fd(a), length(b)) };
          case Operation.Pread: return { bytes: fs.pread(fd(a), length(b), number(c)) };
          case Operation.Write: {
            const before = onFileChange ? fs.captureFileVersion(fd(a)) : undefined;
            value = fs.write(fd(a), bytes);
            if (value) onFileChange?.('write', fs.captureFileVersion(fd(a)), before); break;
          }
          case Operation.Pwrite: {
            const before = onFileChange ? fs.captureFileVersion(fd(a)) : undefined;
            value = fs.pwrite(fd(a), bytes, number(b));
            if (value) onFileChange?.('write', fs.captureFileVersion(fd(a)), before); break;
          }
          case Operation.Seek:
            if (c !== 'set' && c !== 'cur' && c !== 'end') throw new FsError('EINVAL', 'Invalid seek origin');
            value = fs.seek(fd(a), number(b, true), c); break;
          case Operation.Tell: value = fs.tell(fd(a)); break;
          case Operation.Truncate: {
            const before = onFileChange ? fs.captureFileVersion(fd(a)) : undefined;
            fs.ftruncate(fd(a), number(b)); onFileChange?.('write', fs.captureFileVersion(fd(a)), before); break;
          }
          case Operation.Realpath: value = fs.realpath(path(a), options(b)); break;
          case Operation.Readdir: {
            const entries = fs.readdir(path(a), options(b));
            // Bound the encoded reply before allocating one large JSON string.
            let size = 2;
            for (const entry of entries) { size += new TextEncoder().encode(JSON.stringify(entry)).length + 1; if (size > RPC_BYTES) throw new FsError('ENOSPC', 'Directory listing exceeds live profile metadata limit'); }
            value = entries; break;
          }
          case Operation.Mkdir: fs.mkdir(path(a), options(b)); break;
          case Operation.Unlink: fs.unlink(path(a), options(b)); break;
          case Operation.Rmdir: fs.rmdir(path(a), options(b)); break;
          case Operation.Readlink: value = fs.readlink(path(a), options(b)); break;
          case Operation.Symlink: fs.symlink(path(a), path(b), options(c)); break;
          case Operation.Rename: {
            const context = options(c) as PathOptions;
            const before = fileVersion(path(a), context);
            fs.rename(path(a), path(b), context); renamed(path(b), context, before); break;
          }
          // Resolve the owned descriptor and complete the filesystem operation
          // synchronously on this owner. Never return a path for a later syscall.
          case Operation.PathOpen: {
            const ref = reference(a), flags = options(b, true, true);
            value = open(ref.path, { ...flags, cwd: ref.cwd, root: ref.root }, ref.root, follow(c)); break;
          }
          case Operation.PathStat: {
            const ref = reference(a); value = follow(b) ? fs.stat(ref.path, ref) : fs.lstat(ref.path, ref); break;
          }
          case Operation.PathMkdir: { const ref = reference(a); fs.mkdir(ref.path, ref); break; }
          case Operation.PathUnlink: { const ref = reference(a); fs.unlink(ref.path, ref); break; }
          case Operation.PathRmdir: { const ref = reference(a); fs.rmdir(ref.path, ref); break; }
          case Operation.PathReadlink: { const ref = reference(a); value = fs.readlink(ref.path, ref); break; }
          case Operation.PathSymlink: { const ref = reference(b); fs.symlink(path(a), ref.path, ref); break; }
          case Operation.PathRename: {
            const from = reference(a), to = reference(b);
            if (from.root !== to.root) throw new FsError('EACCES', 'Rename requires a common root capability');
            const context = { root: from.root, cwd: from.root };
            const before = fileVersion(`${from.cwd}/${from.path}`, context);
            fs.rename(`${from.cwd}/${from.path}`, `${to.cwd}/${to.path}`, context);
            renamed(`${to.cwd}/${to.path}`, context, before); break;
          }
          case Operation.DirectoryEntries: {
            const owner = descriptor(a), cwd = fs.getDirectoryPath(owner.fd), context = { cwd, root: owner.root };
            const entries: WasiDirectoryEntry[] = []; let size = 2;
            for (const name of fs.readdir('.', context)) {
              const entry = { name, stat: fs.lstat(name, context) };
              size += new TextEncoder().encode(JSON.stringify(entry)).length + 1;
              if (size > RPC_BYTES) throw new FsError('ENOSPC', 'Directory listing exceeds live profile metadata limit');
              entries.push(entry);
            }
            value = entries; break;
          }
          case Operation.Stdin: {
            if (closedStdio.has(0)) throw new FsError('EBADF', 'stdin is closed');
            const size = length(a), endpoint = delegated.get(0) as DelegatedReader | undefined;
            if (!endpoint) return { bytes: await input.reader.read(size) };
            if (!size) return { bytes: new Uint8Array() };
            let data: unknown;
            try { data = await endpoint.read(size); } catch (error) { throw delegatedError(error); }
            if (!(data instanceof Uint8Array) || data.length > size) throw new FsError('EIO', 'Delegated stdin returned invalid bytes');
            return { bytes: data.slice() };
          }
          case Operation.Stdout: {
            if (a !== 1 && a !== 2 || closedStdio.has(a)) throw new FsError('EBADF', 'Output descriptor is closed');
            const endpoint = delegated.get(a) as DelegatedWriter | undefined;
            if (endpoint) {
              // Delegated output is not captured here, so the capture budget does not apply.
              if (!bytes.length) { value = 0; break; }
              let written: unknown;
              try { written = await endpoint.write(bytes.slice()); } catch (error) { throw delegatedError(error); }
              if (typeof written !== 'number' || !Number.isSafeInteger(written) || written < 0 || written > bytes.length) throw new FsError('EIO', 'Delegated output returned an invalid count');
              value = written; break;
            }
            if (outputBytes + bytes.length > limits.maxOutputBytes) throw new ContainerError('RESOURCE_LIMIT', 'Live stdout/stderr exceed configured limit');
            value = await (a === 1 ? output : errorOutput).writer.write(bytes); outputBytes += value as number; break;
          }
          case Operation.StdioClose:
            if (a !== 0 && a !== 1 && a !== 2) throw new FsError('EBADF', 'Invalid standard descriptor');
            closeStdio(a); break;
          default: throw new FsError('ENOTSUP', 'Unknown I/O operation');
        }
      } catch (error) { if (error instanceof PipeError) throw new FsError(error.code, error.message); throw error; }
      return { value };
    }
  };
}
