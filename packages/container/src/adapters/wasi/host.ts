import { type MemoryFileSystem, type OpenOptions, type FileStat, FsError } from '../../fs/index.js';
import { createBatchStdio, type WasiStdio } from './stdio.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const errno: Record<string, number> = { EACCES: 2, EAGAIN: 6, EBADF: 8, EBUSY: 10, EEXIST: 20, EFAULT: 21, EFBIG: 22, EINVAL: 28, EIO: 29, EISDIR: 31, ELOOP: 32, EMFILE: 33, ENOENT: 44, ENOMEM: 48, ENOSPC: 51, ENOSYS: 52, ENOTDIR: 54, ENOTEMPTY: 55, ENOTSUP: 58, EPERM: 63, EPIPE: 64, EROFS: 69, EXDEV: 75, ENOTCAPABLE: 76 };
class WasiFault extends Error { constructor(readonly errno: number) { super(`WASI errno ${errno}`); } }
class WasiExit { constructor(readonly code: number) {} }
interface Handle { fd: number; root: string; label?: string; flags: number; rights: bigint; inherited: bigint; entries?: readonly WasiDirectoryEntry[]; }
export interface WasiPathReference { readonly directory: number; readonly path: string; readonly root: string; }
export interface WasiDirectoryEntry { readonly name: string; readonly stat: FileStat; }
/** Optional atomic path binding: a live host must resolve dirfds on its resource owner. */
export interface WasiPathBinding {
  open(reference: WasiPathReference, options: OpenOptions, follow: boolean): number;
  stat(reference: WasiPathReference, follow: boolean): FileStat;
  mkdir(reference: WasiPathReference): void;
  unlink(reference: WasiPathReference): void;
  rmdir(reference: WasiPathReference): void;
  readlink(reference: WasiPathReference): string;
  symlink(target: string, reference: WasiPathReference): void;
  rename(from: WasiPathReference, to: WasiPathReference): void;
  entries(directory: number): readonly WasiDirectoryEntry[];
}
export type WasiFileSystem = Pick<MemoryFileSystem, 'open' | 'close' | 'stat' | 'lstat' | 'fstat' | 'getDirectoryPath' | 'read' | 'pread' | 'write' | 'pwrite' | 'seek' | 'tell' | 'ftruncate' | 'realpath' | 'readdir' | 'mkdir' | 'unlink' | 'rmdir' | 'readlink' | 'symlink' | 'rename'> & { readonly paths?: WasiPathBinding };
interface HostOptions { fs: WasiFileSystem; args: readonly string[]; env: Readonly<Record<string, string>>; cwd: string; stdin: Uint8Array; maxOutputBytes: number; stdio?: WasiStdio; }
const filetype = (type: string) => type === 'directory' ? 3 : type === 'symlink' ? 7 : type === 'character-device' ? 2 : 4;
const RIGHTS = (1n << 30n) - 1n;

