import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

const bytes = value => new TextEncoder().encode(value);

test('owner file versions reject same-byte edits, forged tokens and other filesystems', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('/workspace/out', bytes('data'));
  const token = fs.captureFileVersion('/workspace/out');
  assert.equal(fs.captureFileVersion('/workspace/out'), token);
  assert.equal(fs.grantExecutable({ ...token }), false);
  assert.equal(new MemoryFileSystem().readFileVersion(token), undefined);
  fs.writeFile('/workspace/out', bytes('data'));
  assert.equal(fs.readFileVersion(token), undefined);
  const next = fs.captureFileVersion('/workspace/out');
  assert(next.revision > token.revision);
  assert.equal(fs.grantExecutable(token), false);
  assert.equal(fs.grantExecutable(next), true);
  assert.equal(fs.stat('/workspace/out').mode, 0o755);
});

test('rename away/back, ancestor rename and unlink invalidate owner file versions', () => {
  const fs = new MemoryFileSystem(); fs.mkdir('/workspace/dir');
  fs.writeFile('/workspace/dir/out', bytes('data'));
  let token = fs.captureFileVersion('/workspace/dir/out');
  fs.rename('/workspace/dir/out', '/workspace/dir/moved'); fs.rename('/workspace/dir/moved', '/workspace/dir/out');
  assert.equal(fs.grantExecutable(token), false);
  token = fs.captureFileVersion('/workspace/dir/out');
  fs.rename('/workspace/dir', '/workspace/away'); fs.rename('/workspace/away', '/workspace/dir');
  assert.equal(fs.grantExecutable(token), false);
  const fd = fs.open('/workspace/dir/out', { read: true, write: true });
  token = fs.captureFileVersion(fd);
  fs.unlink('/workspace/dir/out');
  assert.equal(fs.readFileVersion(token), undefined);
  fs.write(fd, bytes('changed'));
  assert.equal(fs.grantExecutable(fs.captureFileVersion(fd)), false);
  fs.close(fd);
});

test('unrelated edits and additive readonly mounts preserve a file version', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('/workspace/out', bytes('data'), { mode: 0o640 });
  const token = fs.captureFileVersion('/workspace/out');
  fs.writeFile('/workspace/other', bytes('edit'));
  fs.mountReadonly('/opt/fixture', [{ path: 'data', type: 'file', mode: 0o444, data: bytes('readonly') }]);
  assert.equal(fs.captureFileVersion('/workspace/out'), token);
  assert.deepEqual(fs.readFileVersion(token), { path: '/workspace/out', mode: 0o640, bytes: bytes('data') });
  assert.equal(fs.grantExecutable(token), true);
  assert.equal(fs.stat('/workspace/out').mode, 0o750);
  assert.throws(() => fs.grantExecutable(fs.captureFileVersion('/opt/fixture/data')), { code: 'EROFS' });
});

test('snapshot publication invalidates old tokens and restored inode tokens match identity', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('/workspace/removed', bytes('x')); fs.unlink('/workspace/removed');
  fs.writeFile('/workspace/out', bytes('data'));
  const token = fs.captureFileVersion('/workspace/out'), lease = fs.acquireSnapshot();
  lease.commit(lease.snapshot);
  assert.equal(fs.grantExecutable(token), false);
  assert.equal(fs.captureFileVersion('/workspace/out').inode, fs.stat('/workspace/out').inode);
  const restored = MemoryFileSystem.fromSnapshot(fs.exportSnapshot());
  assert.equal(restored.captureFileVersion('/workspace/out').inode, restored.stat('/workspace/out').inode);
});
