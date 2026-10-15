import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem, FsError } from '../../dist/fs/index.js';

const bytes = (text) => new TextEncoder().encode(text);
const text = (value) => new TextDecoder().decode(value);
const error = (code) => (value) => value instanceof FsError && value.code === code && value.errno === code;

test('FS-01: relative paths, real cwd, UTF-8, and backslash names', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('/workspace/project/src', { recursive: true });
  fs.mkdir('/workspace/project/include');
  fs.writeFile('../include/한 글.h', bytes('header'), { cwd: '/workspace/project/src', root: '/workspace' });
  fs.writeFile('/workspace/back\\slash', bytes('literal'));
  assert.equal(text(fs.readFile('/workspace/project/src/../include/한 글.h')), 'header');
  assert.equal(fs.realpath('../include/./한 글.h', { cwd: '/workspace/project/src' }), '/workspace/project/include/한 글.h');
  assert.equal(text(fs.readFile('back\\slash')), 'literal');
  assert.throws(() => fs.readFile('/workspace/back/slash'), error('ENOENT'));
  assert.throws(() => fs.stat('x\0y'), error('EINVAL'));
  assert.throws(() => fs.writeFile('bad\ud800', bytes('x')), error('EINVAL'));
  assert.throws(() => fs.stat('/workspace/back\\slash/child'), error('ENOTDIR'));
  assert.throws(() => fs.stat('/workspace/back\\slash/'), error('ENOTDIR'));
  assert.throws(() => fs.stat('.', { cwd: '/workspace/back\\slash' }), error('ENOTDIR'));
  assert.equal(fs.stat('/workspace/project').type, 'directory');
  assert.deepEqual(fs.readdir('/workspace/project'), ['include', 'src']);
});

test('FS-02: symlink traversal precedes .. and enforces directory capabilities', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('/workspace/first');
  fs.mkdir('/workspace/second/nested', { recursive: true });
  fs.writeFile('/workspace/second/file', bytes('expected'));
  fs.symlink('../second/nested', '/workspace/first/link');
  assert.equal(text(fs.readFile('link/../file', { cwd: '/workspace/first', root: '/workspace' })), 'expected');
  assert.equal(fs.lstat('/workspace/first/link').type, 'symlink');
  assert.equal(fs.stat('/workspace/first/link').type, 'directory');
  assert.equal(fs.readlink('/workspace/first/link'), '../second/nested');
  fs.symlink('/tmp', '/workspace/escape');
  assert.throws(() => fs.stat('/workspace/escape', { root: '/workspace' }), error('EACCES'));
  assert.throws(() => fs.stat('../tmp', { root: '/workspace' }), error('EACCES'));
  assert.throws(() => fs.stat('/tmp', { root: '/workspace' }), error('EACCES'));
  fs.symlink('b', '/workspace/a');
  fs.symlink('a', '/workspace/b');
  assert.throws(() => fs.stat('/workspace/a'), error('ELOOP'));
  assert.equal(fs.realpath('/../../workspace'), '/workspace');
});

test('creation follows a dangling symlink without replacing its dentry', () => {
  const fs = new MemoryFileSystem();
  fs.symlink('new-file', 'link');
  assert.throws(() => fs.open('link', { create: true, exclusive: true, write: true }), error('EEXIST'));
  fs.writeFile('link', bytes('created'));
  assert.equal(fs.lstat('link').type, 'symlink');
  assert.equal(text(fs.readFile('new-file')), 'created');
  fs.symlink('/tmp/new', 'outside');
  assert.throws(() => fs.writeFile('outside', bytes('x'), { root: '/workspace' }), error('EACCES'));
  fs.symlink('new-directory/', 'trailing');
  assert.throws(() => fs.writeFile('trailing', bytes('x')), error('ENOTDIR'));
});

test('FS-03: dup shares offsets, pread/pwrite do not, rename retains inode', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('source', bytes('abcdef'));
  const inode = fs.stat('source').inode;
  const fd = fs.open('source', { read: true, write: true });
  const duplicate = fs.dup(fd);
  assert.equal(text(fs.read(fd, 2)), 'ab');
  assert.equal(text(fs.read(duplicate, 2)), 'cd');
  assert.equal(text(fs.pread(fd, 2, 0)), 'ab');
  assert.equal(fs.tell(duplicate), 4);
  assert.equal(fs.pwrite(duplicate, bytes('Z'), 1), 1);
  assert.equal(fs.tell(fd), 4);
  fs.rename('source', 'destination');
  assert.equal(fs.stat('destination').inode, inode);
  assert.equal(text(fs.read(fd, 100)), 'ef');
  assert.equal(text(fs.readFile('destination')), 'aZcdef');
  assert.equal(fs.seek(duplicate, -2, 'end'), 4);
  assert.equal(fs.tell(fd), 4);
  fs.close(fd);
  assert.equal(text(fs.read(duplicate, 99)), 'ef');
  fs.close(duplicate);
  assert.throws(() => fs.close(duplicate), error('EBADF'));
});