/** Synchronous WASI imports. A live binding may block only its dedicated guest Worker. */
export function createWasiHost(options: HostOptions) {
  let memory: WebAssembly.Memory;
  const stdio: WasiStdio = options.stdio ?? createBatchStdio(options.stdin, options.maxOutputBytes);
  const handles = new Map<number, Handle>();
  const standard = new Set([0, 1, 2].filter(fd => stdio.isOpen?.(fd) ?? true));
  let nextFd = 3;
  // Real relative file access is rooted at cwd. Absolute paths use the root preopen.
  for (const [label, path] of [['.', options.cwd], ['/', '/']] as const) {
    handles.set(nextFd++, { fd: options.fs.open(path, { directory: true, read: true }), root: '/', label, flags: 0, rights: RIGHTS, inherited: RIGHTS });
  }
  const span = (ptr: number, length: number) => {
    ptr >>>= 0; length >>>= 0;
    if (!memory || ptr + length > memory.buffer.byteLength) throw new WasiFault(21);
    return new Uint8Array(memory.buffer, ptr, length);
  };
  const view = (ptr: number, length: number) => { span(ptr, length); return new DataView(memory.buffer, ptr >>> 0, length); };
  const put32 = (ptr: number, value: number) => view(ptr, 4).setUint32(0, value, true);
  const text = (ptr: number, length: number) => {
    if ((length >>> 0) > 4096) throw new WasiFault(28);
    try { const value = decoder.decode(span(ptr, length)); if (value.includes('\0')) throw new WasiFault(28); return value; }
    catch (error) { if (error instanceof WasiFault) throw error; throw new WasiFault(28); }
  };
  const handle = (fd: number, right = 0n) => {
    const h = handles.get(fd);
    if (!h) throw new WasiFault(8);
    if ((h.rights & right) !== right) throw new WasiFault(76);
    return h;
  };
  const relative = (fd: number, ptr: number, len: number, right = 0n) => {
    const h = handle(fd, right), path = text(ptr, len);
    if (path.startsWith('/')) throw new WasiFault(76);
    return { path, directory: h.fd, root: h.root };
  };
  const pathOptions = (reference: WasiPathReference) => ({ cwd: options.fs.getDirectoryPath(reference.directory), root: reference.root });
  // Batch bindings are synchronous, so resolution and mutation cannot interleave.
  // Live bindings replace the whole operation, including lookup flags and metadata.
  const paths: WasiPathBinding = options.fs.paths ?? {
    open(reference, flags, follow) {
      const context = pathOptions(reference);
      if (!follow) {
        try { if (options.fs.lstat(reference.path, context).type === 'symlink') throw new FsError('ELOOP', 'Final symlink requires follow permission'); }
        catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; }
      }
      return options.fs.open(reference.path, { ...flags, ...context });
    },
    stat: (reference, follow) => follow ? options.fs.stat(reference.path, pathOptions(reference)) : options.fs.lstat(reference.path, pathOptions(reference)),
    mkdir: reference => options.fs.mkdir(reference.path, pathOptions(reference)),
    unlink: reference => options.fs.unlink(reference.path, pathOptions(reference)),
    rmdir: reference => options.fs.rmdir(reference.path, pathOptions(reference)),
    readlink: reference => options.fs.readlink(reference.path, pathOptions(reference)),
    symlink: (target, reference) => options.fs.symlink(target, reference.path, pathOptions(reference)),
    rename(from, to) {
      if (from.root !== to.root) throw new FsError('EACCES', 'Rename requires a common root capability');
      const a = pathOptions(from), b = pathOptions(to);
      options.fs.rename(`${a.cwd}/${from.path}`, `${b.cwd}/${to.path}`, { root: from.root, cwd: from.root });
    },
    entries(directory) {
      const path = options.fs.getDirectoryPath(directory);
      return options.fs.readdir(path).map(name => ({ name, stat: options.fs.lstat(`${path}/${name}`) }));
    }
  };
  const iovecs = (ptr: number, count: number) => {
    count >>>= 0;
    if (count > 1024) throw new WasiFault(28);
    const table = view(ptr, count * 8);
    return Array.from({ length: count }, (_, i) => span(table.getUint32(i * 8, true), table.getUint32(i * 8 + 4, true)));
  };
  const strings = (values: readonly string[], ptr: number, data: number) => {
    const encoded = values.map((value) => encoder.encode(value + '\0'));
    span(ptr, encoded.length * 4); span(data, encoded.reduce((n, b) => n + b.length, 0));
    for (let i = 0; i < encoded.length; i++) { put32(ptr + i * 4, data); span(data, encoded[i]!.length).set(encoded[i]!); data += encoded[i]!.length; }
    return 0;
  };
  const sizes = (values: readonly string[], count: number, bytes: number) => {
    span(count, 4); span(bytes, 4);
    put32(count, values.length); put32(bytes, values.reduce((n, value) => n + encoder.encode(value).length + 1, 0)); return 0;
  };
  const env = Object.entries(options.env).map(([key, value]) => `${key}=${value}`);
  const stat = (ptr: number, info: ReturnType<MemoryFileSystem['stat']>) => {
    const dest = span(ptr, 64); dest.fill(0); const v = view(ptr, 64);
    v.setBigUint64(8, BigInt(info.inode), true); v.setUint8(16, filetype(info.type)); v.setBigUint64(24, 1n, true);
    v.setBigUint64(32, BigInt(info.size), true);
    v.setBigUint64(40, BigInt(Math.trunc(info.mtimeMs)) * 1000000n, true);
    v.setBigUint64(48, BigInt(Math.trunc(info.mtimeMs)) * 1000000n, true);
    v.setBigUint64(56, BigInt(Math.trunc(info.ctimeMs)) * 1000000n, true);
    return 0;
  };
  const safeOffset = (value: bigint) => { const n = Number(value); if (!Number.isSafeInteger(n)) throw new WasiFault(28); return n; };
  const fdRead = (fd: number, ptr: number, count: number, result: number, offset?: bigint) => {
    span(result, 4); const buffers = iovecs(ptr, count);
    if (fd !== 0 || !standard.has(0)) handle(fd, 2n);
    const input = fd === 0 && standard.has(fd);
    if (input && offset !== undefined) throw new WasiFault(70);
    const length = buffers.reduce((total, buffer) => Math.min(1024 * 1024, total + buffer.length), 0);
    if (!length) { put32(result, 0); return 0; }
    // A stream read must return bytes already available without blocking again on
    // the next iovec. Perform one bounded read, then scatter its partial result.
    const bytes = input ? stdio.read(length) : offset === undefined
      ? options.fs.read(handle(fd, 2n).fd, length)
      : options.fs.pread(handle(fd, 2n).fd, length, safeOffset(offset));
    if (bytes.length > length) throw new WasiFault(29);
    let copied = 0;
    for (const buffer of buffers) {
      const n = Math.min(buffer.length, bytes.length - copied);
      buffer.set(bytes.subarray(copied, copied + n)); copied += n;
      if (copied === bytes.length) break;
    }
    put32(result, copied); return 0;
  };
  const fdWrite = (fd: number, ptr: number, count: number, result: number, offset?: bigint) => {
    span(result, 4); const buffers = iovecs(ptr, count); let total = 0;
    const output = (fd === 1 || fd === 2) && standard.has(fd);
    if (!output) handle(fd, 64n);
    if (output && offset !== undefined) throw new WasiFault(70);
    for (const buffer of buffers) {
      const bytes = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024 - total));
      if (!bytes.length) { if (total === 1024 * 1024) break; continue; }
      if (output) {
        const n = stdio.write(fd as 1 | 2, bytes);
        total += n; if (n < bytes.length) break;
      } else {
        const h = handle(fd, 64n);
        const n = offset === undefined ? options.fs.write(h.fd, bytes) : options.fs.pwrite(h.fd, bytes, safeOffset(offset) + total);
        total += n; if (n < bytes.length) break;
      }
    }
    put32(result, total); return 0;
  };
  const funcs: Record<string, (...args: any[]) => number | never> = {
    args_sizes_get: (a, b) => sizes(options.args, a, b), args_get: (a, b) => strings(options.args, a, b),
    environ_sizes_get: (a, b) => sizes(env, a, b), environ_get: (a, b) => strings(env, a, b),
    proc_exit: (code) => { throw new WasiExit(code >>> 0); },
    fd_read: fdRead, fd_pread: (fd, ptr, count, offset, result) => fdRead(fd, ptr, count, result, offset),
    fd_write: fdWrite, fd_pwrite: (fd, ptr, count, offset, result) => fdWrite(fd, ptr, count, result, offset),
    fd_close: (fd) => { if (standard.delete(fd)) { stdio.close?.(fd); return 0; } options.fs.close(handle(fd).fd); handles.delete(fd); return 0; },
    fd_seek: (fd, offset, whence, ptr) => {
      span(ptr, 8); if (whence < 0 || whence > 2) throw new WasiFault(28);
      const position = options.fs.seek(handle(fd, 4n).fd, safeOffset(offset), (['set', 'cur', 'end'] as const)[whence]!);
      view(ptr, 8).setBigUint64(0, BigInt(position), true); return 0;
    },
    fd_tell: (fd, ptr) => { view(ptr, 8).setBigUint64(0, BigInt(options.fs.tell(handle(fd, 32n).fd)), true); return 0; },
    fd_fdstat_get: (fd, ptr) => {
      span(ptr, 24); const h = standard.has(fd) ? undefined : handle(fd);
      const v = view(ptr, 24); span(ptr, 24).fill(0);
      // Preview1 has no FIFO type. Byte streams are not terminal character devices.
      v.setUint8(0, h ? filetype(options.fs.fstat(h.fd).type) : 0); v.setUint16(2, h?.flags ?? 0, true);
      v.setBigUint64(8, h?.rights ?? (fd === 0 ? 2n : 64n), true); v.setBigUint64(16, h?.inherited ?? 0n, true); return 0;
    },
    fd_fdstat_set_rights: (fd, base, inherited) => { const h = handle(fd); if ((base | h.rights) !== h.rights || (inherited | h.inherited) !== h.inherited) return 76; h.rights = base; h.inherited = inherited; return 0; },
    fd_fdstat_set_flags: (fd, flags) => {
      // Standard streams report no flags; only that unchanged value is accepted.
      if (standard.has(fd)) return flags === 0 ? 0 : 58;
      const h = handle(fd, 8n);
      // Files/directories complete synchronously; NONBLOCK does not change I/O.
      // APPEND is part of the open description and cannot be changed here yet.
      if ((flags & ~5) || (flags & 1) !== (h.flags & 1)) return 58;
      h.flags = flags; return 0;
    },
    fd_filestat_get: (fd, ptr) => {
      if (!standard.has(fd)) return stat(ptr, options.fs.fstat(handle(fd, 1n << 21n).fd));
      span(ptr, 64).fill(0); return 0;
    },
    fd_filestat_set_size: (fd, length) => { const h = handle(fd, 1n << 22n); options.fs.ftruncate(h.fd, safeOffset(length)); return 0; },
    fd_prestat_get: (fd, ptr) => { const h = handle(fd); if (h.label === undefined) return 8; span(ptr, 8).fill(0); put32(ptr + 4, encoder.encode(h.label).length); return 0; },
    fd_prestat_dir_name: (fd, ptr, length) => { const h = handle(fd); if (h.label === undefined) return 8; const bytes = encoder.encode(h.label); if ((length >>> 0) < bytes.length) return 37; span(ptr, bytes.length).set(bytes); return 0; },
    path_open: (fd, flags, ptr, len, oflags, rights, inherited, fdflags, result) => {
      span(result, 4); if ((flags & ~1) || (oflags & ~15) || (fdflags & ~5)) return 58;
      const parent = handle(fd, 1n << 13n);
      if ((rights | parent.inherited) !== parent.inherited || (inherited | parent.inherited) !== parent.inherited) return 76;
      if ((oflags & 1) && !(parent.rights & (1n << 10n))) return 76;
      if ((oflags & 8) && (!(parent.rights & (1n << 19n)) || !(rights & 64n))) return 76;
      const p = relative(fd, ptr, len);
      let newFd = 0; while (handles.has(newFd) || standard.has(newFd)) newFd++; if (newFd >= 256) return 33;
      const opened = paths.open(p, { read: Boolean(rights & 2n) || !(rights & 64n), write: Boolean(rights & 64n), create: Boolean(oflags & 1), directory: Boolean(oflags & 2), exclusive: Boolean(oflags & 4), truncate: Boolean(oflags & 8), append: Boolean(fdflags & 1) }, Boolean(flags & 1));
      handles.set(newFd, { fd: opened, root: parent.root, flags: fdflags, rights, inherited }); put32(result, newFd); return 0;
    },
    path_filestat_get: (fd, flags, ptr, len, result) => { span(result, 64); if (flags & ~1) return 28; const p = relative(fd, ptr, len, 1n << 18n); return stat(result, paths.stat(p, Boolean(flags & 1))); },
    path_create_directory: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 9n); paths.mkdir(p); return 0; },
    path_unlink_file: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 26n); paths.unlink(p); return 0; },
    path_remove_directory: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 25n); paths.rmdir(p); return 0; },
    path_readlink: (fd, ptr, len, buf, length, result) => { span(result, 4); span(buf, length); const p = relative(fd, ptr, len, 1n << 15n); const bytes = encoder.encode(paths.readlink(p)).subarray(0, length >>> 0); span(buf, bytes.length).set(bytes); put32(result, bytes.length); return 0; },
    path_symlink: (ptr, len, fd, newPtr, newLen) => { const target = text(ptr, len), p = relative(fd, newPtr, newLen, 1n << 24n); paths.symlink(target, p); return 0; },
    path_rename: (oldFd, oldPtr, oldLen, newFd, newPtr, newLen) => {
      const a = relative(oldFd, oldPtr, oldLen, 1n << 16n), b = relative(newFd, newPtr, newLen, 1n << 17n);
      paths.rename(a, b); return 0;
    },
    fd_readdir: (fd, ptr, length, cookie, result) => {
      const h = handle(fd, 1n << 14n);
      span(result, 4); const destination = span(ptr, length); let written = 0;
      const start = safeOffset(cookie);
      if (start < 0) return 28;
      if (!destination.length) { put32(result, 0); return 0; }
      // Cookies index one listing owned by this open directory, not a re-sorted
      // namespace after each mutation. Explicit rewind refreshes that listing.
      if (start === 0 || !h.entries) h.entries = paths.entries(h.fd);
      const entries = h.entries;
      for (let i = start; i < entries.length && written < destination.length; i++) {
        const { name, stat: info } = entries[i]!, encoded = encoder.encode(name);
        const record = new Uint8Array(24 + encoded.length), v = new DataView(record.buffer);
        v.setBigUint64(0, BigInt(i + 1), true); v.setBigUint64(8, BigInt(info.inode), true); v.setUint32(16, encoded.length, true); v.setUint8(20, filetype(info.type)); record.set(encoded, 24);
        const n = Math.min(record.length, destination.length - written); destination.set(record.subarray(0, n), written); written += n;
      }
      put32(result, written); return 0;
    },
    random_get: (ptr, length) => { const data = span(ptr, length); for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536)); return 0; },
    clock_time_get: (clock, _precision, ptr) => { if (clock !== 0 && clock !== 1) return 28; const n = clock === 0 ? Date.now() : performance.now(); view(ptr, 8).setBigUint64(0, BigInt(Math.trunc(n * 1e6)), true); return 0; },
    clock_res_get: (clock, ptr) => { if (clock !== 0 && clock !== 1) return 28; view(ptr, 8).setBigUint64(0, 1000000n, true); return 0; },
    sched_yield: () => 0,
    // Unsupported sync, metadata mutation, process and polling are explicit errno failures.
    poll_oneoff: () => 52, fd_sync: () => 58, fd_datasync: () => 58,
    fd_filestat_set_times: () => 58, path_filestat_set_times: () => 58, path_link: () => 58,
    proc_raise: () => 58
  };
  const imports = Object.fromEntries(Object.entries(funcs).map(([name, fn]) => [name, (...args: any[]) => {
    try { return fn(...args); }
    catch (error) { if (error instanceof WasiFault) return error.errno; if (error instanceof FsError) return errno[error.code] ?? 29; throw error; }
  }]));
  return {
    imports,
    processImports: {
      initial_cwd(ptr: number, capacity: number) {
        const bytes = encoder.encode(options.cwd + '\0');
        try {
          if ((capacity >>> 0) < bytes.length) return -1;
          span(ptr, capacity).subarray(0, bytes.length).set(bytes);
          return bytes.length;
        } catch (error) { if (error instanceof WasiFault) return -1; throw error; }
      }
    },
    run(instance: WebAssembly.Instance) {
      memory = instance.exports.memory as WebAssembly.Memory;
      let code = 0;
      try { (instance.exports._start as () => void)(); }
      catch (error) { if (error instanceof WasiExit) code = error.code; else throw error; }
      return { code, ...stdio.capture() };
    },
    dispose() { for (const h of handles.values()) options.fs.close(h.fd); handles.clear(); }
  };
}
