import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createLiveIo } from '../../dist/adapters/wasi-live/io.js';
import { Operation } from '../../dist/transport/rpc.js';

const bytes = new Uint8Array([0, 255, 10, 128]);
test('null is an immutable character device with EOF, discarded writes and shared descriptions', () => {
  const fs = new MemoryFileSystem({ maxBytes: 0 });
  const initial = fs.stat('/dev/null'), generation = fs.generation;
  assert.equal(initial.type, 'character-device'); assert.equal(initial.inode, 0);
  assert.equal(initial.mode, 0o666); assert.equal(initial.size, 0);
  assert.deepEqual(fs.readdir('/dev'), ['null']);
  const fd = fs.open('/dev/null', { read: true, write: true, truncate: true }), duplicate = fs.dup(fd);
  assert.deepEqual(fs.read(fd, 4096), new Uint8Array());
  assert.deepEqual(fs.pread(duplicate, 4, 123), new Uint8Array());
  assert.equal(fs.write(fd, bytes), bytes.length); assert.equal(fs.pwrite(duplicate, bytes, 500), bytes.length);
  assert.equal(fs.tell(fd), 0); assert.equal(fs.seek(duplicate, -100, 'end'), 0); assert.equal(fs.tell(fd), 0);
  fs.writeFile('/dev/null', bytes); assert.deepEqual(fs.readFile('/dev/null'), new Uint8Array());
  assert.equal(fs.byteLength, 0); assert.equal(fs.generation, generation); assert.deepEqual(fs.fstat(fd), initial);
  assert.throws(() => fs.ftruncate(fd, 0), { code: 'EINVAL' });
  assert.throws(() => fs.captureFileVersion(fd), { code: 'EINVAL' });
  fs.close(fd); assert.equal(fs.write(duplicate, bytes), bytes.length); fs.close(duplicate);
  assert.throws(() => fs.close(duplicate), { code: 'EBADF' });
  const readOnly = fs.open('/dev/null'), writeOnly = fs.open('/dev/null', { write: true });
  assert.throws(() => fs.write(readOnly, bytes), { code: 'EBADF' });
  assert.throws(() => fs.read(writeOnly, 1), { code: 'EBADF' });
  fs.close(readOnly); fs.close(writeOnly);
  assert.throws(() => fs.open('/dev/null', { directory: true }), { code: 'ENOTDIR' });
  assert.throws(() => fs.open('/dev/null', { create: true, exclusive: true, write: true }), { code: 'EEXIST' });
  assert.throws(() => fs.unlink('/dev/null'), { code: 'EROFS' });
  assert.throws(() => fs.rename('/dev/null', '/dev/other'), { code: 'EROFS' });
  assert.throws(() => fs.writeFile('/dev/other', bytes), { code: 'EROFS' });
  assert.throws(() => fs.mountReadonly('/dev', []), { code: 'EBUSY' });
});

