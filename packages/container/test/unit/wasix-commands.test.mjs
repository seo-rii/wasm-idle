import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createShellFilesystem } from '../../dist/shell/filesystem.js';

test('virtual commands share readonly metadata across host, shell and snapshots without fake bodies', () => {
  const fs = new MemoryFileSystem();
  fs.mountCommands('/usr/bin', ['clang', 'cat']);
  assert.deepEqual(fs.readdir('/usr/bin'), ['cat', 'clang']);
  const metadata = fs.stat('/usr/bin/clang');
  assert.equal(metadata.type, 'file'); assert.equal(metadata.mode, 0o555); assert.equal(metadata.command, true);
  assert.throws(() => fs.readFile('/usr/bin/clang'), { code: 'ENOTSUP' });
  assert.throws(() => fs.open('/usr/bin/clang'), { code: 'ENOTSUP' });
  assert.throws(() => fs.writeFile('/usr/bin/clang', new Uint8Array([1])), { code: 'EROFS' });
  const shell = createShellFilesystem(fs, { root: '/usr/bin' });
  assert.equal(shell.stat('/clang').type, 'file');
  assert.deepEqual(shell.readdir('/').map(entry => entry.name), ['cat', 'clang']);
  const lease = fs.acquireSnapshot(), guest = MemoryFileSystem.fromSnapshot(lease.snapshot);
  assert.equal(guest.stat('/usr/bin/clang').command, true);
  guest.writeFile('/workspace/created', new Uint8Array([42])); lease.commit(guest.exportSnapshot());
  assert.deepEqual(fs.readFile('/workspace/created'), new Uint8Array([42]));
  assert.equal(fs.stat('/usr/bin/clang').inode, metadata.inode);
});

test('virtual command markers cannot enter writable mounts or change readonly snapshots', () => {
  const fs = new MemoryFileSystem(); fs.mountCommands('/usr/bin', ['clang']);
  fs.writeFile('/workspace/data', new Uint8Array());
  const writable = fs.exportSnapshot();
  const file = writable.entries.find(entry => entry.path === '/workspace/data'); file.command = true; file.mode = 0o555;
  assert.throws(() => MemoryFileSystem.fromSnapshot(writable), { code: 'EINVAL' });
  const lease = fs.acquireSnapshot(), changed = structuredClone(lease.snapshot);
  delete changed.entries.find(entry => entry.path === '/usr/bin/clang').command;
  assert.throws(() => lease.commit(changed), { code: 'EROFS' }); lease.discard();
  assert.equal(fs.stat('/usr/bin/clang').command, true);
  for (const names of [[], ['x', 'x'], ['../x'], ['a/b'], ['.']]) assert.throws(() => fs.mountCommands('/opt/commands', names), { code: 'EINVAL' });
});