test('FS-03: unlinked open files remain usable and count against quota until close', () => {
  const fs = new MemoryFileSystem({ maxBytes: 6 });
  fs.writeFile('file', bytes('abcdef'));
  const fd = fs.open('file', { read: true, write: true });
  const inode = fs.fstat(fd).inode;
  fs.unlink('file');
  assert.throws(() => fs.stat('file'), error('ENOENT'));
  assert.throws(() => fs.writeFile('new', bytes('x')), error('ENOSPC'));
  assert.equal(text(fs.read(fd, 6)), 'abcdef');
  fs.seek(fd, 0);
  fs.write(fd, bytes('Z'));
  assert.equal(fs.fstat(fd).inode, inode);
  assert.equal(text(fs.pread(fd, 6, 0)), 'Zbcdef');
  fs.close(fd);
  assert.equal(fs.byteLength, 0);
  fs.writeFile('new', bytes('xyz'));
});

test('directory descriptors follow rename and detect unlink', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('before');
  const fd = fs.open('before', { directory: true, root: '/workspace' });
  fs.rename('before', 'after');
  assert.equal(fs.getDirectoryPath(fd), '/workspace/after');
  assert.equal(fs.fstat(fd).type, 'directory');
  fs.rmdir('after');
  assert.throws(() => fs.getDirectoryPath(fd), error('ENOENT'));
  fs.close(fd);
});

test('rename replacement preserves the destination open inode and rejects subtree cycles', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('a', bytes('a'));
  fs.writeFile('b', bytes('b'));
  const fd = fs.open('b');
  fs.rename('a', 'b');
  assert.equal(text(fs.readFile('b')), 'a');
  assert.equal(text(fs.read(fd, 1)), 'b');
  fs.close(fd);
  fs.mkdir('dir/nested', { recursive: true });
  assert.throws(() => fs.rename('dir', 'dir/nested/moved'), error('EINVAL'));
  assert.throws(() => fs.rmdir('dir'), error('ENOTEMPTY'));
  assert.throws(() => fs.unlink('dir'), error('EISDIR'));
  assert.throws(() => fs.rename('b', 'dir'), error('EISDIR'));
});

test('FS-04: readonly targets and parents, separate mounts, readonly command tree', () => {
  const fs = new MemoryFileSystem();
  fs.mountReadonly('/opt/toolchains/pinned', [
    { path: 'include', type: 'directory', mode: 0o755 },
    { path: 'include/a.h', type: 'file', mode: 0o444, data: bytes('header') },
    { path: 'alias.h', type: 'symlink', mode: 0o777, target: 'include/a.h' },
  ]);
  assert.equal(text(fs.readFile('/opt/toolchains/pinned/alias.h')), 'header');
  assert.throws(() => fs.writeFile('/opt/toolchains/pinned/include/a.h', bytes('tamper')), error('EROFS'));
  fs.symlink('/opt/toolchains/pinned/include/a.h', 'file-link');
  fs.symlink('/opt/toolchains/pinned/include', 'directory-link');
  assert.throws(() => fs.writeFile('file-link', bytes('tamper')), error('EROFS'));
  assert.throws(() => fs.writeFile('directory-link/new.h', bytes('tamper')), error('EROFS'));
  assert.throws(() => fs.unlink('directory-link/a.h'), error('EROFS'));
  assert.throws(() => fs.mkdir('directory-link/new'), error('EROFS'));
  fs.writeFile('file', bytes('data'));
  assert.throws(() => fs.rename('/workspace/file', '/tmp/file'), error('EXDEV'));
  assert.throws(() => fs.writeFile('/usr/bin/clang', bytes('replacement')), error('EROFS'));
  fs.unlink('file-link');
  assert.equal(text(fs.readFile('/opt/toolchains/pinned/include/a.h')), 'header');
});