test('device follows path capabilities and survives snapshot publication without consuming user identities', () => {
  const fs = new MemoryFileSystem();
  const initial = fs.exportSnapshot(), next = initial.nextInode;
  fs.writeFile('/workspace/user', bytes);
  assert.equal(fs.stat('/workspace/user').inode, next);
  fs.symlink('/dev/null', '/workspace/null-link');
  assert.equal(fs.stat('/workspace/null-link').type, 'character-device');
  assert.throws(() => fs.open('/workspace/null-link', { root: '/workspace' }), { code: 'EACCES' });
  const opened = fs.open('/dev/null', { write: true, snapshot: 'preserve' });
  const lease = fs.acquireSnapshot(), privateFs = MemoryFileSystem.fromSnapshot(lease.snapshot);
  assert.deepEqual(privateFs.stat('/dev/null'), fs.stat('/dev/null'));
  privateFs.writeFile('/workspace/from-snapshot', bytes); lease.commit(privateFs.exportSnapshot());
  assert.equal(fs.write(opened, bytes), bytes.length); fs.close(opened);
  assert.equal(fs.stat('/dev/null').inode, 0); assert.deepEqual(fs.readFile('/workspace/user'), bytes);

  // Persistence reconstructs the readonly base, then installs old /workspace
  // records. The new device must not collide with their positive inode IDs.
  const historical = { ...initial, entries: initial.entries.filter(entry => entry.path !== '/dev/null') };
  const old = MemoryFileSystem.fromSnapshot(historical);
  assert.throws(() => old.stat('/dev/null'), { code: 'ENOENT' });
  old.writeFile('/workspace/older-user', bytes);
  const oldSnapshot = old.exportSnapshot(), base = new MemoryFileSystem().exportSnapshot();
  const restored = MemoryFileSystem.fromSnapshot({ ...oldSnapshot,
    entries: [...base.entries.filter(entry => entry.path !== '/workspace'),
      ...oldSnapshot.entries.filter(entry => entry.path === '/workspace' || entry.path.startsWith('/workspace/'))]
  });
  assert.equal(restored.stat('/workspace/older-user').inode, next);
  assert.equal(restored.stat('/dev/null').inode, 0); assert.deepEqual(restored.readFile('/workspace/older-user'), bytes);
});

test('snapshot validation confines the device identity and guest commits cannot remove or replace it', () => {
  const fs = new MemoryFileSystem(), snapshot = fs.exportSnapshot();
  const entry = snapshot.entries.find(entry => entry.path === '/dev/null');
  for (const change of [{ path: '/workspace/device' }, { inode: 1 }, { mode: 0o777 }, { data: new Uint8Array() },
    { type: 'file', data: new Uint8Array() }, { target: '/tmp' }, { command: true }]) {
    assert.throws(() => MemoryFileSystem.fromSnapshot({ ...snapshot,
      entries: snapshot.entries.map(item => item === entry ? { ...item, ...change } : item)
    }), { code: 'EINVAL' });
  }
  for (const replace of [false, true]) {
    const lease = fs.acquireSnapshot();
    const entries = lease.snapshot.entries.filter(item => item.path !== '/dev/null');
    if (replace) entries.push({ path: '/dev/null', inode: lease.snapshot.nextInode, type: 'file', mode: 0o666, data: new Uint8Array() });
    assert.throws(() => lease.commit({ ...lease.snapshot, nextInode: lease.snapshot.nextInode + Number(replace), entries }), { code: 'EROFS' });
    lease.discard(); assert.equal(fs.stat('/dev/null').type, 'character-device');
  }
});

test('live device I/O bypasses compiler output revision bookkeeping and allocates no bytes', async () => {
  const fs = new MemoryFileSystem({ maxBytes: 0 }), writes = [];
  const limits = { maxInputBytes: 65536, maxOutputBytes: 65536, maxWorkspaceInodes: 256 };
  const io = createLiveIo(fs, limits, 4096, error => { throw error; }, undefined, (...args) => writes.push(args));
  const call = (op, args, data = new Uint8Array()) => io.dispatch(op, args, data);
  try {
    const fd = (await call(Operation.Open, ['/dev/null', { read: true, write: true, create: true, truncate: true }])).value;
    assert.equal((await call(Operation.Fstat, [fd])).value.type, 'character-device');
    assert.equal((await call(Operation.Write, [fd], bytes)).value, bytes.length);
    assert.equal((await call(Operation.Pwrite, [fd, 123], bytes)).value, bytes.length);
    assert.deepEqual((await call(Operation.Read, [fd, 100])).bytes, new Uint8Array());
    assert.equal((await call(Operation.Seek, [fd, 123, 'set'])).value, 0);
    await assert.rejects(call(Operation.Truncate, [fd, 0]), { code: 'EINVAL' });
    await call(Operation.Close, [fd]); assert.deepEqual(writes, []); assert.equal(fs.byteLength, 0);
  } finally { io.dispose(); }
});
