import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

test('snapshot entry selection copies only matching bytes and retains global metadata', (t) => {
  const fs = new MemoryFileSystem();
  fs.writeFile('keep', Uint8Array.of(1, 2, 3));
  fs.writeFile('/tmp/discard', new Uint8Array(2048));
  fs.mountReadonly('/opt/compiler', [
    { path: 'tool', type: 'file', mode: 0o444, data: new Uint8Array(4096).fill(7) }
  ]);
  fs.symlink('/opt/compiler/tool', 'link');
  const full = fs.exportSnapshot();
  const includePath = (path) => path === '/workspace' || path.startsWith('/workspace/');
  const slice = Uint8Array.prototype.slice;
  let copiedBytes = 0;
  const spy = t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
    copiedBytes += this.byteLength;
    return slice.apply(this, args);
  });
  let selected;
  try { selected = fs.exportSnapshot({ includePath }); } finally { spy.mock.restore(); }
  assert.equal(copiedBytes, 3);
  assert.deepEqual(selected, { ...full, entries: full.entries.filter((entry) => includePath(entry.path)) });
  selected.entries.find((entry) => entry.path === '/workspace/keep').data.fill(0);
  assert.deepEqual(fs.readFile('keep'), Uint8Array.of(1, 2, 3));
  assert.deepEqual(fs.exportSnapshot(), full, 'the default snapshot still contains all mounts and files');
  const restored = MemoryFileSystem.fromSnapshot(full);
  full.entries.find((entry) => entry.path === '/opt/compiler/tool').data.fill(0);
  assert.equal(fs.readFile('/opt/compiler/tool')[0], 7);
  assert.equal(restored.readFile('/opt/compiler/tool')[0], 7);
});
