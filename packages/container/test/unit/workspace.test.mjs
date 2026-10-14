import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { openWorkspaceEditor } from '../../dist/workspace/index.js';
const bytes = text => new TextEncoder().encode(text), text = bytes => new TextDecoder().decode(bytes);

test('watch reports published create/write/rename/remove paths with inode and generations', async () => {
  const fs = new MemoryFileSystem(), reader = fs.watch().getReader();
  fs.writeFile('a', bytes('one')); const created = (await reader.read()).value;
  assert.deepEqual(created, { kind: 'create', path: '/workspace/a', inode: fs.stat('a').inode, generation: fs.generation });
  fs.writeFile('a', bytes('two')); const modified = (await reader.read()).value;
  assert.equal(modified.kind, 'modify'); assert.equal(modified.generation, fs.generation);
  fs.rename('a', 'b'); const renamed = (await reader.read()).value;
  assert.equal(renamed.kind, 'rename'); assert.equal(renamed.path, '/workspace/b'); assert.equal(renamed.previousPath, '/workspace/a');
  assert.equal(renamed.inode, created.inode);
  fs.unlink('b'); assert.equal((await reader.read()).value.kind, 'remove');
  await reader.cancel(); assert.equal(fs.watcherCount, 0);
});
test('slow watcher coalesces overflow into latest rescan, then resumes exact changes', async () => {
  const fs = new MemoryFileSystem(), reader = fs.watch({ maxQueuedEvents: 2 }).getReader();
  for (let i = 0; i < 1000; i++) fs.writeFile('same', bytes(String(i)));
  assert.deepEqual((await reader.read()).value, { kind: 'rescan', path: '/workspace', generation: fs.generation });
  fs.writeFile('next', bytes('next')); assert.equal((await reader.read()).value.kind, 'create');
  await reader.cancel();
});
test('scope filters, inode descriptor writes and snapshot publication invalidate the right view', async () => {
  const fs = new MemoryFileSystem(), temporary = fs.watch({ path: '/tmp' }).getReader(), project = fs.watch().getReader();
  fs.writeFile('/workspace/a', bytes('one')); await project.read();
  fs.writeFile('/tmp/a', bytes('temp')); assert.equal((await temporary.read()).value.path, '/tmp/a');
  const fd = fs.open('a', { write: true }); fs.rename('a', 'b'); await project.read();
  fs.write(fd, bytes('changed')); const update = (await project.read()).value;
  assert.equal(update.path, '/workspace/b'); assert.equal(update.generation, fs.generation);
  fs.close(fd);
  const lease = fs.acquireSnapshot(), privateFs = MemoryFileSystem.fromSnapshot(lease.snapshot);
  privateFs.writeFile('generated', bytes('guest')); lease.commit(privateFs.exportSnapshot());
  assert.deepEqual((await project.read()).value, { kind: 'rescan', path: '/workspace', generation: fs.generation });
  await project.cancel(); await temporary.cancel();
});
test('watch abort wakes a pending reader, releases ownership, and enforces subscriber limits', async () => {
  const fs = new MemoryFileSystem(), abort = new AbortController(), reader = fs.watch({ signal: abort.signal }).getReader();
  const pending = reader.read(); abort.abort(); assert.equal((await pending).done, true); assert.equal(fs.watcherCount, 0);
  const closed = fs.watch({ signal: abort.signal }).getReader(); assert.equal((await closed.read()).done, true);
  assert.equal(fs.watcherCount, 0);
  const watchers = Array.from({ length: 64 }, () => fs.watch());
  assert.throws(() => fs.watch(), { code: 'ENOSPC' }); await Promise.all(watchers.map(w => w.cancel()));
  assert.equal(fs.watcherCount, 0); assert.throws(() => fs.watch({ maxQueuedEvents: 0 }), { code: 'EINVAL' });
});
test('editor staged bytes remain separate until publish; unrelated workspace updates are preserved', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('main.c', bytes('old'));
  const editor = openWorkspaceEditor(fs, 'main.c'), initial = editor.inspect().baseGeneration;
  const change = bytes('new'); editor.edit(change); change.fill(0);
  assert.equal(text(fs.readFile('main.c')), 'old'); assert.equal(text(editor.read()), 'new');
  fs.writeFile('other.c', bytes('other'));
  const published = editor.publish(); assert.ok(published.generation > initial);
  assert.equal(text(fs.readFile('main.c')), 'new'); assert.equal(text(fs.readFile('other.c')), 'other');
  assert.equal(editor.inspect().state, 'clean'); assert.equal(editor.inspect().baseGeneration, published.generation);
  const output = editor.read(); output.fill(0); assert.equal(text(editor.read()), 'new');
  editor.dispose(); editor.dispose(); assert.throws(() => editor.edit(bytes('x')), { code: 'EBADF' });
});
test('editor never overwrites externally changed or replaced content and reload requires explicit discard', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('main.c', bytes('old'));
  const editor = openWorkspaceEditor(fs, 'main.c'); editor.edit(bytes('local'));
  fs.writeFile('main.c', bytes('external'));
  assert.throws(() => editor.publish(), { code: 'ECONFLICT' }); assert.equal(editor.inspect().state, 'conflict');
  assert.equal(text(editor.read()), 'local'); assert.equal(text(fs.readFile('main.c')), 'external');
  assert.throws(() => editor.reload(), { code: 'ECONFLICT' }); editor.reload({ discardChanges: true });
  assert.equal(text(editor.read()), 'external');
  editor.edit(bytes('again')); fs.unlink('main.c'); fs.writeFile('main.c', bytes('external'));
  assert.throws(() => editor.publish(), { code: 'ECONFLICT' }); assert.equal(text(editor.read()), 'again');
  editor.dispose();
});
test('snapshot writer lease protects editor publication and a committed guest change becomes a conflict', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('main.c', bytes('old'));
  const editor = openWorkspaceEditor(fs, 'main.c'); editor.edit(bytes('local'));
  const lease = fs.acquireSnapshot();
  assert.throws(() => editor.publish(), { code: 'EBUSY' }); assert.equal(text(editor.read()), 'local');
  const guest = MemoryFileSystem.fromSnapshot(lease.snapshot); guest.writeFile('main.c', bytes('guest')); lease.commit(guest.exportSnapshot());
  assert.throws(() => editor.publish(), { code: 'ECONFLICT' }); assert.equal(text(fs.readFile('main.c')), 'guest');
  editor.dispose();
});
test('editor limits and workspace capability apply before reading or publishing files', () => {
  const fs = new MemoryFileSystem(); fs.writeFile('main.c', bytes('old')); fs.writeFile('/tmp/secret', bytes('temp'));
  fs.symlink('/tmp/secret', 'outside');
  assert.throws(() => openWorkspaceEditor(fs, 'outside'), { code: 'EACCES' });
  assert.throws(() => openWorkspaceEditor(fs, 'main.c', { maxFileBytes: 2 }), { code: 'ENOSPC' });
  const editor = openWorkspaceEditor(fs, 'main.c', { maxFileBytes: 3 });
  assert.throws(() => editor.edit(bytes('four')), { code: 'ENOSPC' }); assert.equal(text(editor.read()), 'old'); editor.dispose();
});
