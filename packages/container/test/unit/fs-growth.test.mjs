import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

test('incremental file writes copy a linear number of bytes', (t) => {
  const fs = new MemoryFileSystem();
  const fd = fs.open('output', { read: true, write: true, create: true });
  const chunk = new Uint8Array(1024).fill(7), count = 129;
  const set = Uint8Array.prototype.set;
  let copiedBytes = 0;
  const spy = t.mock.method(Uint8Array.prototype, 'set', function (source, offset) {
    copiedBytes += source.length;
    return set.call(this, source, offset);
  });
  try {
    for (let index = 0; index < count; index++) fs.write(fd, chunk);
  } finally { spy.mock.restore(); }

  assert.ok(copiedBytes <= 3 * count * chunk.length,
    `copying ${copiedBytes} bytes for ${count * chunk.length} output bytes exceeds amortized growth`);
  assert.equal(fs.fstat(fd).size, count * chunk.length);
  assert.equal(fs.byteLength, count * chunk.length);
  assert.deepEqual(fs.readFile('output'), new Uint8Array(count * chunk.length).fill(7));
  fs.close(fd);
});

test('spare file capacity stays outside reads, snapshots, versions and EOF', () => {
  const fs = new MemoryFileSystem();
  const fd = fs.open('output', { read: true, write: true, create: true });
  fs.write(fd, Uint8Array.of(1, 2, 3));
  fs.write(fd, Uint8Array.of(4));
  const expected = Uint8Array.of(1, 2, 3, 4);
  assert.equal(fs.fstat(fd).size, 4);
  assert.equal(fs.byteLength, 4);
  assert.equal(fs.seek(fd, 0, 'end'), 4);
  assert.deepEqual(fs.pread(fd, 100, 0), expected);
  assert.deepEqual(fs.pread(fd, 100, 4), new Uint8Array());
  const read = fs.readFile('output');
  assert.equal(read.buffer.byteLength, 4);
  read.fill(0);
  const version = fs.readFileVersion(fs.captureFileVersion(fd));
  assert.equal(version.bytes.buffer.byteLength, 4);
  assert.deepEqual(version.bytes, expected);
  version.bytes.fill(0);
  const snapshot = fs.exportSnapshot();
  const data = snapshot.entries.find((entry) => entry.path === '/workspace/output').data;
  assert.equal(data.buffer.byteLength, 4);
  assert.deepEqual(data, expected);
  const restored = MemoryFileSystem.fromSnapshot(snapshot);
  data.fill(0);
  assert.deepEqual(fs.readFile('output'), expected);
  assert.deepEqual(restored.readFile('output'), expected);
  fs.close(fd);
});

test('sparse writes and regrowth after truncation expose only zero-filled gaps', () => {
  const fs = new MemoryFileSystem();
  const fd = fs.open('output', { read: true, write: true, create: true });
  fs.write(fd, Uint8Array.of(1, 2, 3));
  fs.write(fd, Uint8Array.of(4));
  fs.pwrite(fd, Uint8Array.of(6), 5);
  assert.deepEqual(fs.readFile('output'), Uint8Array.of(1, 2, 3, 4, 0, 6));
  fs.ftruncate(fd, 2);
  fs.ftruncate(fd, 5);
  assert.deepEqual(fs.readFile('output'), Uint8Array.of(1, 2, 0, 0, 0));
  fs.pwrite(fd, Uint8Array.of(8), 7);
  assert.deepEqual(fs.readFile('output'), Uint8Array.of(1, 2, 0, 0, 0, 0, 0, 8));
  fs.writeFile('output', Uint8Array.of(9));
  fs.pwrite(fd, Uint8Array.of(10), 2);
  assert.deepEqual(fs.readFile('output'), Uint8Array.of(9, 0, 10));
  fs.ftruncate(fd, 0);
  fs.ftruncate(fd, 3);
  assert.deepEqual(fs.readFile('output'), new Uint8Array(3));
  fs.close(fd);
});

test('quotas and retained unlinked files count logical bytes after growth', () => {
  const fs = new MemoryFileSystem({ maxBytes: 10 });
  const fd = fs.open('output', { read: true, write: true, create: true });
  fs.write(fd, Uint8Array.of(1, 2, 3));
  fs.write(fd, Uint8Array.of(4));
  fs.writeFile('other', new Uint8Array(6));
  assert.equal(fs.byteLength, 10);
  const before = fs.exportSnapshot();
  assert.throws(() => fs.write(fd, Uint8Array.of(5)), { code: 'ENOSPC' });
  assert.throws(() => fs.ftruncate(fd, 5), { code: 'ENOSPC' });
  assert.equal(fs.tell(fd), 4);
  assert.deepEqual(fs.exportSnapshot(), before);
  fs.unlink('output');
  assert.equal(fs.byteLength, 10);
  assert.deepEqual(fs.pread(fd, 10, 0), Uint8Array.of(1, 2, 3, 4));
  fs.ftruncate(fd, 1);
  assert.equal(fs.byteLength, 7);
  fs.writeFile('replacement', new Uint8Array(3));
  fs.close(fd);
  assert.equal(fs.byteLength, 9);
  fs.truncate('other', 7);
  assert.equal(fs.byteLength, 10);
});
