import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createWasiHost } from '../../dist/adapters/wasi/host.js';

function hostTest(run, fs = new MemoryFileSystem()) {
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 2 });
  const host = createWasiHost({ fs, args: [], env: {}, cwd: '/workspace', stdin: new Uint8Array(), maxOutputBytes: 128 });
  try { host.run({ exports: { memory, _start: () => run(host.imports, memory, fs) } }); }
  finally { host.dispose(); }
}
test('directory-only open rights and metadata-only file handles are accepted', () => hostTest((w, memory) => {
  new TextEncoder().encodeInto('.', new Uint8Array(memory.buffer, 0, 8));
  assert.equal(w.path_open(3, 1, 0, 1, 2, 1n << 14n, 0n, 0, 100), 0);
  const fd = new DataView(memory.buffer).getUint32(100, true);
  assert.equal(w.fd_read(fd, 0, 0, 104), 76);
  assert.equal(w.fd_close(fd), 0);
}));
test('path create and truncate require parent capabilities even with inherited write rights', () => hostTest((w, memory, fs) => {
  fs.writeFile('/workspace/x', new Uint8Array([1]));
  new Uint8Array(memory.buffer)[0] = 120;
  assert.equal(w.fd_fdstat_set_rights(3, 1n << 13n, (1n << 30n) - 1n), 0);
  assert.equal(w.path_open(3, 1, 0, 1, 8, 66n, 0n, 0, 100), 76);
  new Uint8Array(memory.buffer)[0] = 121;
  assert.equal(w.path_open(3, 1, 0, 1, 1, 66n, 0n, 0, 100), 76);
  assert.equal(fs.readFile('/workspace/x')[0], 1);
  assert.throws(() => fs.stat('/workspace/y'));
}));
test('unsupported descriptor flags fail before truncating an existing file', () => hostTest((w, memory, fs) => {
  fs.writeFile('/workspace/x', new Uint8Array([42]));
  new Uint8Array(memory.buffer)[0] = 120;
  for (const flags of [2, 8, 16]) assert.equal(w.path_open(3, 1, 0, 1, 8, 66n, 0n, flags, 100), 58);
  assert.deepEqual(fs.readFile('/workspace/x'), new Uint8Array([42]));
}));
test('regular files and directories retain NONBLOCK without changing append or granting rights', () => hostTest((w, memory, fs) => {
  fs.writeFile('/workspace/x', new Uint8Array([42]));
  const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
  const flags = fd => { assert.equal(w.fd_fdstat_get(fd, 120), 0); return view.getUint16(122, true); };
  for (const directory of [false, true]) {
    bytes[0] = directory ? 46 : 120;
    assert.equal(w.path_open(3, 1, 0, 1, directory ? 2 : 0, 8n, 0n, 4, 100), 0);
    const fd = view.getUint32(100, true);
    assert.equal(flags(fd), 4); assert.equal(w.fd_fdstat_set_flags(fd, 0), 0); assert.equal(flags(fd), 0);
    assert.equal(w.fd_fdstat_set_flags(fd, 4), 0); assert.equal(flags(fd), 4);
    assert.equal(w.fd_fdstat_set_flags(fd, 1), 58); assert.equal(flags(fd), 4);
    assert.equal(w.fd_fdstat_set_rights(fd, 0n, 0n), 0);
    assert.equal(w.fd_fdstat_set_flags(fd, 0), 76); assert.equal(flags(fd), 4);
    assert.equal(w.fd_close(fd), 0);
  }
  for (const fd of [0, 1, 2]) assert.equal(w.fd_fdstat_set_flags(fd, 4), 58);
}));
