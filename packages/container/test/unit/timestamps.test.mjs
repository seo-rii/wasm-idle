import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../dist/fs/index.js';

test('timestamp updates retain contents, inode, offset and full-quota storage with noatime reads', () => {
  const fs = new MemoryFileSystem({ maxBytes: 3 });
  fs.writeFile('file', new Uint8Array([0, 255, 10]));
  const descriptor = fs.open('file', { read: true }), before = fs.stat('file'), generation = fs.generation;
  fs.read(descriptor, 1);
  fs.setTimes('file', { atimeMs: 123, mtimeMs: 456 });
  const after = fs.stat('file');
  assert.equal(after.inode, before.inode); assert.equal(after.mode, before.mode);
  assert.equal(after.atimeMs, 123); assert.equal(after.mtimeMs, 456);
  assert.ok(after.ctimeMs >= before.ctimeMs); assert.equal(fs.generation, generation + 1);
  assert.equal(fs.byteLength, 3); assert.equal(fs.tell(descriptor), 1);
  assert.deepEqual(fs.readFile('file'), new Uint8Array([0, 255, 10]));
  assert.equal(fs.stat('file').atimeMs, 123, 'reads do not dirty access timestamps');
  fs.fsetTimes(descriptor, { mtimeMs: 0 });
  assert.equal(fs.fstat(descriptor).atimeMs, 123); assert.equal(fs.fstat(descriptor).mtimeMs, 0);
  fs.close(descriptor);
});

test('NOW samples one owner time while OMIT, invalid updates and readonly failures leave state unchanged', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('file', new Uint8Array([1]));
  const start = Date.now(); fs.setTimes('file', { atimeMs: 'now', mtimeMs: 'now' });
  const info = fs.stat('file');
  assert.equal(info.atimeMs, info.mtimeMs); assert.equal(info.mtimeMs, info.ctimeMs);
  assert.ok(info.atimeMs >= start && info.atimeMs <= Date.now());
  const before = fs.exportSnapshot(); fs.setTimes('file', {});
  for (const values of [{ atimeMs: -1 }, { mtimeMs: NaN }, { atimeMs: Infinity }, { mtimeMs: 0.5 }, { ctimeMs: 1 }, []]) {
    assert.throws(() => fs.setTimes('file', values), { code: 'EINVAL' });
  }
  assert.throws(() => fs.setTimes('/usr', { atimeMs: 1 }), { code: 'EROFS' });
  fs.setTimes('/usr', {});
  assert.deepEqual(fs.exportSnapshot(), before);
  const lease = fs.acquireSnapshot();
  assert.throws(() => fs.setTimes('file', { mtimeMs: 1 }), { code: 'EBUSY' }); lease.discard();
  assert.deepEqual(fs.exportSnapshot(), before);
});

test('timestamp fields are owned once before validation and inherited fields cannot mutate metadata', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('file', new Uint8Array());
  let reads = 0;
  fs.setTimes('file', { get atimeMs() { return ++reads === 1 ? 123 : NaN; } });
  assert.equal(reads, 1); assert.equal(fs.stat('file').atimeMs, 123);
  const before = fs.exportSnapshot();
  fs.setTimes('file', Object.create({ mtimeMs: -1 }));
  assert.deepEqual(fs.exportSnapshot(), before);
});

test('timestamp paths preserve symlink lookup policy and open unlinked inode identity', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('target', new Uint8Array([42])); fs.symlink('target', 'link');
  fs.setTimes('link', { atimeMs: 10, mtimeMs: 20 });
  assert.equal(fs.stat('target').mtimeMs, 20);
  fs.setTimes('link', { atimeMs: 30, mtimeMs: 40 }, {}, false);
  assert.equal(fs.lstat('link').atimeMs, 30); assert.equal(fs.lstat('link').mtimeMs, 40);
  assert.equal(fs.stat('target').mtimeMs, 20);
  const fd = fs.open('target', { read: true }); fs.unlink('target');
  fs.fsetTimes(fd, { atimeMs: 50 }); assert.equal(fs.fstat(fd).atimeMs, 50);
  assert.deepEqual(fs.read(fd, 1), new Uint8Array([42])); fs.close(fd);
  assert.throws(() => fs.fsetTimes(fd, {}), { code: 'EBADF' });
  fs.symlink('/tmp/outside', 'outside');
  assert.throws(() => fs.setTimes('outside', { mtimeMs: 1 }, { root: '/workspace' }), { code: 'EACCES' });
});

test('metadata-only snapshot commits retain explicit timestamps and legacy snapshots default access time', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('file', new Uint8Array([42]));
  fs.setTimes('file', { atimeMs: 11, mtimeMs: 22 });
  const lease = fs.acquireSnapshot(), guest = MemoryFileSystem.fromSnapshot(lease.snapshot);
  guest.setTimes('file', { atimeMs: 33, mtimeMs: 44 }); lease.commit(guest.exportSnapshot());
  assert.equal(fs.stat('file').atimeMs, 33); assert.equal(fs.stat('file').mtimeMs, 44);
  const legacy = fs.exportSnapshot();
  for (const entry of legacy.entries) delete entry.atimeMs;
  const restored = MemoryFileSystem.fromSnapshot(legacy);
  assert.equal(restored.stat('file').atimeMs, 44);
  const next = fs.acquireSnapshot();
  for (const entry of next.snapshot.entries) delete entry.atimeMs;
  next.commit(next.snapshot); assert.equal(fs.stat('file').atimeMs, 33);
  const readonly = fs.acquireSnapshot(), invalid = structuredClone(readonly.snapshot);
  invalid.entries.find(entry => entry.path === '/usr').atimeMs++;
  assert.throws(() => readonly.commit(invalid), { code: 'EROFS' }); readonly.discard();
  legacy.entries.find(entry => entry.path === '/workspace/file').atimeMs = 1.5;
  assert.throws(() => MemoryFileSystem.fromSnapshot(legacy), { code: 'EINVAL' });
});