test('readonly mounts validate the complete tree and publish nothing on failure', () => {
  const fs = new MemoryFileSystem();
  const before = fs.exportSnapshot();
  for (const entries of [
    [{ path: '../escape', type: 'file', mode: 0o444, data: bytes('x') }],
    [{ path: '/absolute', type: 'file', mode: 0o444, data: bytes('x') }],
    [{ path: 'missing/child', type: 'file', mode: 0o444, data: bytes('x') }],
    [{ path: 'escape', type: 'symlink', mode: 0o777, target: '/workspace' }],
    [{ path: 'loop', type: 'symlink', mode: 0o777, target: 'loop' }],
    [{ path: 'dup', type: 'directory', mode: 0o755 }, { path: 'dup', type: 'directory', mode: 0o755 }],
    [{ path: 'file', type: 'file', mode: 0o444, data: bytes('x') }, { path: 'file/child', type: 'directory', mode: 0o755 }],
  ]) {
    assert.throws(() => fs.mountReadonly('/opt/bad', entries), FsError);
    assert.deepEqual(fs.exportSnapshot(), before);
  }
  assert.throws(() => fs.mountReadonly('/workspace/pkg', []), error('EBUSY'));
});

test('FD-01/02: zero I/O, short reads, binary data, sparse write and append', () => {
  const fs = new MemoryFileSystem();
  const raw = new Uint8Array([0, 255, 0xe2, 0x82, 0xac, 0]);
  fs.writeFile('binary', raw);
  raw.fill(12);
  const fd = fs.open('binary', { read: true, write: true });
  assert.equal(fs.read(fd, 0).length, 0);
  assert.equal(fs.tell(fd), 0);
  assert.deepEqual(fs.read(fd, 3), new Uint8Array([0, 255, 0xe2]));
  assert.deepEqual(fs.read(fd, 100), new Uint8Array([0x82, 0xac, 0]));
  assert.equal(fs.read(fd, 1).length, 0);
  fs.seek(fd, 8);
  fs.write(fd, new Uint8Array());
  assert.equal(fs.fstat(fd).size, 6);
  fs.write(fd, new Uint8Array([42]));
  assert.deepEqual(fs.pread(fd, 4, 5), new Uint8Array([0, 0, 0, 42]));
  fs.ftruncate(fd, 2);
  assert.equal(fs.tell(fd), 9);
  fs.close(fd);
  const append = fs.open('binary', { write: true, append: true });
  fs.write(append, new Uint8Array());
  assert.equal(fs.tell(append), 0);
  fs.write(append, new Uint8Array([3]));
  fs.seek(append, 0);
  fs.write(append, new Uint8Array([4]));
  assert.deepEqual(fs.readFile('binary'), new Uint8Array([0, 255, 3, 4]));
  fs.pwrite(append, new Uint8Array([8]), 0);
  assert.deepEqual(fs.readFile('binary'), new Uint8Array([8, 255, 3, 4]));
  fs.close(append);
});

test('quotas and malformed operations cannot truncate existing bytes', () => {
  const fs = new MemoryFileSystem({ maxBytes: 4, maxInodes: 11 });
  fs.writeFile('file', bytes('abcd'));
  const original = fs.readFile('file');
  assert.throws(() => fs.writeFile('file', bytes('overflow')), error('ENOSPC'));
  assert.throws(() => fs.writeFile('other', bytes('')), error('ENOSPC'));
  assert.throws(() => fs.truncate('file', 5), error('ENOSPC'));
  assert.deepEqual(fs.readFile('file'), original);
  const readOnly = fs.open('file');
  assert.throws(() => fs.write(readOnly, bytes('x')), error('EBADF'));
  assert.throws(() => fs.seek(readOnly, -1), error('EINVAL'));
  assert.throws(() => fs.pread(readOnly, -1, 0), error('EINVAL'));
  assert.throws(() => fs.open('file', { truncate: true }), error('EINVAL'));
  fs.close(readOnly);
  const copy = fs.readFile('file');
  copy.fill(0);
  assert.deepEqual(fs.readFile('file'), original);
});

