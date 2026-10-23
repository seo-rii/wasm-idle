import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

const bytes = value => new TextEncoder().encode(value);

test('directory descriptor path lookup stays independent of unrelated namespace width', t => {
  const visits = [];
  for (const width of [8, 512]) {
    const fs = new MemoryFileSystem();
    for (let index = 0; index < width; index++) {
      fs.mkdir(`/workspace/unrelated/branch-${index}/leaf`, { recursive: true });
      fs.writeFile(`/workspace/unrelated/branch-${index}/data`, bytes('x'));
    }
    fs.mkdir('/workspace/target/nested', { recursive: true });
    const directory = fs.open('/workspace/target/nested', { directory: true });
    // Count namespace iteration only during lookup; fixture creation is excluded.
    const iterate = Map.prototype[Symbol.iterator];
    let visited = 0, path;
    Map.prototype[Symbol.iterator] = function* () {
      for (const entry of iterate.call(this)) { visited++; yield entry; }
    };
    try { path = fs.getDirectoryPath(directory); }
    finally { Map.prototype[Symbol.iterator] = iterate; fs.close(directory); }
    assert.equal(path, '/workspace/target/nested');
    visits.push(visited);
  }
  assert.ok(visits[1] <= visits[0] + 16, `unrelated entries visited: ${visits.join(' -> ')}`);
  t.diagnostic(`namespace entries visited at widths 8 and 512: ${visits.join(', ')}`);
});

test('nested directory descriptions follow ancestor moves without widening their capability', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('/workspace/capability/tree/nested', { recursive: true });
  fs.mkdir('/workspace/outside');
  fs.symlink('tree/nested', '/workspace/capability/alias');
  const directory = fs.open('alias', { cwd: '/workspace/capability', root: '/workspace/capability', directory: true });
  const duplicate = fs.dup(directory), root = fs.open('/', { directory: true });
  try {
    assert.equal(fs.getDirectoryPath(root), '/');
    assert.equal(fs.getDirectoryPath(directory), '/workspace/capability/tree/nested');
    fs.rename('/workspace/capability/tree', '/workspace/capability/renamed');
    assert.equal(fs.getDirectoryPath(duplicate), '/workspace/capability/renamed/nested');
    fs.rename('/workspace/capability/renamed', '/workspace/outside/tree');
    for (const descriptor of [directory, duplicate]) assert.throws(() => fs.getDirectoryPath(descriptor), { code: 'EACCES' });
    fs.rename('/workspace/outside/tree', '/workspace/capability/back');
    assert.equal(fs.getDirectoryPath(directory), '/workspace/capability/back/nested');
    fs.rmdir('/workspace/capability/back/nested');
    fs.mkdir('/workspace/capability/back/nested');
    for (const descriptor of [directory, duplicate]) assert.throws(() => fs.getDirectoryPath(descriptor), { code: 'ENOENT' });
  } finally { fs.close(directory); fs.close(duplicate); fs.close(root); }
});

test('replacing an open directory never redirects its old description to the replacement', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('source/nested', { recursive: true }); fs.mkdir('destination');
  const source = fs.open('source/nested', { directory: true });
  const replaced = fs.open('destination', { directory: true });
  try {
    fs.rename('source', 'destination');
    assert.equal(fs.getDirectoryPath(source), '/workspace/destination/nested');
    assert.throws(() => fs.getDirectoryPath(replaced), { code: 'ENOENT' });
    assert.notEqual(fs.fstat(replaced).inode, fs.stat('destination').inode);
  } finally { fs.close(source); fs.close(replaced); }
});

