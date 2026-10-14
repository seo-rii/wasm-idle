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
test('initial_cwd writes the exact NUL-terminated cwd and rejects short or out-of-bounds buffers', () => {
  const fs = new MemoryFileSystem(); fs.mkdir('/workspace/한 글');
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const host = createWasiHost({ fs, args: [], env: {}, cwd: '/workspace/한 글', stdin: new Uint8Array(), maxOutputBytes: 128 });
  const expected = new TextEncoder().encode('/workspace/한 글\0');
  try {
    host.run({ exports: { memory, _start: () => {
      const { initial_cwd } = host.processImports;
      const view = new Uint8Array(memory.buffer);
      view.fill(7, 0, 64);
      assert.equal(initial_cwd(0, expected.length - 1), -1);
      assert.deepEqual(view.subarray(0, 64), new Uint8Array(64).fill(7));
      assert.equal(initial_cwd(65536 - expected.length + 1, expected.length), -1);
      assert.equal(initial_cwd(-1, expected.length), -1);
      assert.equal(initial_cwd(0, expected.length), expected.length);
      assert.deepEqual(view.subarray(0, expected.length), expected);
      assert.equal(view[expected.length], 7);
    } } });
  } finally { host.dispose(); }
});