test('FS-05/06: snapshot lease blocks edits, normal/nonzero commit applies complete diff', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('source', bytes('source'));
  fs.writeFile('removed', bytes('old'));
  const inode = fs.stat('source').inode;
  const before = fs.generation;
  const lease = fs.acquireSnapshot();
  assert.throws(() => fs.writeFile('source', bytes('editor')), error('EBUSY'));
  assert.throws(() => fs.mkdir('busy'), error('EBUSY'));
  assert.throws(() => fs.open('source'), error('EBUSY'));
  assert.throws(() => fs.acquireSnapshot(), error('EBUSY'));
  assert.equal(text(fs.readFile('source')), 'source');
  const worker = MemoryFileSystem.fromSnapshot(lease.snapshot);
  worker.writeFile('source', bytes('changed by guest'));
  worker.writeFile('new', bytes('produced before exit 1'));
  worker.unlink('removed');
  assert.equal(text(fs.readFile('source')), 'source');
  lease.commit(worker.exportSnapshot());
  assert.equal(text(fs.readFile('source')), 'changed by guest');
  assert.equal(text(fs.readFile('new')), 'produced before exit 1');
  assert.throws(() => fs.stat('removed'), error('ENOENT'));
  assert.equal(fs.stat('source').inode, inode);
  assert.equal(fs.generation, before + 1);
  assert.throws(() => lease.commit(worker.exportSnapshot()), error('ECONFLICT'));
  lease.discard();
  fs.writeFile('source', bytes('editor can continue'));
});

test('FS-05: crash/cancel discard and malformed/readonly diff leave original data intact', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('source', bytes('original'));
  fs.mountReadonly('/opt/pkg', [{ path: 'tool', type: 'file', mode: 0o555, data: bytes('trusted') }]);
  for (let i = 0; i < 2; i++) {
    const lease = fs.acquireSnapshot();
    const worker = MemoryFileSystem.fromSnapshot(lease.snapshot);
    worker.writeFile('source', bytes('private output'));
    lease.discard();
    lease.discard();
    assert.equal(text(fs.readFile('source')), 'original');
  }
  const before = fs.exportSnapshot();
  const lease = fs.acquireSnapshot();
  const tampered = structuredClone(lease.snapshot);
  tampered.entries.find(entry => entry.path === '/opt/pkg/tool').data = bytes('tampered');
  assert.throws(() => lease.commit(tampered), error('EROFS'));
  assert.deepEqual(fs.exportSnapshot(), before);
  assert.throws(() => fs.writeFile('source', bytes('still busy')), error('EBUSY'));
  lease.discard();
  fs.writeFile('source', bytes('recovered'));
});

test('snapshot admission and parsing reject host handles, malformed trees, quota and mount edits', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('file', bytes('data'));
  const fd = fs.open('file');
  assert.throws(() => fs.acquireSnapshot(), error('EBUSY'));
  assert.throws(() => fs.mountReadonly('/opt/pkg', []), error('EBUSY'));
  fs.close(fd);
  const snapshot = fs.exportSnapshot();
  const mutate = (fn) => { const copy = structuredClone(snapshot); fn(copy); return copy; };
  for (const invalid of [
    mutate(value => value.entries.push(value.entries[0])),
    mutate(value => value.entries.push({ path: '/workspace/../escape', type: 'directory', mode: 0o755 })),
    mutate(value => value.entries.push({ path: '/workspace/file/child', type: 'directory', mode: 0o755 })),
    mutate(value => value.mounts[0].readonly = false),
    mutate(value => value.entries.find(entry => entry.path === '/workspace/file').data = 'wrong type'),
  ]) assert.throws(() => MemoryFileSystem.fromSnapshot(invalid), FsError);
  assert.throws(() => MemoryFileSystem.fromSnapshot(snapshot, { maxBytes: 3 }), error('ENOSPC'));
  const lease = fs.acquireSnapshot();
  const edited = structuredClone(snapshot);
  edited.mounts.find(mount => mount.path === '/workspace').readonly = true;
  assert.throws(() => lease.commit(edited), error('EROFS'));
  lease.discard();
});

test('independent filesystems never share mutable bytes or inode namespaces', () => {
  const first = new MemoryFileSystem();
  first.writeFile('same', bytes('first'));
  const second = MemoryFileSystem.fromSnapshot(first.exportSnapshot());
  second.writeFile('same', bytes('second'));
  assert.equal(text(first.readFile('same')), 'first');
  assert.equal(text(second.readFile('same')), 'second');
  second.unlink('same');
  assert.equal(text(first.readFile('same')), 'first');
});

