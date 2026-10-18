import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createWasiHost } from '../../dist/adapters/wasi/host.js';

function hostTest(run) {
  const fs = new MemoryFileSystem(), memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  fs.writeFile('file', new Uint8Array([0, 255]), { mode: 0o751 }); fs.symlink('file', 'link');
  const host = createWasiHost({ fs, args: [], env: {}, cwd: '/workspace', stdin: new Uint8Array(), maxOutputBytes: 128 });
  const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
  const path = value => { const encoded = new TextEncoder().encode(value); bytes.set(encoded); return encoded.length; };
  try { host.run({ exports: { memory, _start: () => run(host.imports, host.filesystemImports, fs, view, path) } }); }
  finally { host.dispose(); }
}

test('WASI timestamps handle explicit values, shared NOW, OMIT and unsigned i64 without changing contents', () => hostTest((w, modes, fs, view, path) => {
  const length = path('file');
  assert.equal(w.path_filestat_set_times(3, 1, 0, length, 123456789n, 987654321n, 5), 0);
  assert.equal(w.path_filestat_get(3, 1, 0, length, 256), 0);
  assert.equal(view.getBigUint64(296, true), 123000000n); assert.equal(view.getBigUint64(304, true), 987000000n);
  assert.deepEqual(fs.readFile('file'), new Uint8Array([0, 255]));
  assert.equal(w.path_filestat_set_times(3, 1, 0, length, 0n, 0n, 10), 0);
  const now = fs.stat('file'); assert.equal(now.atimeMs, now.mtimeMs); assert.equal(now.ctimeMs, now.mtimeMs);
  const generation = fs.generation;
  assert.equal(w.path_filestat_set_times(3, 1, 0, length, -1n, -1n, 0), 0); assert.equal(fs.generation, generation);
  assert.equal(w.path_filestat_set_times(3, 1, 0, length, -1n, 0n, 1), 0);
  assert.equal(fs.stat('file').atimeMs, Number(0xffffffffffffffffn / 1000000n));
  assert.equal(w.path_open(3, 1, 0, length, 0, (1n << 23n) | (1n << 21n), 0n, 0, 128), 0);
  const fd = view.getUint32(128, true);
  assert.equal(w.fd_filestat_set_times(fd, 0n, 0n, 5), 0);
  assert.equal(fs.stat('file').atimeMs, 0); assert.equal(fs.stat('file').mtimeMs, 0);
  assert.equal(modes.fd_mode(fd), 0o751); assert.equal(w.fd_close(fd), 0);
}));

test('WASI timestamp mutation validates flags, rights, memory and readonly policy before mutation', () => hostTest((w, modes, fs, view, path) => {
  const length = path('file'), before = fs.exportSnapshot();
  for (const flags of [3, 12, 16, -1]) assert.equal(w.path_filestat_set_times(3, 1, 0, length, 0n, 0n, flags), 28);
  assert.equal(w.path_filestat_set_times(3, 2, 0, length, 0n, 0n, 5), 28);
  assert.equal(w.path_filestat_set_times(3, 1, 65535, 2, 0n, 0n, 5), 21);
  assert.equal(w.path_filestat_set_times(91, 1, 0, length, 0n, 0n, 5), 8);
  assert.deepEqual(fs.exportSnapshot(), before);
  assert.equal(w.path_open(3, 1, 0, length, 0, 1n << 21n, 0n, 0, 128), 0);
  const fd = view.getUint32(128, true);
  assert.equal(w.fd_filestat_set_times(fd, 0n, 0n, 5), 76); assert.equal(w.fd_close(fd), 0);
  const readonly = path('usr');
  assert.equal(w.path_filestat_set_times(4, 1, 0, readonly, 0n, 0n, 5), 69);
  path('file'); assert.equal(w.fd_fdstat_set_rights(3, 1n << 18n, 0n), 0);
  assert.equal(w.path_filestat_set_times(3, 1, 0, length, 0n, 0n, 5), 76);
  assert.equal(modes.path_mode(3, 0, length, 1), 0o751);
  assert.equal(w.fd_fdstat_set_rights(3, 0n, 0n), 0);
  assert.equal(modes.path_mode(3, 0, length, 1), -76);
}));

test('versioned mode ABI returns true stored modes and negative WASI errors without identity emulation', () => hostTest((w, modes, fs, view, path) => {
  assert.equal(modes.path_mode(3, 0, path('file'), 1), 0o751);
  const link = path('link');
  assert.equal(modes.path_mode(3, 0, link, 0), 0o777); assert.equal(modes.path_mode(3, 0, link, 1), 0o751);
  assert.equal(w.path_filestat_set_times(3, 0, 0, link, 1000000n, 2000000n, 5), 0);
  assert.equal(fs.lstat('link').mtimeMs, 2); assert.notEqual(fs.stat('file').mtimeMs, 2);
  assert.equal(modes.path_mode(3, 0, path('missing'), 1), -44);
  assert.equal(modes.path_mode(3, 65535, 2, 1), -21);
  assert.equal(modes.path_mode(3, 0, path('/workspace/file'), 1), -76);
  assert.equal(modes.path_mode(3, 0, path('file'), 2), -28);
  assert.equal(modes.fd_mode(91), -8); assert.equal(modes.fd_mode(1), -8);
  assert.equal(w.path_open(3, 1, 0, path('file'), 0, 1n << 21n, 0n, 0, 128), 0);
  const fd = view.getUint32(128, true); assert.equal(modes.fd_mode(fd), 0o751);
  assert.equal(w.fd_fdstat_set_rights(fd, 0n, 0n), 0); assert.equal(modes.fd_mode(fd), -76); assert.equal(w.fd_close(fd), 0);
}));
