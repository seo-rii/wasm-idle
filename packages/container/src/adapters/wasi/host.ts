import { MemoryFileSystem, FsError } from '../../fs/index.js';
import { createBatchStdio, type BatchStdio } from './stdio.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const errno: Record<string, number> = { EACCES: 2, EAGAIN: 6, EBADF: 8, EBUSY: 10, EEXIST: 20, EFAULT: 21, EFBIG: 22, EINVAL: 28, EIO: 29, EISDIR: 31, ELOOP: 32, EMFILE: 33, ENOENT: 44, ENOMEM: 48, ENOSPC: 51, ENOSYS: 52, ENOTDIR: 54, ENOTEMPTY: 55, ENOTSUP: 58, EPERM: 63, EPIPE: 64, EROFS: 69, EXDEV: 75, ENOTCAPABLE: 76 };
class WasiFault extends Error { constructor(readonly errno: number) { super(`WASI errno ${errno}`); } }
class WasiExit { constructor(readonly code: number) {} }
interface Handle { fd: number; root: string; label?: string; flags: number; rights: bigint; inherited: bigint; }
interface HostOptions { fs: MemoryFileSystem; args: readonly string[]; env: Readonly<Record<string, string>>; cwd: string; stdin: Uint8Array; maxOutputBytes: number; stdio?: BatchStdio; }
const filetype = (type: string) => type === 'directory' ? 3 : type === 'symlink' ? 7 : 4;
const RIGHTS = (1n << 30n) - 1n;