test('restored and committed snapshots rebuild current descriptor and file-version paths', () => {
  let fs = new MemoryFileSystem();
  fs.mkdir('/workspace/tree/nested', { recursive: true });
  fs.writeFile('/workspace/tree/nested/data', bytes('old'));
  fs = MemoryFileSystem.fromSnapshot(fs.exportSnapshot());
  const directory = fs.open('tree/nested', { directory: true, snapshot: 'preserve' });
  try {
    assert.equal(fs.getDirectoryPath(directory), '/workspace/tree/nested');
    const lease = fs.acquireSnapshot(), guest = MemoryFileSystem.fromSnapshot(lease.snapshot);
    guest.rename('tree', 'moved');
    lease.commit(guest.exportSnapshot());
    assert.equal(fs.getDirectoryPath(directory), '/workspace/moved/nested');
    const version = fs.captureFileVersion('moved/nested/data');
    assert.equal(fs.readFileVersion(version).path, '/workspace/moved/nested/data');
    fs.rename('moved', 'again');
    assert.equal(fs.getDirectoryPath(directory), '/workspace/again/nested');
    assert.equal(fs.readFileVersion(version), undefined);
    assert.equal(fs.readFileVersion(fs.captureFileVersion('again/nested/data')).path, '/workspace/again/nested/data');
  } finally { fs.close(directory); }
});

test('readonly publication preserves paths and remaps new package ancestry to retained inode objects', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('tree/nested', { recursive: true }); fs.writeFile('tree/nested/data', bytes('old'));
  fs.mkdir('removed');
  const directory = fs.open('tree/nested', { directory: true });
  const removed = fs.open('removed', { directory: true }); fs.rmdir('removed');
  const version = fs.captureFileVersion('tree/nested/data');
  try {
    fs.mountReadonly('/opt/toolchain', [
      { path: 'include', type: 'directory', mode: 0o555 },
      { path: 'include/header.h', type: 'file', mode: 0o444, data: bytes('header') },
    ]);
    fs.mountReadonly('/opt/other', []);
    assert.equal(fs.getDirectoryPath(directory), '/workspace/tree/nested');
    assert.equal(fs.readFileVersion(version).path, '/workspace/tree/nested/data');
    const include = fs.open('/opt/toolchain/include', { directory: true });
    try { assert.equal(fs.getDirectoryPath(include), '/opt/toolchain/include'); }
    finally { fs.close(include); }
    fs.rename('tree', 'moved');
    assert.equal(fs.getDirectoryPath(directory), '/workspace/moved/nested');
    assert.equal(fs.readFileVersion(fs.captureFileVersion('/opt/toolchain/include/header.h')).path, '/opt/toolchain/include/header.h');
    fs.mkdir('removed');
    assert.throws(() => fs.getDirectoryPath(removed), { code: 'ENOENT' });
  } finally { fs.close(directory); fs.close(removed); }
});

test('failed namespace changes leave descriptor and file-version paths intact', () => {
  const fs = new MemoryFileSystem();
  fs.mkdir('tree/nested', { recursive: true }); fs.writeFile('tree/nested/data', bytes('old'));
  const directory = fs.open('tree/nested', { directory: true, snapshot: 'preserve' });
  const version = fs.captureFileVersion('tree/nested/data');
  try {
    assert.throws(() => fs.rename('tree', 'tree/nested/invalid'), { code: 'EINVAL' });
    assert.throws(() => fs.mountReadonly('/opt/failed', [
      { path: 'escape', type: 'symlink', mode: 0o777, target: '/workspace' },
    ]), { code: 'EACCES' });
    assert.throws(() => fs.stat('/opt/failed'), { code: 'ENOENT' });
    const lease = fs.acquireSnapshot();
    const changed = structuredClone(lease.snapshot);
    changed.entries.find(entry => entry.path === '/').mode = 0o700;
    try { assert.throws(() => lease.commit(changed), { code: 'EROFS' }); }
    finally { lease.discard(); }
    assert.equal(fs.getDirectoryPath(directory), '/workspace/tree/nested');
    assert.equal(fs.readFileVersion(version).path, '/workspace/tree/nested/data');
  } finally { fs.close(directory); }
});
