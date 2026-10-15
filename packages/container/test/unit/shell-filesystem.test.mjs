import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createShellFilesystem } from '../../dist/shell/filesystem.js';

const encode = (value) => new TextEncoder().encode(value), decode = (value) => new TextDecoder().decode(value);
const flags = (overrides = {}) => ({ read: true, write: false, create: false, exclusive: false, truncate: false, append: false, ...overrides });
const code = (expected) => (error) => error.code === expected;

test('paths are absolute inside the mount and confined to its root', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs);
  shell.mkdir('/demo');
  fs.writeFile('/workspace/demo/main.c', encode('int main;'));
  assert.deepEqual(shell.readdir('/demo'), [{ name: 'main.c', type: 'file' }]);
  assert.equal(shell.stat('/demo/main.c').size, 9);
  assert.equal(shell.stat('/').type, 'directory');
  fs.writeFile('/tmp/outside', encode('secret'));
  assert.throws(() => shell.stat('/../tmp/outside'), code('EACCES'));
  fs.symlink('/tmp/outside', '/workspace/escape');
  assert.equal(shell.lstat('/escape').type, 'symlink');
  assert.equal(shell.readlink('/escape'), '/tmp/outside');
  assert.throws(() => shell.open('/escape', flags()), code('EACCES'));
  for (const bad of ['relative', '/nul\0', 42]) assert.throws(() => shell.stat(bad), code('EINVAL'));
  assert.throws(() => createShellFilesystem(fs, { root: '/missing' }), code('ENOENT'));
});

test('handles read and write at explicit offsets and append at the live end', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs);
  const handle = shell.open('/log', flags({ write: true, create: true }));
  assert.equal(shell.write(handle, 0, encode('hello')), 5);
  assert.equal(shell.write(handle, 5, encode(' world')), 6);
  assert.equal(decode(shell.read(handle, 6, 64)), 'world');
  assert.equal(decode(fs.readFile('/workspace/log')), 'hello world', 'visible to the container immediately');
  // Another writer grows the file; append mode still lands at the actual end.
  fs.writeFile('/workspace/log', encode('replaced by editor'));
  const appender = shell.open('/log', flags({ write: true, append: true }));
  assert.equal(shell.append(appender, encode('!')), 1);
  assert.equal(decode(fs.readFile('/workspace/log')), 'replaced by editor!');
  assert.equal(shell.fstat(appender).size, 19);
  assert.throws(() => shell.append(handle, encode('x')), code('EINVAL'), 'append requires an append handle');
  shell.truncate(handle, 3);
  assert.equal(decode(fs.readFile('/workspace/log')), 'rep');
  shell.close(handle);
  shell.close(appender);
  assert.throws(() => shell.read(handle, 0, 1), code('EBADF'));
  assert.throws(() => shell.close(handle), code('EBADF'));
});

test('open follows create, exclusive and truncate flags', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs);
  assert.throws(() => shell.open('/new', flags()), code('ENOENT'));
  shell.close(shell.open('/new', flags({ write: true, create: true, exclusive: true })));
  assert.throws(() => shell.open('/new', flags({ write: true, create: true, exclusive: true })), code('EEXIST'));
  fs.writeFile('/workspace/new', encode('content'));
  const truncated = shell.open('/new', flags({ write: true, truncate: true }));
  assert.equal(shell.fstat(truncated).size, 0);
  shell.close(truncated);
  assert.throws(() => shell.open('/missing/child', flags({ write: true, create: true })), code('ENOENT'));
});

test('unlink, rename and rmdir keep open descriptions and report container errors', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs);
  const handle = shell.open('/file', flags({ write: true, create: true }));
  shell.write(handle, 0, encode('kept'));
  shell.rename('/file', '/moved');
  assert.throws(() => shell.stat('/file'), code('ENOENT'));
  shell.unlink('/moved');
  assert.equal(decode(shell.read(handle, 0, 16)), 'kept', 'unlinked but open data stays readable');
  shell.close(handle);
  shell.mkdir('/dir');
  fs.writeFile('/workspace/dir/child', encode('x'));
  assert.throws(() => shell.rmdir('/dir'), code('ENOTEMPTY'));
  shell.unlink('/dir/child');
  shell.rmdir('/dir');
  assert.throws(() => shell.stat('/dir'), code('ENOENT'));
});

test('a snapshot writer lease makes shell mutations fail with EBUSY', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs);
  fs.writeFile('/workspace/source', encode('a'));
  const lease = fs.acquireSnapshot();
  try {
    assert.throws(() => shell.mkdir('/blocked'), code('EBUSY'));
    assert.throws(() => shell.open('/source', flags({ write: true })), code('EBUSY'));
    assert.equal(shell.stat('/source').size, 1, 'reads remain available');
  } finally { lease.discard(); }
  shell.mkdir('/blocked');
});

test('bounded I/O and handle budgets are enforced', () => {
  const fs = new MemoryFileSystem(), shell = createShellFilesystem(fs, { maxIoBytes: 4, maxHandles: 2 });
  const a = shell.open('/a', flags({ write: true, create: true }));
  shell.open('/b', flags({ write: true, create: true }));
  assert.throws(() => shell.open('/c', flags({ write: true, create: true })), code('ENOSPC'));
  assert.throws(() => shell.write(a, 0, encode('12345')), code('EINVAL'));
  assert.throws(() => shell.read(a, 0, 5), code('EINVAL'));
  assert.throws(() => shell.read(a, -1, 1), code('EINVAL'));
  assert.throws(() => createShellFilesystem(fs, { maxIoBytes: 0 }), code('INVALID_ARGUMENT'));
});