/** Synchronous batch host. It never returns promises to a Wasm import. */
export function createWasiHost(options: HostOptions) {
  let memory: WebAssembly.Memory;
  const stdio = options.stdio ?? createBatchStdio(options.stdin, options.maxOutputBytes);
  const handles = new Map<number, Handle>();
  const standard = new Set([0, 1, 2]);
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
    return { path, options: { cwd: options.fs.getDirectoryPath(h.fd), root: h.root } };
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
    span(result, 4); const buffers = iovecs(ptr, count); let total = 0;
    if (fd !== 0 || !standard.has(0)) handle(fd, 2n);
    if (fd === 0 && offset !== undefined) throw new WasiFault(70);
    for (const buffer of buffers) {
      const length = Math.min(buffer.length, 1024 * 1024 - total);
      if (!length) { if (total === 1024 * 1024) break; continue; }
      let bytes: Uint8Array;
      if (fd === 0) { bytes = stdio.read(length); }
      else { const h = handle(fd, 2n); bytes = offset === undefined ? options.fs.read(h.fd, length) : options.fs.pread(h.fd, length, safeOffset(offset) + total); }
      buffer.set(bytes); total += bytes.length;
      if (bytes.length < length) break;
    }
    put32(result, total); return 0;
  };
  const fdWrite = (fd: number, ptr: number, count: number, result: number, offset?: bigint) => {
    span(result, 4); const buffers = iovecs(ptr, count); let total = 0;
    if (!([1, 2].includes(fd) && standard.has(fd))) handle(fd, 64n);
    if ([1, 2].includes(fd) && offset !== undefined) throw new WasiFault(70);
    for (const buffer of buffers) {
      const bytes = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024 - total));
      if (!bytes.length) { if (total === 1024 * 1024) break; continue; }
      if (fd === 1 || fd === 2) {
        total += stdio.write(fd, bytes);
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
    fd_close: (fd) => { if (standard.delete(fd)) return 0; options.fs.close(handle(fd).fd); handles.delete(fd); return 0; },
    fd_seek: (fd, offset, whence, ptr) => {
      span(ptr, 8); if (whence < 0 || whence > 2) throw new WasiFault(28);
      const position = options.fs.seek(handle(fd, 4n).fd, safeOffset(offset), (['set', 'cur', 'end'] as const)[whence]!);
      view(ptr, 8).setBigUint64(0, BigInt(position), true); return 0;
    },
    fd_tell: (fd, ptr) => { view(ptr, 8).setBigUint64(0, BigInt(options.fs.tell(handle(fd, 32n).fd)), true); return 0; },
    fd_fdstat_get: (fd, ptr) => {
      span(ptr, 24); const h = standard.has(fd) ? undefined : handle(fd);
      const v = view(ptr, 24); span(ptr, 24).fill(0);
      v.setUint8(0, h ? filetype(options.fs.fstat(h.fd).type) : 2); v.setUint16(2, h?.flags ?? 0, true);
      v.setBigUint64(8, h?.rights ?? (fd === 0 ? 2n : 64n), true); v.setBigUint64(16, h?.inherited ?? 0n, true); return 0;
    },
    fd_fdstat_set_rights: (fd, base, inherited) => { const h = handle(fd); if ((base | h.rights) !== h.rights || (inherited | h.inherited) !== h.inherited) return 76; h.rights = base; h.inherited = inherited; return 0; },
    fd_fdstat_set_flags: (fd, flags) => { const h = handle(fd, 8n); return flags === h.flags ? 0 : 58; },
    fd_filestat_get: (fd, ptr) => {
      if (!standard.has(fd)) return stat(ptr, options.fs.fstat(handle(fd, 1n << 21n).fd));
      span(ptr, 64).fill(0); view(ptr, 64).setUint8(16, 2); return 0;
    },
    fd_filestat_set_size: (fd, length) => { const h = handle(fd, 1n << 22n); options.fs.ftruncate(h.fd, safeOffset(length)); return 0; },
    fd_prestat_get: (fd, ptr) => { const h = handle(fd); if (h.label === undefined) return 8; span(ptr, 8).fill(0); put32(ptr + 4, encoder.encode(h.label).length); return 0; },
    fd_prestat_dir_name: (fd, ptr, length) => { const h = handle(fd); if (h.label === undefined) return 8; const bytes = encoder.encode(h.label); if ((length >>> 0) < bytes.length) return 37; span(ptr, bytes.length).set(bytes); return 0; },
    path_open: (fd, flags, ptr, len, oflags, rights, inherited, fdflags, result) => {
      span(result, 4); if ((flags & ~1) || (oflags & ~15) || (fdflags & ~1)) return 58;
      const parent = handle(fd, 1n << 13n);
      if ((rights | parent.inherited) !== parent.inherited || (inherited | parent.inherited) !== parent.inherited) return 76;
      if ((oflags & 1) && !(parent.rights & (1n << 10n))) return 76;
      if ((oflags & 8) && (!(parent.rights & (1n << 19n)) || !(rights & 64n))) return 76;
      const p = relative(fd, ptr, len);
      if (!(flags & 1)) { try { if (options.fs.lstat(p.path, p.options).type === 'symlink') return 32; } catch (e) { if (!(e instanceof FsError) || e.code !== 'ENOENT') throw e; } }
      let newFd = 3; while (handles.has(newFd)) newFd++; if (newFd >= 256) return 33;
      const opened = options.fs.open(p.path, { ...p.options, read: Boolean(rights & 2n) || !(rights & 64n), write: Boolean(rights & 64n), create: Boolean(oflags & 1), directory: Boolean(oflags & 2), exclusive: Boolean(oflags & 4), truncate: Boolean(oflags & 8), append: Boolean(fdflags & 1) });
      handles.set(newFd, { fd: opened, root: parent.root, flags: fdflags, rights, inherited }); put32(result, newFd); return 0;
    },
    path_filestat_get: (fd, flags, ptr, len, result) => { span(result, 64); if (flags & ~1) return 28; const p = relative(fd, ptr, len, 1n << 18n); return stat(result, flags & 1 ? options.fs.stat(p.path, p.options) : options.fs.lstat(p.path, p.options)); },
    path_create_directory: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 9n); options.fs.mkdir(p.path, p.options); return 0; },
    path_unlink_file: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 26n); options.fs.unlink(p.path, p.options); return 0; },
    path_remove_directory: (fd, ptr, len) => { const p = relative(fd, ptr, len, 1n << 25n); options.fs.rmdir(p.path, p.options); return 0; },
    path_readlink: (fd, ptr, len, buf, length, result) => { span(result, 4); span(buf, length); const p = relative(fd, ptr, len, 1n << 15n); const bytes = encoder.encode(options.fs.readlink(p.path, p.options)).subarray(0, length >>> 0); span(buf, bytes.length).set(bytes); put32(result, bytes.length); return 0; },
    path_symlink: (ptr, len, fd, newPtr, newLen) => { const target = text(ptr, len), p = relative(fd, newPtr, newLen, 1n << 24n); options.fs.symlink(target, p.path, p.options); return 0; },
    path_rename: (oldFd, oldPtr, oldLen, newFd, newPtr, newLen) => {
      const a = relative(oldFd, oldPtr, oldLen, 1n << 16n), b = relative(newFd, newPtr, newLen, 1n << 17n);
      const parentA = options.fs.realpath(a.options.cwd), parentB = options.fs.realpath(b.options.cwd);
      // Both dirfds belong to this container's root capability; resolution remains in VFS.
      options.fs.rename(`${parentA}/${a.path}`, `${parentB}/${b.path}`); return 0;
    },
    fd_readdir: (fd, ptr, length, cookie, result) => {
      const h = handle(fd, 1n << 14n), path = options.fs.getDirectoryPath(h.fd);
      span(result, 4); const destination = span(ptr, length); let written = 0;
      const entries = options.fs.readdir(path), start = safeOffset(cookie);
      if (start < 0) return 28;
      for (let i = start; i < entries.length && written < destination.length; i++) {
        const name = entries[i]!, encoded = encoder.encode(name), info = options.fs.lstat(`${path}/${name}`);
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
