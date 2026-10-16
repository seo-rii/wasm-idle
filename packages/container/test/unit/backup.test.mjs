import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { createWorkspaceBackup, restoreWorkspaceBackup, openWorkspaceEditor } from '../../dist/workspace/index.js';
const bytes = text => new TextEncoder().encode(text), text = bytes => new TextDecoder().decode(bytes);

async function changeArchive(archive, change, extra = new Uint8Array()) {
  const length = new DataView(archive.buffer, archive.byteOffset).getUint32(8, true);
  const value = JSON.parse(text(archive.subarray(12, 12 + length))); change(value);
  const metadata = bytes(JSON.stringify(value)), body = archive.subarray(12 + length, archive.length - 32);
  const result = new Uint8Array(12 + metadata.length + body.length + extra.length + 32);
  result.set(bytes('WIDLEWS1')); new DataView(result.buffer).setUint32(8, metadata.length, true); result.set(metadata, 12);
  result.set(body, 12 + metadata.length); result.set(extra, 12 + metadata.length + body.length);
  result.set(new Uint8Array(await crypto.subtle.digest('SHA-256', result.subarray(0, -32))), result.length - 32); return result;
}
test('backup restores binary, UTF-8 names, backslashes and inert symlinks, excluding cache and temporary mounts', async () => {
  const source = new MemoryFileSystem(); source.mkdir('src'); source.writeFile('src/한 글\\file', new Uint8Array([0, 255, 128, 10]));
  source.symlink('src/한 글\\file', 'alias'); source.writeFile('/tmp/scratch', bytes('temporary'));
  source.mountReadonly('/opt/toolchains/example', [{ path: 'compiler', type: 'file', mode: 0o444, data: bytes('secret-toolchain-bytes') }]);
  const info = source.stat('src/한 글\\file'), generation = source.generation;
  const archive = await createWorkspaceBackup(source);
  assert.equal(text(archive).includes('secret-toolchain-bytes'), false); assert.equal(text(archive).includes('/tmp/scratch'), false);
  const target = new MemoryFileSystem(); target.writeFile('old', bytes('old')); target.writeFile('/tmp/keep', bytes('keep'));
  target.mountReadonly('/opt/toolchains/existing', [{ path: 'data', type: 'file', mode: 0o444, data: bytes('keep') }]);
  const previousInode = target.stat('old').inode, packageInode = target.stat('/opt/toolchains/existing/data').inode;
  const reader = target.watch().getReader();
  const restored = await restoreWorkspaceBackup(target, archive, { replace: true });
  assert.equal(restored.sourceGeneration, generation); assert.equal(restored.entries, 4);
  assert.deepEqual(target.readFile('alias'), new Uint8Array([0, 255, 128, 10]));
  assert.ok(target.stat('src/한 글\\file').inode > previousInode); assert.equal(target.stat('src/한 글\\file').mtimeMs, info.mtimeMs);
  assert.equal(target.readlink('alias'), 'src/한 글\\file'); assert.throws(() => target.stat('old'), { code: 'ENOENT' });
  assert.equal(text(target.readFile('/tmp/keep')), 'keep'); assert.equal(target.stat('/opt/toolchains/existing/data').inode, packageInode);
  assert.deepEqual((await reader.read()).value, { kind: 'rescan', path: '/workspace', generation: target.generation }); await reader.cancel();
});
test('backup captures one owned revision before async hashing and restore snapshots the caller bytes', async () => {
  const source = new MemoryFileSystem(); source.writeFile('a', bytes('old'));
  const creating = createWorkspaceBackup(source); source.writeFile('a', bytes('new')); const archive = await creating;
  const target = new MemoryFileSystem(), restoring = restoreWorkspaceBackup(target, archive, { replace: true }); archive.fill(0); await restoring;
  assert.equal(text(target.readFile('a')), 'old');
});
test('restore owns Node Buffer input even when the caller mutates its slice-backed memory', async () => {
  const source = new MemoryFileSystem(); source.writeFile('a', bytes('old'));
  const archive = Buffer.from(await createWorkspaceBackup(source)), target = new MemoryFileSystem();
  const restoring = restoreWorkspaceBackup(target, archive, { replace: true }); archive.fill(0); await restoring;
  assert.equal(text(target.readFile('a')), 'old');
});
test('checksum and encoded limits reject corrupt data without altering published files', async () => {
  const fs = new MemoryFileSystem(); fs.writeFile('a', bytes('current')); const original = await createWorkspaceBackup(fs), generation = fs.generation;
  const corrupt = original.slice(); corrupt[corrupt.length - 33] ^= 1;
  await assert.rejects(restoreWorkspaceBackup(fs, corrupt, { replace: true }), { code: 'INTEGRITY' });
  await assert.rejects(restoreWorkspaceBackup(fs, original.subarray(0, 40), { replace: true }), { code: 'INVALID_ARCHIVE' });
  await assert.rejects(restoreWorkspaceBackup(fs, original, {}), { code: 'INVALID_ARCHIVE' });
  await assert.rejects(restoreWorkspaceBackup(fs, original, { replace: true, maxArchiveBytes: 44 }), { code: 'LIMIT' });
  await assert.rejects(createWorkspaceBackup(fs, { maxMetadataBytes: 1 }), { code: 'LIMIT' });
  assert.equal(fs.generation, generation); assert.equal(text(fs.readFile('a')), 'current');
});
test('valid-checksum hostile archives cannot escape, overlap, duplicate or publish partial trees', async () => {
  const fs = new MemoryFileSystem(); fs.writeFile('a', bytes('current')); const archive = await createWorkspaceBackup(fs), generation = fs.generation;
  const edits = [
    value => { value.entries[1].path = '/workspace/../tmp/escape'; },
    value => { value.entries[1].path = '/usr/bin/replace'; },
    value => { value.entries.push({ ...value.entries[1] }); },
    value => { value.entries[1].offset = 1; },
    value => { value.entries[1].bytes = Number.MAX_SAFE_INTEGER; },
    value => { value.entries[1].path = '/workspace/a/child'; },
    value => { value.entries[1].path = '/workspace/\ud800'; },
    value => { value.entries[1].mode = 0o1777; },
    value => { value.entries[1].mtimeMs = -1; },
    value => { value.entries[1].mtimeMs = 1.5; },
    value => { value.entries.push({ path: '/workspace/empty-link', type: 'symlink', mode: 0o777, mtimeMs: 0, ctimeMs: 0, target: '' }); },
    value => { value.schemaVersion = 2; }
  ];
  for (const edit of edits) {
    // A checksum-valid but structurally invalid archive has one error contract.
    await assert.rejects(restoreWorkspaceBackup(fs, await changeArchive(archive, edit), { replace: true }), { name: 'WorkspaceBackupError', code: 'INVALID_ARCHIVE' });
    assert.equal(fs.generation, generation); assert.equal(text(fs.readFile('a')), 'current');
  }
  await assert.rejects(restoreWorkspaceBackup(fs, await changeArchive(archive, () => {}, new Uint8Array([1])), { replace: true }), { code: 'INVALID_ARCHIVE' });
});
test('restore enforces target quotas and writer ownership before one atomic replacement', async () => {
  const source = new MemoryFileSystem(); source.writeFile('new', bytes('ten bytes!')); const archive = await createWorkspaceBackup(source);
  const small = new MemoryFileSystem({ maxBytes: 3 }); small.writeFile('old', bytes('old'));
  await assert.rejects(restoreWorkspaceBackup(small, archive, { replace: true }), { code: 'ENOSPC' }); assert.equal(text(small.readFile('old')), 'old');
  const target = new MemoryFileSystem(); target.writeFile('old', bytes('old')); const editor = openWorkspaceEditor(target, 'old'); editor.edit(bytes('unsaved'));
  const live = target.acquireLive(); await assert.rejects(restoreWorkspaceBackup(target, archive, { replace: true }), { code: 'EBUSY' }); live.release();
  const lease = target.acquireSnapshot(); await assert.rejects(restoreWorkspaceBackup(target, archive, { replace: true }), { code: 'EBUSY' }); lease.discard();
  assert.equal(text(target.readFile('old')), 'old');
  await restoreWorkspaceBackup(target, archive, { replace: true });
  assert.throws(() => editor.publish(), { code: 'ECONFLICT' }); assert.equal(text(editor.read()), 'unsaved'); editor.dispose();
});
test('inert symlink records never redirect restoration writes through existing or imported links', async () => {
  const source = new MemoryFileSystem(); source.symlink('/tmp/target', 'link'); source.writeFile('a', bytes('safe'));
  const target = new MemoryFileSystem(); target.writeFile('/tmp/target', bytes('untouched')); target.symlink('/tmp', 'a');
  await restoreWorkspaceBackup(target, await createWorkspaceBackup(source), { replace: true });
  assert.equal(text(target.readFile('/tmp/target')), 'untouched'); assert.equal(text(target.readFile('a')), 'safe');
  assert.throws(() => target.readFile('link', { root: '/workspace' }), { code: 'EACCES' });
});
