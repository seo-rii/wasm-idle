import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

const bytes = value => new TextEncoder().encode(value);

test('owner mutation accounting detects transient foreign edits without draining a watch queue', () => {
  const fs = new MemoryFileSystem(), compiler = {}, foreign = {};
  fs.writeFile('/workspace/header.h', bytes('original'));
  const observer = fs.observeMutations();
  try {
    fs.withMutationSource(compiler, () => fs.writeFile('/workspace/program.wasm', bytes('output')));
    assert.equal(observer.hasChangesOutside(new Set([compiler])), false);
    fs.withMutationSource(foreign, () => {
      fs.writeFile('/workspace/header.h', bytes('temporary'));
      fs.writeFile('/workspace/header.h', bytes('original'));
    });
    assert.equal(observer.hasChangesOutside(new Set([compiler])), true);
    assert.equal(observer.hasChangesOutside(new Set([compiler, foreign])), false);
  } finally { observer.dispose(); }
  assert.equal(observer.hasChangesOutside(new Set([compiler, foreign])), true);
});

test('source scopes restore after nesting, exceptions and an asynchronous yield', async () => {
  const fs = new MemoryFileSystem(), outer = {}, inner = {};
  const observer = fs.observeMutations();
  try {
    fs.withMutationSource(outer, () => {
      assert.throws(() => fs.withMutationSource(inner, () => { throw new Error('expected'); }));
      fs.writeFile('/workspace/outer', bytes('outer'));
    });
    assert.equal(observer.hasChangesOutside(new Set([outer])), false);
    await fs.withMutationSource(inner, async () => {
      fs.writeFile('/workspace/inner', bytes('inner'));
      await Promise.resolve();
      fs.writeFile('/workspace/unattributed', bytes('foreign after yield'));
    });
    assert.equal(observer.hasChangesOutside(new Set([outer, inner])), true);
    assert.equal(observer.hasChangesOutside(new Set([outer, inner, undefined])), false);
  } finally { observer.dispose(); }
});

test('timestamp, unlinked descriptor, package and snapshot mutations are accounted synchronously', () => {
  const fs = new MemoryFileSystem(), owner = {};
  fs.writeFile('/workspace/file', bytes('data'));
  const fd = fs.open('/workspace/file', { write: true });
  const observer = fs.observeMutations();
  try {
    fs.withMutationSource(owner, () => {
      fs.setTimes('/workspace/file', { mtimeMs: 1 });
      fs.unlink('/workspace/file');
      fs.write(fd, bytes('unlinked'));
      fs.mountReadonly('/opt/package', [{ path: 'asset', type: 'file', mode: 0o444, data: bytes('asset') }]);
    });
    assert.equal(observer.hasChangesOutside(new Set([owner])), false);
    fs.close(fd);
    const lease = fs.acquireSnapshot();
    lease.commit(lease.snapshot);
    assert.equal(observer.hasChangesOutside(new Set([owner])), true);
  } finally { observer.dispose(); }
});

test('observer and source budgets fail closed and release their retained sources', () => {
  const fs = new MemoryFileSystem(), observers = Array.from({ length: 64 }, () => fs.observeMutations());
  assert.throws(() => fs.observeMutations(), /observer limit/);
  const sources = Array.from({ length: 65 }, () => ({}));
  for (const source of sources) fs.withMutationSource(source, () => fs.writeFile('/workspace/output', bytes('x')));
  assert.equal(observers[0].hasChangesOutside(new Set(sources)), true);
  observers.forEach(observer => observer.dispose());
  const next = fs.observeMutations();
  assert.equal(next.hasChangesOutside(new Set()), false);
  next.dispose();
});