test('snapshot commit preserves renamed directory/file identities and gives replacement paths new identities', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('tree');
  fs.writeFile('tree/child', bytes('original'));
  fs.writeFile('replaced', bytes('replacement destination'));
  const directory = fs.stat('tree').inode;
  const child = fs.stat('tree/child').inode;
  const replaced = fs.stat('replaced').inode;
  const lease = fs.acquireSnapshot();
  const guest = MemoryFileSystem.fromSnapshot(lease.snapshot);
  assert.equal(guest.stat('tree/child').inode, child);
  guest.rename('tree', 'moved');
  guest.mkdir('tree');
  guest.rename('moved/child', 'replaced');
  guest.writeFile('moved/new', bytes('new file'));
  lease.commit(guest.exportSnapshot());
  assert.equal(fs.stat('moved').inode, directory);
  assert.equal(fs.stat('replaced').inode, child);
  assert.notEqual(fs.stat('tree').inode, directory);
  assert.notEqual(fs.stat('moved/new').inode, replaced);
  assert.equal(new Set(fs.exportSnapshot().entries.map((entry) => entry.inode)).size, fs.inodeCount);
});

test('snapshot inode allocation never reuses removed IDs across restores, commits or mounts', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('removed', bytes('old'));
  const retired = fs.stat('removed').inode;
  fs.unlink('removed');
  const lease = fs.acquireSnapshot();
  const guest = MemoryFileSystem.fromSnapshot(lease.snapshot);
  guest.writeFile('temporary', bytes('temporary'));
  const temporary = guest.stat('temporary').inode;
  assert.ok(temporary > retired);
  guest.unlink('temporary');
  lease.commit(guest.exportSnapshot());
  fs.mountReadonly('/opt/toolchain', [{ path: 'file', type: 'file', mode: 0o444, data: bytes('tool') }]);
  assert.ok(fs.stat('/opt/toolchain/file').inode > temporary);
  const existing = fs.stat('/opt/toolchain/file').inode;
  fs.writeFile('later', bytes('later'));
  assert.ok(fs.stat('later').inode > existing);
  assert.equal(fs.stat('/opt/toolchain/file').inode, existing);
});

test('snapshot decoder rejects missing, duplicate, invalid and exhausted inode identities', () => {
  const fs = new MemoryFileSystem();
  const snapshot = fs.exportSnapshot();
  for (const mutate of [
    (value) => { delete value.entries[0].inode; },
    (value) => { value.entries[0].inode = value.entries[1].inode; },
    (value) => { value.entries[0].inode = 0; },
    (value) => { value.entries[0].inode = -1; },
    (value) => { value.entries[0].inode = 1.5; },
    (value) => { value.entries[0].inode = Number.MAX_SAFE_INTEGER; },
    (value) => { delete value.nextInode; },
    (value) => { value.nextInode = value.entries.at(-1).inode; },
    (value) => { value.nextInode = Number.MAX_SAFE_INTEGER + 1; }
  ]) {
    const invalid = structuredClone(snapshot); mutate(invalid);
    assert.throws(() => MemoryFileSystem.fromSnapshot(invalid), error('EINVAL'));
  }
});

test('snapshot commit rejects recycled identities, type/mount changes and readonly identity substitution', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('retired', bytes('old')); const retired = fs.stat('retired').inode; fs.unlink('retired');
  fs.writeFile('file', bytes('current'));
  fs.mountReadonly('/opt/pkg', [{ path: 'tool', type: 'file', mode: 0o444, data: bytes('trusted') }]);
  const lease = fs.acquireSnapshot();
  for (const mutate of [
    (value) => { value.entries.find((entry) => entry.path === '/workspace/file').inode = retired; },
    (value) => { const entry = value.entries.find((entry) => entry.path === '/workspace/file'); entry.type = 'directory'; delete entry.data; },
    (value) => { value.entries.find((entry) => entry.path === '/workspace/file').path = '/tmp/file'; },
    (value) => { value.entries.find((entry) => entry.path === '/opt/pkg/tool').inode = value.nextInode++; }
  ]) {
    const tampered = structuredClone(lease.snapshot); mutate(tampered);
    assert.throws(() => lease.commit(tampered), FsError);
    assert.equal(text(fs.readFile('file')), 'current');
  }
  lease.discard();
});

