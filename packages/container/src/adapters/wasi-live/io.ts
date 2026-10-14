import { FsError, type MemoryFileSystem, type PathOptions, type OpenOptions } from '../../fs/index.js';
import { createPipe, pipeReadable, PipeError } from '../../fd/pipe.js';
import { ContainerError } from '../../errors.js';
import { Operation, RPC_BYTES, type RpcCall, type RpcReply } from '../../transport/rpc.js';
import type { RuntimeLimits } from '../types.js';
import type { WasiFileSystem, WasiPathReference, WasiDirectoryEntry } from '../wasi/host.js';
import type { WasiStdio } from '../wasi/stdio.js';

// VFS descriptors never block, so a regular-file transfer larger than the RPC data
// area repeats until complete, matching batch results. Bytes already transferred are
// reported instead of a later chunk's errno, as a POSIX partial transfer would be.
// Channel failures are never hidden.
function readChunks(length: number, chunk: (offset: number, length: number) => Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < length) {
      const requested = Math.min(length - total, RPC_BYTES), bytes = chunk(total, requested);
      if (bytes.length > requested) throw new FsError('EIO', 'Live read exceeded its request');
      parts.push(bytes); total += bytes.length;
      if (bytes.length < requested) break;
    }
  } catch (error) { if (!total || !(error instanceof FsError)) throw error; }
  if (parts.length === 1) return parts[0]!;
  const result = new Uint8Array(total); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function writeChunks(bytes: Uint8Array, chunk: (offset: number, bytes: Uint8Array) => number): number {
  let total = 0;
  try {
    while (total < bytes.length) {
      const requested = bytes.subarray(total, total + RPC_BYTES), n = chunk(total, requested);
      if (!Number.isSafeInteger(n) || n < 0 || n > requested.length) throw new FsError('EIO', 'Live write reported an invalid count');
      total += n;
      if (n < requested.length) break;
    }
  } catch (error) { if (!total || !(error instanceof FsError)) throw error; }
  return total;
}

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
    read: (fd, length) => readChunks(length, (_, n) => call(Operation.Read, [fd, n]).bytes!),
    pread: (fd, length, offset) => readChunks(length, (done, n) => call(Operation.Pread, [fd, n, offset + done]).bytes!),
    write: (fd, bytes) => writeChunks(bytes, (_, chunk) => call(Operation.Write, [fd], chunk).value as number),
    pwrite: (fd, bytes, offset) => writeChunks(bytes, (done, chunk) => call(Operation.Pwrite, [fd, offset + done], chunk).value as number),
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

export function createRemoteStdio(call: RpcCall): WasiStdio {
  return {
    read: (length) => call(Operation.Stdin, [Math.min(length, RPC_BYTES)]).bytes!,
    write: (fd, bytes) => call(Operation.Stdout, [fd], bytes.subarray(0, RPC_BYTES)).value as number,
    close: (fd) => { call(Operation.StdioClose, [fd]); },
    capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() })
  };
}

/** All descriptors and pending I/O belong to this invocation, even in a shared VFS. */
export function createLiveIo(fs: MemoryFileSystem, limits: RuntimeLimits, capacity: number, onFailure: (error: unknown) => void) {
  const input = createPipe(capacity), output = createPipe(capacity), errorOutput = createPipe(capacity);
  const descriptors = new Map<number, { fd: number; root: string }>(), closedStdio = new Set<number>();
  let nextFd = 3, disposed = false, inputClosed = false, inputBytes = 0, outputBytes = 0;
  const closeInput = () => { if (!inputClosed) { inputClosed = true; input.writer.close(); } };
  const closeStdio = (fd: number) => {
    if (closedStdio.has(fd)) throw new FsError('EBADF', 'Standard descriptor closed');
    closedStdio.add(fd);
    if (fd === 0) input.reader.close(); else (fd === 1 ? output : errorOutput).writer.close();
  };
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
    const opened = fs.open(name, flags), local = nextFd++;
    descriptors.set(local, { fd: opened, root }); return local;
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
    dispose() {
      if (disposed) return;
      disposed = true;
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
          case Operation.Write: value = fs.write(fd(a), bytes); break;
          case Operation.Pwrite: value = fs.pwrite(fd(a), bytes, number(b)); break;
          case Operation.Seek:
            if (c !== 'set' && c !== 'cur' && c !== 'end') throw new FsError('EINVAL', 'Invalid seek origin');
            value = fs.seek(fd(a), number(b, true), c); break;
          case Operation.Tell: value = fs.tell(fd(a)); break;
          case Operation.Truncate: fs.ftruncate(fd(a), number(b)); break;
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
          case Operation.Rename: fs.rename(path(a), path(b), options(c) as PathOptions); break;
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
            fs.rename(`${from.cwd}/${from.path}`, `${to.cwd}/${to.path}`, { root: from.root, cwd: from.root }); break;
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
          case Operation.Stdin:
            if (closedStdio.has(0)) throw new FsError('EBADF', 'stdin is closed');
            return { bytes: await input.reader.read(length(a)) };
          case Operation.Stdout: {
            if (a !== 1 && a !== 2 || closedStdio.has(a)) throw new FsError('EBADF', 'Output descriptor is closed');
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
