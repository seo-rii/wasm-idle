// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/fs/errors.js
var FsError = class extends Error {
  code;
  name = "FsError";
  errno;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.errno = code;
  }
};

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/transport/rpc.js
var RPC_VERSION = 1;
var RPC_BYTES = 65536;
var HEADER_BYTES = 64;
var RPC_SIZE = HEADER_BYTES + 2 * RPC_BYTES;
var Operation;
(function(Operation2) {
  Operation2[Operation2["Open"] = 1] = "Open";
  Operation2[Operation2["Close"] = 2] = "Close";
  Operation2[Operation2["Stat"] = 3] = "Stat";
  Operation2[Operation2["Lstat"] = 4] = "Lstat";
  Operation2[Operation2["Fstat"] = 5] = "Fstat";
  Operation2[Operation2["DirectoryPath"] = 6] = "DirectoryPath";
  Operation2[Operation2["Read"] = 7] = "Read";
  Operation2[Operation2["Pread"] = 8] = "Pread";
  Operation2[Operation2["Write"] = 9] = "Write";
  Operation2[Operation2["Pwrite"] = 10] = "Pwrite";
  Operation2[Operation2["Seek"] = 11] = "Seek";
  Operation2[Operation2["Tell"] = 12] = "Tell";
  Operation2[Operation2["Truncate"] = 13] = "Truncate";
  Operation2[Operation2["Realpath"] = 14] = "Realpath";
  Operation2[Operation2["Readdir"] = 15] = "Readdir";
  Operation2[Operation2["Mkdir"] = 16] = "Mkdir";
  Operation2[Operation2["Unlink"] = 17] = "Unlink";
  Operation2[Operation2["Rmdir"] = 18] = "Rmdir";
  Operation2[Operation2["Readlink"] = 19] = "Readlink";
  Operation2[Operation2["Symlink"] = 20] = "Symlink";
  Operation2[Operation2["Rename"] = 21] = "Rename";
  Operation2[Operation2["Stdin"] = 22] = "Stdin";
  Operation2[Operation2["Stdout"] = 23] = "Stdout";
  Operation2[Operation2["StdioClose"] = 24] = "StdioClose";
  Operation2[Operation2["PathOpen"] = 25] = "PathOpen";
  Operation2[Operation2["PathStat"] = 26] = "PathStat";
  Operation2[Operation2["PathMkdir"] = 27] = "PathMkdir";
  Operation2[Operation2["PathUnlink"] = 28] = "PathUnlink";
  Operation2[Operation2["PathRmdir"] = 29] = "PathRmdir";
  Operation2[Operation2["PathReadlink"] = 30] = "PathReadlink";
  Operation2[Operation2["PathSymlink"] = 31] = "PathSymlink";
  Operation2[Operation2["PathRename"] = 32] = "PathRename";
  Operation2[Operation2["DirectoryEntries"] = 33] = "DirectoryEntries";
})(Operation || (Operation = {}));
var encoder = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var errorCodes = /* @__PURE__ */ new Set(["EINVAL", "ENOENT", "ENOTDIR", "EISDIR", "EBADF", "ELOOP", "EXDEV", "EACCES", "EROFS", "EEXIST", "ENOTEMPTY", "ENOSPC", "EBUSY", "ENOTSUP", "ECONFLICT", "EPIPE", "EIO"]);
function channel(buffer, generation) {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== RPC_SIZE || !Number.isSafeInteger(generation) || generation < 1)
    throw new Error("Invalid RPC channel");
  const header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  const metadata = new Uint8Array(buffer, HEADER_BYTES, RPC_BYTES), data = new Uint8Array(buffer, HEADER_BYTES + RPC_BYTES, RPC_BYTES);
  const identity = () => {
    if (Atomics.load(
      header,
      1
      /* Field.Version */
    ) !== RPC_VERSION || Atomics.load(
      header,
      2
      /* Field.GenerationLow */
    ) >>> 0 !== generation >>> 0 || Atomics.load(
      header,
      3
      /* Field.GenerationHigh */
    ) !== Math.floor(generation / 2 ** 32))
      throw new Error("Invalid RPC generation");
  };
  const lengths = () => {
    const a = Atomics.load(
      header,
      6
      /* Field.MetadataLength */
    ), b = Atomics.load(
      header,
      7
      /* Field.DataLength */
    );
    if (a < 1 || a > RPC_BYTES || b < 0 || b > RPC_BYTES)
      throw new Error("Invalid RPC payload length");
    return [a, b];
  };
  const stop = () => {
    Atomics.store(
      header,
      0,
      3
      /* State.Stopped */
    );
    Atomics.notify(
      header,
      0
      /* Field.State */
    );
  };
  return { header, metadata, data, identity, lengths, stop };
}
function createRpcClient(buffer, generation, post, maxBlockedIoMs) {
  if (!Number.isSafeInteger(maxBlockedIoMs) || maxBlockedIoMs < 1 || maxBlockedIoMs > 36e5)
    throw new Error("Invalid RPC wait deadline");
  const c = channel(buffer, generation);
  c.identity();
  let sequence = 0;
  return (operation, args, bytes = new Uint8Array()) => {
    c.identity();
    if (Atomics.load(
      c.header,
      0
      /* Field.State */
    ) !== 0 || sequence === 2147483647)
      throw new Error("RPC channel unavailable");
    const encoded = encoder.encode(JSON.stringify(args));
    if (encoded.length > RPC_BYTES || bytes.length > RPC_BYTES)
      throw new FsError("ENOSPC", "RPC request exceeds bounded channel");
    const id = ++sequence;
    c.metadata.set(encoded);
    c.data.set(bytes);
    c.header[
      4
      /* Field.Request */
    ] = id;
    c.header[
      5
      /* Field.Operation */
    ] = operation;
    c.header[
      6
      /* Field.MetadataLength */
    ] = encoded.length;
    c.header[
      7
      /* Field.DataLength */
    ] = bytes.length;
    c.header[
      8
      /* Field.Error */
    ] = 0;
    Atomics.store(
      c.header,
      0,
      1
      /* State.Request */
    );
    post({ type: "io", version: RPC_VERSION, generation, id });
    const deadline = performance.now() + maxBlockedIoMs;
    while (Atomics.load(
      c.header,
      0
      /* Field.State */
    ) === 1) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        c.stop();
        throw new Error("RPC wait deadline exceeded");
      }
      Atomics.wait(c.header, 0, 1, remaining);
    }
    c.identity();
    if (Atomics.load(
      c.header,
      0
      /* Field.State */
    ) !== 2 || c.header[
      4
      /* Field.Request */
    ] !== id || c.header[
      5
      /* Field.Operation */
    ] !== operation)
      throw new Error("RPC stopped or corrupt response");
    const [a, b] = c.lengths();
    const value = JSON.parse(decoder.decode(c.metadata.slice(0, a)));
    const resultBytes = c.data.slice(0, b), error = c.header[
      8
      /* Field.Error */
    ];
    Atomics.store(
      c.header,
      0,
      0
      /* State.Idle */
    );
    if (error === 1 && typeof value === "string" && errorCodes.has(value))
      throw new FsError(value, `Live I/O failed: ${value}`);
    if (error !== 0)
      throw new Error("Invalid RPC error response");
    return { value, bytes: resultBytes };
  };
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasi/stdio.js
function createBatchStdio(stdin, maxOutputBytes) {
  let inputOffset = 0, outputBytes = 0;
  const output = [new Uint8Array(0), new Uint8Array(0)];
  const sizes = [0, 0];
  return {
    read(length) {
      const bytes = stdin.subarray(inputOffset, inputOffset + length);
      inputOffset += bytes.length;
      return bytes;
    },
    write(fd, bytes) {
      if (outputBytes + bytes.length > maxOutputBytes)
        throw new Error("Batch output exceeds configured limit");
      const index = fd - 1, used = sizes[index], required = used + bytes.length;
      if (required > output[index].length) {
        const grown = new Uint8Array(Math.min(maxOutputBytes, Math.max(4096, required, output[index].length * 2)));
        grown.set(output[index]);
        output[index] = grown;
      }
      output[index].set(bytes, used);
      sizes[index] = required;
      outputBytes += bytes.length;
      return bytes.length;
    },
    capture() {
      return { stdout: output[0].slice(0, sizes[0]), stderr: output[1].slice(0, sizes[1]) };
    }
  };
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasi/host.js
var encoder2 = new TextEncoder();
var decoder2 = new TextDecoder("utf-8", { fatal: true });
var errno = { EACCES: 2, EAGAIN: 6, EBADF: 8, EBUSY: 10, EEXIST: 20, EFAULT: 21, EFBIG: 22, EINVAL: 28, EIO: 29, EISDIR: 31, ELOOP: 32, EMFILE: 33, ENOENT: 44, ENOMEM: 48, ENOSPC: 51, ENOSYS: 52, ENOTDIR: 54, ENOTEMPTY: 55, ENOTSUP: 58, EPERM: 63, EPIPE: 64, EROFS: 69, EXDEV: 75, ENOTCAPABLE: 76 };
var WasiFault = class extends Error {
  errno;
  constructor(errno2) {
    super(`WASI errno ${errno2}`);
    this.errno = errno2;
  }
};
var WasiExit = class {
  code;
  constructor(code) {
    this.code = code;
  }
};
var filetype = (type) => type === "directory" ? 3 : type === "symlink" ? 7 : type === "character-device" ? 2 : 4;
var RIGHTS = (1n << 30n) - 1n;
var FD_READ = 2n;
var FD_SEEK = 4n;
var FD_TELL = 32n;
var FD_WRITE = 64n;
var hasRights = (granted, requested) => {
  const effective = granted & FD_SEEK ? granted | FD_TELL : granted;
  return (effective & requested) === requested;
};
function createWasiHost(options) {
  let memory;
  const stdio = options.stdio ?? createBatchStdio(options.stdin, options.maxOutputBytes);
  const handles = /* @__PURE__ */ new Map();
  const standard = new Set([0, 1, 2].filter((fd) => stdio.isOpen?.(fd) ?? true));
  let nextFd = 3;
  for (const [label, path] of [[".", options.cwd], ["/", "/"]]) {
    handles.set(nextFd++, { fd: options.fs.open(path, { directory: true, read: true }), root: "/", label, flags: 0, rights: RIGHTS, inherited: RIGHTS });
  }
  const span = (ptr, length) => {
    ptr >>>= 0;
    length >>>= 0;
    if (!memory || ptr + length > memory.buffer.byteLength)
      throw new WasiFault(21);
    return new Uint8Array(memory.buffer, ptr, length);
  };
  const view = (ptr, length) => {
    span(ptr, length);
    return new DataView(memory.buffer, ptr >>> 0, length);
  };
  const put32 = (ptr, value) => view(ptr, 4).setUint32(0, value, true);
  const text = (ptr, length) => {
    if (length >>> 0 > 4096)
      throw new WasiFault(28);
    try {
      const value = decoder2.decode(span(ptr, length));
      if (value.includes("\0"))
        throw new WasiFault(28);
      return value;
    } catch (error) {
      if (error instanceof WasiFault)
        throw error;
      throw new WasiFault(28);
    }
  };
  const handle = (fd, right = 0n) => {
    const h = handles.get(fd);
    if (!h)
      throw new WasiFault(8);
    if (!hasRights(h.rights, right))
      throw new WasiFault(76);
    return h;
  };
  const relative = (fd, ptr, len, right = 0n) => {
    const h = handle(fd, right), path = text(ptr, len);
    if (path.startsWith("/"))
      throw new WasiFault(76);
    return { path, directory: h.fd, root: h.root };
  };
  const pathOptions = (reference) => ({ cwd: options.fs.getDirectoryPath(reference.directory), root: reference.root });
  const paths = options.fs.paths ?? {
    open(reference, flags, follow) {
      const context = pathOptions(reference);
      if (!follow) {
        try {
          if (options.fs.lstat(reference.path, context).type === "symlink")
            throw new FsError("ELOOP", "Final symlink requires follow permission");
        } catch (error) {
          if (!(error instanceof FsError) || error.code !== "ENOENT")
            throw error;
        }
      }
      return options.fs.open(reference.path, { ...flags, ...context });
    },
    stat: (reference, follow) => follow ? options.fs.stat(reference.path, pathOptions(reference)) : options.fs.lstat(reference.path, pathOptions(reference)),
    mkdir: (reference) => options.fs.mkdir(reference.path, pathOptions(reference)),
    unlink: (reference) => options.fs.unlink(reference.path, pathOptions(reference)),
    rmdir: (reference) => options.fs.rmdir(reference.path, pathOptions(reference)),
    readlink: (reference) => options.fs.readlink(reference.path, pathOptions(reference)),
    symlink: (target, reference) => options.fs.symlink(target, reference.path, pathOptions(reference)),
    rename(from, to) {
      if (from.root !== to.root)
        throw new FsError("EACCES", "Rename requires a common root capability");
      const a = pathOptions(from), b = pathOptions(to);
      options.fs.rename(`${a.cwd}/${from.path}`, `${b.cwd}/${to.path}`, { root: from.root, cwd: from.root });
    },
    entries(directory) {
      const path = options.fs.getDirectoryPath(directory);
      return options.fs.readdir(path).map((name) => ({ name, stat: options.fs.lstat(`${path}/${name}`) }));
    }
  };
  const iovecs = (ptr, count) => {
    count >>>= 0;
    if (count > 1024)
      throw new WasiFault(28);
    const table = view(ptr, count * 8);
    return Array.from({ length: count }, (_, i) => span(table.getUint32(i * 8, true), table.getUint32(i * 8 + 4, true)));
  };
  const strings = (values, ptr, data) => {
    const encoded = values.map((value) => encoder2.encode(value + "\0"));
    span(ptr, encoded.length * 4);
    span(data, encoded.reduce((n, b) => n + b.length, 0));
    for (let i = 0; i < encoded.length; i++) {
      put32(ptr + i * 4, data);
      span(data, encoded[i].length).set(encoded[i]);
      data += encoded[i].length;
    }
    return 0;
  };
  const sizes = (values, count, bytes) => {
    span(count, 4);
    span(bytes, 4);
    put32(count, values.length);
    put32(bytes, values.reduce((n, value) => n + encoder2.encode(value).length + 1, 0));
    return 0;
  };
  const env = Object.entries(options.env).map(([key, value]) => `${key}=${value}`);
  const stat = (ptr, info) => {
    const dest = span(ptr, 64);
    dest.fill(0);
    const v = view(ptr, 64);
    v.setBigUint64(8, BigInt(info.inode), true);
    v.setUint8(16, filetype(info.type));
    v.setBigUint64(24, 1n, true);
    v.setBigUint64(32, BigInt(info.size), true);
    v.setBigUint64(40, BigInt(Math.trunc(info.mtimeMs)) * 1000000n, true);
    v.setBigUint64(48, BigInt(Math.trunc(info.mtimeMs)) * 1000000n, true);
    v.setBigUint64(56, BigInt(Math.trunc(info.ctimeMs)) * 1000000n, true);
    return 0;
  };
  const safeOffset = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n))
      throw new WasiFault(28);
    return n;
  };
  const fdRead = (fd, ptr, count, result, offset) => {
    span(result, 4);
    const buffers = iovecs(ptr, count);
    const input = fd === 0 && standard.has(fd);
    const h = input ? void 0 : handle(fd, FD_READ | (offset === void 0 ? 0n : FD_SEEK));
    if (input && offset !== void 0)
      throw new WasiFault(70);
    const length = buffers.reduce((total, buffer) => Math.min(1024 * 1024, total + buffer.length), 0);
    if (!length) {
      put32(result, 0);
      return 0;
    }
    const bytes = input ? stdio.read(length) : offset === void 0 ? options.fs.read(h.fd, length) : options.fs.pread(h.fd, length, safeOffset(offset));
    if (bytes.length > length)
      throw new WasiFault(29);
    let copied = 0;
    for (const buffer of buffers) {
      const n = Math.min(buffer.length, bytes.length - copied);
      buffer.set(bytes.subarray(copied, copied + n));
      copied += n;
      if (copied === bytes.length)
        break;
    }
    put32(result, copied);
    return 0;
  };
  const fdWrite = (fd, ptr, count, result, offset) => {
    span(result, 4);
    const buffers = iovecs(ptr, count);
    let total = 0;
    const output = (fd === 1 || fd === 2) && standard.has(fd);
    const h = output ? void 0 : handle(fd, FD_WRITE | (offset === void 0 ? 0n : FD_SEEK));
    if (output && offset !== void 0)
      throw new WasiFault(70);
    try {
      for (const buffer of buffers) {
        const bytes = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024 - total));
        if (!bytes.length) {
          if (total === 1024 * 1024)
            break;
          continue;
        }
        if (output) {
          const n = stdio.write(fd, bytes);
          total += n;
          if (n < bytes.length)
            break;
        } else {
          const n = offset === void 0 ? options.fs.write(h.fd, bytes) : options.fs.pwrite(h.fd, bytes, safeOffset(offset) + total);
          total += n;
          if (n < bytes.length)
            break;
        }
      }
    } catch (error) {
      if (!total || !(error instanceof FsError))
        throw error;
    }
    put32(result, total);
    return 0;
  };
  const funcs = {
    args_sizes_get: (a, b) => sizes(options.args, a, b),
    args_get: (a, b) => strings(options.args, a, b),
    environ_sizes_get: (a, b) => sizes(env, a, b),
    environ_get: (a, b) => strings(env, a, b),
    proc_exit: (code) => {
      throw new WasiExit(code >>> 0);
    },
    fd_read: fdRead,
    fd_pread: (fd, ptr, count, offset, result) => fdRead(fd, ptr, count, result, offset),
    fd_write: fdWrite,
    fd_pwrite: (fd, ptr, count, offset, result) => fdWrite(fd, ptr, count, result, offset),
    fd_close: (fd) => {
      if (standard.delete(fd)) {
        stdio.close?.(fd);
        return 0;
      }
      options.fs.close(handle(fd).fd);
      handles.delete(fd);
      return 0;
    },
    fd_seek: (fd, offset, whence, ptr) => {
      span(ptr, 8);
      if (whence < 0 || whence > 2)
        throw new WasiFault(28);
      const right = whence === 1 && offset === 0n ? FD_TELL : FD_SEEK;
      const position = options.fs.seek(handle(fd, right).fd, safeOffset(offset), ["set", "cur", "end"][whence]);
      view(ptr, 8).setBigUint64(0, BigInt(position), true);
      return 0;
    },
    fd_tell: (fd, ptr) => {
      view(ptr, 8).setBigUint64(0, BigInt(options.fs.tell(handle(fd, FD_TELL).fd)), true);
      return 0;
    },
    fd_fdstat_get: (fd, ptr) => {
      span(ptr, 24);
      const h = standard.has(fd) ? void 0 : handle(fd);
      const v = view(ptr, 24);
      span(ptr, 24).fill(0);
      v.setUint8(0, h ? filetype(options.fs.fstat(h.fd).type) : 0);
      v.setUint16(2, h?.flags ?? 0, true);
      v.setBigUint64(8, h?.rights ?? (fd === 0 ? 2n : 64n), true);
      v.setBigUint64(16, h?.inherited ?? 0n, true);
      return 0;
    },
    fd_fdstat_set_rights: (fd, base, inherited) => {
      const h = handle(fd);
      if (!hasRights(h.rights, base) || !hasRights(h.inherited, inherited))
        return 76;
      h.rights = base;
      h.inherited = inherited;
      return 0;
    },
    fd_fdstat_set_flags: (fd, flags) => {
      if (standard.has(fd))
        return flags === 0 ? 0 : 58;
      const h = handle(fd, 8n);
      if (flags & ~5 || (flags & 1) !== (h.flags & 1))
        return 58;
      h.flags = flags;
      return 0;
    },
    fd_filestat_get: (fd, ptr) => {
      if (!standard.has(fd))
        return stat(ptr, options.fs.fstat(handle(fd, 1n << 21n).fd));
      span(ptr, 64).fill(0);
      return 0;
    },
    fd_filestat_set_size: (fd, length) => {
      const h = handle(fd, 1n << 22n);
      options.fs.ftruncate(h.fd, safeOffset(length));
      return 0;
    },
    fd_prestat_get: (fd, ptr) => {
      const h = handle(fd);
      if (h.label === void 0)
        return 8;
      span(ptr, 8).fill(0);
      put32(ptr + 4, encoder2.encode(h.label).length);
      return 0;
    },
    fd_prestat_dir_name: (fd, ptr, length) => {
      const h = handle(fd);
      if (h.label === void 0)
        return 8;
      const bytes = encoder2.encode(h.label);
      if (length >>> 0 < bytes.length)
        return 37;
      span(ptr, bytes.length).set(bytes);
      return 0;
    },
    path_open: (fd, flags, ptr, len, oflags, rights, inherited, fdflags, result) => {
      span(result, 4);
      if (flags & ~1 || oflags & ~15 || fdflags & ~5)
        return 58;
      const parent = handle(fd, 1n << 13n);
      if (!hasRights(parent.inherited, rights) || !hasRights(parent.inherited, inherited))
        return 76;
      if (oflags & 1 && !(parent.rights & 1n << 10n))
        return 76;
      if (oflags & 8 && (!(parent.rights & 1n << 19n) || !(rights & 64n)))
        return 76;
      const p = relative(fd, ptr, len);
      let newFd = 0;
      while (handles.has(newFd) || standard.has(newFd))
        newFd++;
      if (newFd >= 256)
        return 33;
      const write = Boolean(rights & 64n), resize = Boolean(rights & 1n << 22n);
      const opened = paths.open(p, { read: Boolean(rights & 2n) || !(write || resize), write, resize, create: Boolean(oflags & 1), directory: Boolean(oflags & 2), exclusive: Boolean(oflags & 4), truncate: Boolean(oflags & 8), append: Boolean(fdflags & 1) }, Boolean(flags & 1));
      handles.set(newFd, { fd: opened, root: parent.root, flags: fdflags, rights, inherited });
      put32(result, newFd);
      return 0;
    },
    path_filestat_get: (fd, flags, ptr, len, result) => {
      span(result, 64);
      if (flags & ~1)
        return 28;
      const p = relative(fd, ptr, len, 1n << 18n);
      return stat(result, paths.stat(p, Boolean(flags & 1)));
    },
    path_create_directory: (fd, ptr, len) => {
      const p = relative(fd, ptr, len, 1n << 9n);
      paths.mkdir(p);
      return 0;
    },
    path_unlink_file: (fd, ptr, len) => {
      const p = relative(fd, ptr, len, 1n << 26n);
      paths.unlink(p);
      return 0;
    },
    path_remove_directory: (fd, ptr, len) => {
      const p = relative(fd, ptr, len, 1n << 25n);
      paths.rmdir(p);
      return 0;
    },
    path_readlink: (fd, ptr, len, buf, length, result) => {
      span(result, 4);
      span(buf, length);
      const p = relative(fd, ptr, len, 1n << 15n);
      const bytes = encoder2.encode(paths.readlink(p)).subarray(0, length >>> 0);
      span(buf, bytes.length).set(bytes);
      put32(result, bytes.length);
      return 0;
    },
    path_symlink: (ptr, len, fd, newPtr, newLen) => {
      const target = text(ptr, len), p = relative(fd, newPtr, newLen, 1n << 24n);
      paths.symlink(target, p);
      return 0;
    },
    path_rename: (oldFd, oldPtr, oldLen, newFd, newPtr, newLen) => {
      const a = relative(oldFd, oldPtr, oldLen, 1n << 16n), b = relative(newFd, newPtr, newLen, 1n << 17n);
      paths.rename(a, b);
      return 0;
    },
    fd_readdir: (fd, ptr, length, cookie, result) => {
      const h = handle(fd, 1n << 14n);
      span(result, 4);
      const destination = span(ptr, length);
      let written = 0;
      const start = safeOffset(cookie);
      if (start < 0)
        return 28;
      if (!destination.length) {
        put32(result, 0);
        return 0;
      }
      if (start === 0 || !h.entries)
        h.entries = paths.entries(h.fd);
      const entries = h.entries;
      for (let i = start; i < entries.length && written < destination.length; i++) {
        const { name, stat: info } = entries[i], encoded = encoder2.encode(name);
        const record = new Uint8Array(24 + encoded.length), v = new DataView(record.buffer);
        v.setBigUint64(0, BigInt(i + 1), true);
        v.setBigUint64(8, BigInt(info.inode), true);
        v.setUint32(16, encoded.length, true);
        v.setUint8(20, filetype(info.type));
        record.set(encoded, 24);
        const n = Math.min(record.length, destination.length - written);
        destination.set(record.subarray(0, n), written);
        written += n;
      }
      put32(result, written);
      return 0;
    },
    random_get: (ptr, length) => {
      const data = span(ptr, length);
      for (let i = 0; i < data.length; i += 65536)
        crypto.getRandomValues(data.subarray(i, i + 65536));
      return 0;
    },
    clock_time_get: (clock, _precision, ptr) => {
      if (clock !== 0 && clock !== 1)
        return 28;
      const n = clock === 0 ? Date.now() : performance.now();
      view(ptr, 8).setBigUint64(0, BigInt(Math.trunc(n * 1e6)), true);
      return 0;
    },
    clock_res_get: (clock, ptr) => {
      if (clock !== 0 && clock !== 1)
        return 28;
      view(ptr, 8).setBigUint64(0, 1000000n, true);
      return 0;
    },
    sched_yield: () => 0,
    // Unsupported sync, metadata mutation, process and polling are explicit errno failures.
    poll_oneoff: () => 52,
    fd_sync: () => 58,
    fd_datasync: () => 58,
    fd_filestat_set_times: () => 58,
    path_filestat_set_times: () => 58,
    path_link: () => 58,
    proc_raise: () => 58
  };
  const imports = Object.fromEntries(Object.entries(funcs).map(([name, fn]) => [name, (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof WasiFault)
        return error.errno;
      if (error instanceof FsError)
        return errno[error.code] ?? 29;
      throw error;
    }
  }]));
  return {
    imports,
    processImports: {
      initial_cwd(ptr, capacity) {
        const bytes = encoder2.encode(options.cwd + "\0");
        try {
          if (capacity >>> 0 < bytes.length)
            return -1;
          span(ptr, capacity).subarray(0, bytes.length).set(bytes);
          return bytes.length;
        } catch (error) {
          if (error instanceof WasiFault)
            return -1;
          throw error;
        }
      }
    },
    run(instance) {
      memory = instance.exports.memory;
      let code = 0;
      try {
        instance.exports._start();
      } catch (error) {
        if (error instanceof WasiExit)
          code = error.code;
        else
          throw error;
      }
      return { code, ...stdio.capture() };
    },
    dispose() {
      for (const h of handles.values())
        options.fs.close(h.fd);
      handles.clear();
    }
  };
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/errors.js
var ContainerError = class extends Error {
  code;
  name = "ContainerError";
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
};

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasi/profile.js
function checkMemoryProfile(bytes, maxMemoryBytes) {
  const fail = (message) => {
    throw new ContainerError("UNSUPPORTED_PROFILE", message);
  };
  if (!Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 65536 || maxMemoryBytes > 2 ** 32)
    fail("Invalid memory limit");
  if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((b, i) => bytes[i] === b))
    fail("Expected core Wasm v1");
  let offset = 8, end = bytes.length, memories = 0;
  const u32 = () => {
    let n = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= end)
        fail("Truncated Wasm section");
      const b = bytes[offset++];
      if (shift === 28 && b > 15)
        fail("Invalid Wasm integer");
      n += (b & 127) * 2 ** shift;
      if (!(b & 128))
        return n;
    }
    return fail("Invalid Wasm integer");
  };
  while (offset < bytes.length) {
    const id = bytes[offset++];
    end = bytes.length;
    const length = u32(), next = offset + length;
    if (next > bytes.length)
      fail("Truncated Wasm section");
    end = next;
    if (id === 8)
      fail("Wasm start sections are outside the command profile");
    if (id === 5) {
      if (u32() !== 1 || u32() !== 1)
        fail("Require one bounded, unshared wasm32 memory");
      const initial = u32(), maximum = u32();
      if (initial > maximum || maximum * 65536 > maxMemoryBytes || offset !== end)
        fail("Wasm memory exceeds the hard limit");
      memories++;
    }
    offset = next;
  }
  if (memories !== 1)
    fail("Require exactly one defined memory");
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasi-live/io.js
function readChunks(length, chunk) {
  const parts = [];
  let total = 0;
  try {
    while (total < length) {
      const requested = Math.min(length - total, RPC_BYTES), bytes = chunk(total, requested);
      if (bytes.length > requested)
        throw new FsError("EIO", "Live read exceeded its request");
      parts.push(bytes);
      total += bytes.length;
      if (bytes.length < requested)
        break;
    }
  } catch (error) {
    if (!total || !(error instanceof FsError))
      throw error;
  }
  if (parts.length === 1)
    return parts[0];
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function writeChunks(bytes, chunk) {
  let total = 0;
  try {
    while (total < bytes.length) {
      const requested = bytes.subarray(total, total + RPC_BYTES), n = chunk(total, requested);
      if (!Number.isSafeInteger(n) || n < 0 || n > requested.length)
        throw new FsError("EIO", "Live write reported an invalid count");
      total += n;
      if (n < requested.length)
        break;
    }
  } catch (error) {
    if (!total || !(error instanceof FsError))
      throw error;
  }
  return total;
}
function createRemoteFileSystem(call) {
  return {
    paths: {
      open: (reference, options, follow) => call(Operation.PathOpen, [reference, options, follow]).value,
      stat: (reference, follow) => call(Operation.PathStat, [reference, follow]).value,
      mkdir: (reference) => {
        call(Operation.PathMkdir, [reference]);
      },
      unlink: (reference) => {
        call(Operation.PathUnlink, [reference]);
      },
      rmdir: (reference) => {
        call(Operation.PathRmdir, [reference]);
      },
      readlink: (reference) => call(Operation.PathReadlink, [reference]).value,
      symlink: (target, reference) => {
        call(Operation.PathSymlink, [target, reference]);
      },
      rename: (from, to) => {
        call(Operation.PathRename, [from, to]);
      },
      entries: (directory) => call(Operation.DirectoryEntries, [directory]).value
    },
    open: (path, options) => call(Operation.Open, [path, options ?? {}]).value,
    close: (fd) => {
      call(Operation.Close, [fd]);
    },
    stat: (path, options) => call(Operation.Stat, [path, options ?? {}]).value,
    lstat: (path, options) => call(Operation.Lstat, [path, options ?? {}]).value,
    fstat: (fd) => call(Operation.Fstat, [fd]).value,
    getDirectoryPath: (fd) => call(Operation.DirectoryPath, [fd]).value,
    read: (fd, length) => readChunks(length, (_, n) => call(Operation.Read, [fd, n]).bytes),
    pread: (fd, length, offset) => readChunks(length, (done, n) => call(Operation.Pread, [fd, n, offset + done]).bytes),
    write: (fd, bytes) => writeChunks(bytes, (_, chunk) => call(Operation.Write, [fd], chunk).value),
    pwrite: (fd, bytes, offset) => writeChunks(bytes, (done, chunk) => call(Operation.Pwrite, [fd, offset + done], chunk).value),
    seek: (fd, offset, whence) => call(Operation.Seek, [fd, offset, whence ?? "set"]).value,
    tell: (fd) => call(Operation.Tell, [fd]).value,
    ftruncate: (fd, size) => {
      call(Operation.Truncate, [fd, size]);
    },
    realpath: (path, options) => call(Operation.Realpath, [path, options ?? {}]).value,
    readdir: (path, options) => call(Operation.Readdir, [path, options ?? {}]).value,
    mkdir: (path, options) => {
      call(Operation.Mkdir, [path, options ?? {}]);
    },
    unlink: (path, options) => {
      call(Operation.Unlink, [path, options ?? {}]);
    },
    rmdir: (path, options) => {
      call(Operation.Rmdir, [path, options ?? {}]);
    },
    readlink: (path, options) => call(Operation.Readlink, [path, options ?? {}]).value,
    symlink: (target, path, options) => {
      call(Operation.Symlink, [target, path, options ?? {}]);
    },
    rename: (oldPath, newPath, options) => {
      call(Operation.Rename, [oldPath, newPath, options ?? {}]);
    }
  };
}
function createRemoteStdio(call, initialOpen = [0, 1, 2]) {
  if (!Array.isArray(initialOpen) || initialOpen.length > 3 || new Set(initialOpen).size !== initialOpen.length || initialOpen.some((fd) => !Number.isInteger(fd) || fd < 0 || fd > 2))
    throw new FsError("EINVAL", "Invalid initial stdio descriptors");
  const open = new Set(initialOpen);
  const check = (fd) => {
    if (!open.has(fd))
      throw new FsError("EBADF", "Standard descriptor is closed");
  };
  return {
    isOpen: (fd) => open.has(fd),
    read: (length) => {
      check(0);
      return call(Operation.Stdin, [Math.min(length, RPC_BYTES)]).bytes;
    },
    write: (fd, bytes) => {
      check(fd);
      return call(Operation.Stdout, [fd], bytes.subarray(0, RPC_BYTES)).value;
    },
    close: (fd) => {
      check(fd);
      open.delete(fd);
      call(Operation.StdioClose, [fd]);
    },
    capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() })
  };
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasi-live/worker.js
var prepared;
var preparing = false;
var ran = false;
var scope = globalThis;
scope.onmessage = async ({ data }) => {
  const generation = data?.generation;
  try {
    if (!data || data.version !== 1 || !Number.isSafeInteger(generation) || generation < 1)
      throw new Error("Invalid live worker request");
    if (data.type === "prepare" && !preparing) {
      preparing = true;
      const request = data;
      if (!(request.command.bytes instanceof Uint8Array))
        throw new Error("Expected executable bytes");
      checkMemoryProfile(request.command.bytes, request.limits.maxMemoryBytes);
      const module = await WebAssembly.compile(request.command.bytes);
      const call = createRpcClient(request.buffer, generation, (notice) => scope.postMessage(notice), request.maxBlockedIoMs);
      const host = createWasiHost({ ...request.invocation, args: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], fs: createRemoteFileSystem(call), stdio: createRemoteStdio(call, request.openStdio), stdin: new Uint8Array(), maxOutputBytes: request.limits.maxOutputBytes });
      try {
        const imports = WebAssembly.Module.imports(module);
        for (const entry of imports) {
          if (entry.kind !== "function" || !(entry.module === "wasi_snapshot_preview1" && Object.hasOwn(host.imports, entry.name) || entry.module === "wasm_idle_process_v1" && entry.name === "initial_cwd"))
            throw new Error(`Unsupported import: ${entry.module}.${entry.name}`);
        }
        if (request.invocation.cwd !== "/" && !imports.some((entry) => entry.module === "wasm_idle_process_v1" && entry.name === "initial_cwd"))
          throw new Error("A non-root cwd requires the initial_cwd guest initialization profile");
        const exports = WebAssembly.Module.exports(module);
        if (!exports.some((entry) => entry.name === "memory" && entry.kind === "memory") || !exports.some((entry) => entry.name === "_start" && entry.kind === "function"))
          throw new Error("Require exported memory and _start");
      } catch (error) {
        host.dispose();
        throw error;
      }
      prepared = { request, module, host };
      scope.postMessage({ type: "ready", version: 1, generation });
    } else if (data.type === "run" && prepared && !ran && generation === prepared.request.generation) {
      ran = true;
      const { module, host } = prepared;
      try {
        const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports });
        const { code } = host.run(instance);
        host.dispose();
        scope.postMessage({ type: "complete", version: 1, generation, code });
      } finally {
        host.dispose();
      }
    } else
      throw new Error("Invalid live worker state");
  } catch (error) {
    scope.postMessage({ type: "error", version: 1, generation, message: error instanceof Error ? error.message : "Live command failed" });
  }
};