test('readonly package closure publishes every mount in one generation with stable existing identities', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('user', bytes('workspace'));
  const inode = fs.stat('user').inode; const generation = fs.generation;
  fs.mountReadonlyPackages([
    { path: '/opt/toolchains/one', entries: [{ path: 'a', type: 'file', mode: 0o444, data: bytes('one') }] },
    { path: '/opt/toolchains/two', entries: [{ path: 'b', type: 'file', mode: 0o555, data: bytes('two') }] }
  ]);
  assert.equal(text(fs.readFile('/opt/toolchains/one/a')), 'one');
  assert.equal(text(fs.readFile('/opt/toolchains/two/b')), 'two');
  assert.equal(fs.generation, generation + 1); assert.equal(fs.stat('user').inode, inode);
  assert.throws(() => fs.writeFile('/opt/toolchains/one/a', bytes('changed')), error('EROFS'));
  assert.throws(() => fs.unlink('/opt/toolchains/two/b'), error('EROFS'));
  const before = fs.exportSnapshot(); fs.mountReadonlyPackages([]); assert.deepEqual(fs.exportSnapshot(), before);
});

test('invalid second package leaves no first mount, namespace, allocation or generation changes', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('user', bytes('workspace'));
  const before = fs.exportSnapshot();
  const good = { path: '/opt/toolchains/one', entries: [{ path: 'a', type: 'file', mode: 0o444, data: bytes('one') }] };
  for (const bad of [
    { path: '/opt/toolchains/two', entries: [{ path: '../escape', type: 'file', mode: 0o444, data: bytes('bad') }] },
    { path: '/opt/toolchains/two', entries: [{ path: 'link', type: 'symlink', mode: 0o777, target: '/workspace/user' }] },
    { path: '/opt/toolchains/two', entries: [{ path: 'missing/child', type: 'file', mode: 0o444, data: bytes('bad') }] },
    { path: '/opt/toolchains/one/nested', entries: [] }
  ]) {
    assert.throws(() => fs.mountReadonlyPackages([good, bad]), FsError);
    assert.deepEqual(fs.exportSnapshot(), before);
    assert.throws(() => fs.stat('/opt/toolchains'), error('ENOENT'));
  }
});

test('combined readonly package quotas are checked before any package is published', () => {
  const packages = [
    { path: '/opt/one', entries: [{ path: 'a', type: 'file', mode: 0o444, data: bytes('one') }] },
    { path: '/opt/two', entries: [{ path: 'b', type: 'file', mode: 0o444, data: bytes('two') }] }
  ];
  for (const options of [{ maxBytes: 5 }, { maxInodes: 13 }]) {
    const fs = new MemoryFileSystem(options); const before = fs.exportSnapshot();
    assert.throws(() => fs.mountReadonlyPackages(packages), error('ENOSPC'));
    assert.deepEqual(fs.exportSnapshot(), before);
  }
});

test('resolved create and relocated subtree respect absolute path budgets', () => {
  const fs = new MemoryFileSystem();
  const deep = '/workspace/' + Array(127).fill('d').join('/');
  fs.mkdir(deep, { recursive: true });
  const snapshot = fs.exportSnapshot();
  assert.throws(() => fs.mkdir('extra', { cwd: deep }), { code: 'EINVAL' });
  assert.deepEqual(fs.exportSnapshot(), snapshot);
  fs.mkdir('/workspace/tree/child', { recursive: true });
  const before = fs.exportSnapshot();
  const parent = deep.slice(0, -2);
  assert.throws(() => fs.rename('/workspace/tree', parent + '/tree'), { code: 'EINVAL' });
  assert.deepEqual(fs.exportSnapshot(), before);
  assert.doesNotThrow(() => MemoryFileSystem.fromSnapshot(fs.exportSnapshot()));
});

test('snapshot and readonly validation preserve inode timestamps', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('file', bytes('data'));
  const snapshot = fs.exportSnapshot();
  const entry = snapshot.entries.find((e) => e.path === '/workspace/file');
  entry.mtimeMs = 123; entry.ctimeMs = 456;
  const restored = MemoryFileSystem.fromSnapshot(snapshot);
  assert.equal(restored.stat('file').mtimeMs, 123); assert.equal(restored.stat('file').ctimeMs, 456);
  assert.deepEqual(restored.exportSnapshot(), snapshot);
  entry.mtimeMs = -1; assert.throws(() => MemoryFileSystem.fromSnapshot(snapshot), { code: 'EINVAL' });
  const lease = restored.acquireSnapshot();
  const result = structuredClone(lease.snapshot); result.entries.find((e) => e.path === '/').mtimeMs++;
  assert.throws(() => lease.commit(result), { code: 'EROFS' }); lease.discard();
});
