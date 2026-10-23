import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

const bytes = value => new TextEncoder().encode(value);
const write = (path, value) => ({ path, bytes: bytes(value) });
const scope = { root: '/workspace', cwd: '/workspace' };

test('failed file changes preserve bytes, metadata, inode allocation and mutation accounting', () => {
  for (const limits of [{ maxBytes: 8 }, { maxInodes: 14 }]) {
    const fs = new MemoryFileSystem(limits);
    fs.writeFile('old', bytes('old')); fs.writeFile('kept', bytes('a'));
    const before = fs.exportSnapshot(), version = fs.captureFileVersion('kept'), observer = fs.observeMutations();
    try {
      assert.throws(() => fs.applyFileChanges({ remove: ['old'], write: [write('kept', 'edit'), write('nested/deeper/new', '12345')] }, scope), { code: 'ENOSPC' });
      assert.deepEqual(fs.exportSnapshot(), before);
      assert.equal(fs.captureFileVersion('kept'), version);
      assert.equal(observer.hasChangesOutside(new Set()), false);
    } finally { observer.dispose(); }
  }
});

test('path, capability and readonly failures roll back earlier removals and writes', () => {
  for (const [destination, code] of [['blocked/new', 'ENOTDIR'], ['escape/new', 'EACCES'], ['/opt/toolchain/new', 'EROFS']]) {
    const fs = new MemoryFileSystem();
    fs.writeFile('old', bytes('old')); fs.writeFile('kept', bytes('a')); fs.writeFile('blocked', bytes('file'));
    fs.symlink('/tmp', 'escape'); fs.mountReadonly('/opt/toolchain', []);
    const before = fs.exportSnapshot();
    assert.throws(() => fs.applyFileChanges({
      remove: ['/workspace/old'], write: [write('/workspace/kept', 'edit'), write(destination, 'new')]
    }, code === 'EROFS' ? {} : scope), { code });
    assert.deepEqual(fs.exportSnapshot(), before);
  }
});

test('successful publication preserves live descriptors, dup offsets and unchanged versions', async () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('edited', bytes('abcd')); fs.writeFile('removed', bytes('old')); fs.writeFile('untouched', bytes('same'));
  const edited = fs.open('edited', { read: true, write: true }), duplicate = fs.dup(edited), removed = fs.open('removed');
  const live = fs.acquireLive(), owner = {}, observer = fs.observeMutations();
  const stable = fs.captureFileVersion('untouched'), obsolete = fs.captureFileVersion('edited'), removedVersion = fs.captureFileVersion('removed');
  const abort = new AbortController(), events = fs.watch({ signal: abort.signal }).getReader();
  try {
    assert.equal(new TextDecoder().decode(fs.read(edited, 1)), 'a');
    const generation = fs.generation, changed = events.read();
    fs.withMutationSource(owner, () => fs.applyFileChanges({
      remove: ['removed'], write: [write('edited', 'WXYZ'), write('dir/new', 'new')]
    }, scope));
    assert.equal(fs.generation, generation + 1);
    assert.deepEqual((await changed).value, { kind: 'rescan', path: '/workspace', generation: fs.generation });
    assert.equal(observer.hasChangesOutside(new Set([owner])), false);
    assert.equal(fs.captureFileVersion('untouched'), stable);
    assert.equal(fs.readFileVersion(obsolete), undefined); assert.equal(fs.readFileVersion(removedVersion), undefined);
    assert.equal(new TextDecoder().decode(fs.read(duplicate, 1)), 'X'); assert.equal(fs.tell(edited), 2);
    assert.equal(new TextDecoder().decode(fs.read(removed, 3)), 'old');
    assert.equal(fs.byteLength, 14, 'unlinked open bytes remain charged');
    fs.close(removed); assert.equal(fs.byteLength, 11);
    fs.write(edited, bytes('!')); assert.equal(new TextDecoder().decode(fs.readFile('edited')), 'WX!Z');
  } finally {
    fs.close(edited); fs.close(duplicate); live.release(); observer.dispose(); abort.abort(); events.releaseLock();
  }
});

test('retained unlinked bytes and snapshot writer leases cannot be bypassed by a batch', () => {
  const fs = new MemoryFileSystem({ maxBytes: 8 });
  fs.writeFile('old', bytes('old')); fs.writeFile('kept', bytes('data'));
  const fd = fs.open('old');
  const before = fs.exportSnapshot();
  assert.throws(() => fs.applyFileChanges({ remove: ['old'], write: [write('kept', '123456')] }, scope), { code: 'ENOSPC' });
  assert.deepEqual(fs.exportSnapshot(), before); assert.deepEqual(fs.read(fd, 3), bytes('old'));
  fs.close(fd);
  const lease = fs.acquireSnapshot();
  try {
    assert.throws(() => fs.applyFileChanges({ remove: ['old'], write: [write('kept', 'new')] }, scope), { code: 'EBUSY' });
    assert.deepEqual(fs.exportSnapshot(), before);
  } finally { lease.discard(); }
});

test('batch staging copies no untouched file body and identical writes retain their generation', t => {
  const fs = new MemoryFileSystem();
  fs.mountReadonly('/opt/toolchain', [{ path: 'compiler', type: 'file', mode: 0o444, data: new Uint8Array(1024 * 1024) }]);
  fs.writeFile('file', bytes('before'));
  const original = Uint8Array.prototype.slice;
  let copied = 0;
  const spy = t.mock.method(Uint8Array.prototype, 'slice', function (...args) { copied += this.byteLength; return original.apply(this, args); });
  try { fs.applyFileChanges({ remove: [], write: [write('file', 'after')] }, scope); }
  finally { spy.mock.restore(); }
  assert.equal(copied, 0);
  const generation = fs.generation, version = fs.captureFileVersion('file');
  fs.applyFileChanges({ remove: ['missing'], write: [write('file', 'after')] }, scope);
  assert.equal(fs.generation, generation); assert.equal(fs.captureFileVersion('file'), version);
});

test('optional root creation stays inside the batch and preserves its path capability', () => {
  const fs = new MemoryFileSystem(), options = { root: '/workspace/new', cwd: '/workspace/new', createRoot: true };
  const before = fs.exportSnapshot();
  assert.throws(() => fs.applyFileChanges({ remove: [], write: [write('../escape', 'x')] }, options), { code: 'EACCES' });
  assert.deepEqual(fs.exportSnapshot(), before);
  const lease = fs.acquireSnapshot();
  try {
    assert.throws(() => fs.applyFileChanges({ remove: [], write: [] }, options), { code: 'EBUSY' });
    assert.deepEqual(fs.exportSnapshot(), before);
  } finally { lease.discard(); }
  assert.throws(() => fs.applyFileChanges({ remove: [], write: [] }, { createRoot: true }), { code: 'EINVAL' });
  fs.applyFileChanges({ remove: [], write: [] }, options);
  assert.equal(fs.stat(options.root).type, 'directory'); assert.equal(fs.generation, before.generation + 1);
  fs.applyFileChanges({ remove: [], write: [write('file', 'x')] }, options);
  assert.deepEqual(fs.readFile('/workspace/new/file'), bytes('x'));
});
