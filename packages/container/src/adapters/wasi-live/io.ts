import { FsError, type MemoryFileSystem, type PathOptions, type OpenOptions } from '../../fs/index.js';
import { createPipe, pipeReadable, PipeError } from '../../fd/pipe.js';
import { ContainerError } from '../../errors.js';
import { Operation, RPC_BYTES, type RpcCall, type RpcReply } from '../../transport/rpc.js';
import type { RuntimeLimits } from '../types.js';
import type { WasiFileSystem } from '../wasi/host.js';
import type { WasiStdio } from '../wasi/stdio.js';

export function createRemoteFileSystem(call: RpcCall): WasiFileSystem {
  return {
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
  const descriptors = new Map<number, number>(), closedStdio = new Set<number>();
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
  const path = (p: unknown) => { if (typeof p !== 'string' || p.length > 4096) throw new FsError('EINVAL', 'Invalid I/O path'); return p; };
  const options = (value: unknown, open = false): OpenOptions => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FsError('EINVAL', 'Invalid path options');
    for (const [key, item] of Object.entries(value)) {
      if (key === 'cwd' || key === 'root') path(item);
      else if (open && key === 'mode') number(item);
      else if (open && ['read', 'write', 'create', 'exclusive', 'truncate', 'append', 'directory'].includes(key) && typeof item === 'boolean') continue;
      else throw new FsError('EINVAL', 'Unsupported path option');
    }
    return value as OpenOptions;
  };
  const fd = (n: unknown) => {
    const descriptor = descriptors.get(number(n));
    if (descriptor === undefined) throw new FsError('EBADF', 'Descriptor does not belong to this process');
    return descriptor;
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
      const owned = bytes.slice();
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
      for (const descriptor of descriptors.values()) fs.close(descriptor);
      descriptors.clear();
    },
    async dispatch(op: Operation, args: unknown[], bytes: Uint8Array): Promise<RpcReply> {
      if (disposed) throw new FsError('EBADF', 'Process I/O is closed');
      const arities: Record<Operation, number> = {
        [Operation.Open]: 2, [Operation.Close]: 1, [Operation.Stat]: 2, [Operation.Lstat]: 2, [Operation.Fstat]: 1,
        [Operation.DirectoryPath]: 1, [Operation.Read]: 2, [Operation.Pread]: 3, [Operation.Write]: 1, [Operation.Pwrite]: 2,
        [Operation.Seek]: 3, [Operation.Tell]: 1, [Operation.Truncate]: 2, [Operation.Realpath]: 2, [Operation.Readdir]: 2,
        [Operation.Mkdir]: 2, [Operation.Unlink]: 2, [Operation.Rmdir]: 2, [Operation.Readlink]: 2, [Operation.Symlink]: 3,
        [Operation.Rename]: 3, [Operation.Stdin]: 1, [Operation.Stdout]: 1, [Operation.StdioClose]: 1
      };
      if (args.length !== arities[op] || bytes.length > RPC_BYTES || bytes.length && ![Operation.Write, Operation.Pwrite, Operation.Stdout].includes(op)) throw new FsError('EINVAL', 'Invalid I/O arguments');
      const [a, b, c] = args;
      let value: unknown = null;
      try {
        switch (op) {
          case Operation.Open: {
            if (descriptors.size >= 256 || nextFd >= 0x7fffffff) throw new FsError('ENOSPC', 'Descriptor budget exceeded');
            const opened = fs.open(path(a), options(b, true)); value = nextFd++; descriptors.set(value as number, opened); break;
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
