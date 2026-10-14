import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const coreRoot = dirname(fileURLToPath(import.meta.resolve('@wasm-idle/core')));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><title>Workspace persistence contract</title><script type="importmap">{"imports":{"@wasm-idle/core":"/core/index.js"}}</script>');
      return;
    }
    const base = pathname.startsWith('/core/') ? coreRoot : root;
    const path = resolve(base, '.' + decodeURIComponent(pathname.startsWith('/core/') ? pathname.slice(5) : pathname));
    if (!['/dist/', '/core/', '/test/fixtures/'].some((prefix) => pathname.startsWith(prefix)) || relative(base, path).startsWith('..') || !(await stat(path)).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const initialize = async (target = page) => {
    await target.goto(origin);
    await target.evaluate(async () => {
      globalThis.persistence = await import('/dist/fs/persistence/index.js');
      globalThis.encode = (text) => new TextEncoder().encode(text);
      globalThis.decode = (bytes) => new TextDecoder().decode(bytes);
      globalThis.digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
      globalThis.blobDirectory = async (id) => {
        const root = await navigator.storage.getDirectory();
        return (await root.getDirectoryHandle('wasm-idle-workspaces-v1')).getDirectoryHandle(id);
      };
      globalThis.corruptBlob = async (id, content) => {
        const directory = await blobDirectory(id);
        const handle = await directory.getFileHandle(await digest(encode(content)));
        const writer = await handle.createWritable(); await writer.write('corrupt'); await writer.close();
      };
    });
  };
  await initialize();
  const checks = [];

  const initial = await page.evaluate(async () => {
    const owner = globalThis.owner = await persistence.openPersistentWorkspace({ id: 'roundtrip' });
    owner.fs.mkdir('/workspace/한 글');
    owner.fs.writeFile('/workspace/한 글/source', new Uint8Array([0, 255, 13, 10, 128]));
    const inode = owner.fs.stat('/workspace/한 글/source').inode;
    owner.fs.rename('/workspace/한 글/source', '/workspace/한 글/result');
    owner.fs.symlink('result', '/workspace/한 글/link');
    owner.fs.writeFile('/tmp/transient', encode('temporary'));
    owner.fs.mountReadonly('/opt/toolchains/fixture', [{ path: 'tool', type: 'file', mode: 0o555, data: encode('tool') }]);
    const flushed = await owner.flush();
    return { inode, timestamps: owner.fs.stat('/workspace/한 글/result'), flushed, snapshot: owner.exportSnapshot(), secure: isSecureContext, userAgent: navigator.userAgent };
  });
  assert.equal(initial.secure, true); assert.equal(initial.flushed.state, 'saved');
  assert.equal(initial.snapshot.entries.some((e) => e.path === '/tmp/transient' || e.path.startsWith('/opt/toolchains/fixture')), false);
  const second = await context.newPage(); await initialize(second);
  assert.equal(await second.evaluate(async () => {
    try { await persistence.openPersistentWorkspace({ id: 'roundtrip' }); return 'admitted'; }
    catch (error) { return error.code; }
  }), 'BUSY');
  checks.push('PERSIST-04: second tab cannot acquire the writer lock');
  await page.reload(); await initialize();
  const restored = await page.evaluate(async () => {
    const owner = globalThis.owner = await persistence.openPersistentWorkspace({ id: 'roundtrip' });
    let tmp, tool;
    try { owner.fs.stat('/tmp/transient'); tmp = true; } catch { tmp = false; }
    try { owner.fs.stat('/opt/toolchains/fixture'); tool = true; } catch { tool = false; }
    return {
      bytes: Array.from(owner.fs.readFile('/workspace/한 글/link')),
      inode: owner.fs.stat('/workspace/한 글/result').inode, link: owner.fs.readlink('/workspace/한 글/link'),
      timestamps: owner.fs.stat('/workspace/한 글/result'),
      inspection: owner.inspect(), tmp, tool
    };
  });
  assert.deepEqual(restored.bytes, [0, 255, 13, 10, 128]); assert.equal(restored.inode, initial.inode);
  assert.deepEqual(restored.timestamps, initial.timestamps);
  assert.equal(restored.link, 'result'); assert.equal(restored.tmp, false); assert.equal(restored.tool, false);
  assert.equal(restored.inspection.state, 'saved');
  checks.push('PERSIST-01: reload restores binary data, symlinks, renamed inode IDs and only user files');

  await page.evaluate(async () => {
    await (await caches.open('runtime-asset-test')).put('/asset', new Response('asset'));
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
    owner.fs.writeFile('/workspace/unsaved', encode('export me'));
    const snapshot = owner.exportSnapshot();
    if (!snapshot.entries.some((entry) => entry.path === '/workspace/unsaved')) throw new Error('Export omitted unsaved content');
    await owner.dispose(); await owner.dispose();
    owner = await persistence.openPersistentWorkspace({ id: 'roundtrip' });
  });
  const cacheAndDispose = await page.evaluate(() => {
    let unsaved;
    try { owner.fs.stat('/workspace/unsaved'); unsaved = true; } catch { unsaved = false; }
    return { unsaved, bytes: Array.from(owner.fs.readFile('/workspace/한 글/result')) };
  });
  assert.equal(cacheAndDispose.unsaved, false); assert.deepEqual(cacheAndDispose.bytes, [0, 255, 13, 10, 128]);
  checks.push('PERSIST-03: CacheStorage deletion preserves workspace; dispose does not save dirty files');

  await page.evaluate(async () => {
    await owner.dispose();
    globalThis.stopAt = undefined;
    owner = await persistence.openPersistentWorkspace({ id: 'interrupted', fault: (point) => {
      if (point === stopAt) { globalThis.paused = true; return new Promise(() => {}); }
    } });
    owner.fs.writeFile('/workspace/file', encode('committed')); await owner.flush();
    owner.fs.writeFile('/workspace/file', encode('orphan'));
    stopAt = 'after-blob-write'; globalThis.paused = false;
    void owner.flush();
  });
  await page.waitForFunction(() => globalThis.paused === true);
  const orphanBefore = await page.evaluate(async () => {
    const directory = await blobDirectory('interrupted');
    const handle = await directory.getFileHandle(await digest(encode('orphan')));
    return (await handle.getFile()).size;
  });
  assert.equal(orphanBefore, 6);
  await page.reload(); await initialize();
  const interruption = await page.evaluate(async () => {
    owner = await persistence.openPersistentWorkspace({ id: 'interrupted' });
    const directory = await blobDirectory('interrupted');
    const orphan = await directory.getFileHandle(await digest(encode('orphan')));
    return { text: decode(owner.fs.readFile('/workspace/file')), orphan: (await orphan.getFile()).size, state: owner.inspect().state };
  });
  assert.deepEqual(interruption, { text: 'committed', orphan: 6, state: 'saved' });
  checks.push('PERSIST-02: real page reload after blob close preserves previous root and leaves an unreferenced blob');

  const recovery = await page.evaluate(async () => {
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'recovery' });
    owner.fs.writeFile('/workspace/file', encode('version-one')); await owner.flush();
    owner.fs.writeFile('/workspace/file', encode('version-two')); await owner.flush(); await owner.dispose();
    await corruptBlob('recovery', 'version-two');
    owner = await persistence.openPersistentWorkspace({ id: 'recovery' });
    return { text: decode(owner.fs.readFile('/workspace/file')), inspection: owner.inspect() };
  });
  assert.equal(recovery.text, 'version-one'); assert.equal(recovery.inspection.recovered, true);
  assert.equal(recovery.inspection.state, 'recovered'); assert.equal(recovery.inspection.committedSequence, 1);
  checks.push('PERSIST-02: a corrupt newest blob falls back to the previous verified committed root');

  const afterPublish = await page.evaluate(async () => {
    await owner.dispose();
    owner = await persistence.openPersistentWorkspace({ id: 'recovery', fault(point) { if (point === 'after-root-publish') throw new Error('injected post-commit interruption'); } });
    owner.fs.writeFile('/workspace/file', encode('version-three'));
    let code;
    try { await owner.flush(); } catch (error) { code = error.code; }
    const failed = owner.inspect();
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'recovery' });
    return { code, failed, text: decode(owner.fs.readFile('/workspace/file')), current: owner.inspect() };
  });
  assert.equal(afterPublish.code, 'STORAGE'); assert.equal(afterPublish.failed.dirty, false);
  assert.equal(afterPublish.failed.state, 'error'); assert.equal(afterPublish.text, 'version-three');
  assert.equal(afterPublish.current.committedSequence, 3);
  checks.push('PERSIST-02: post-publication fault reports failure and the already committed generation honestly');

  const racingEdit = await page.evaluate(async () => {
    await owner.dispose();
    let unblock;
    const gate = new Promise((resolve) => { unblock = resolve; });
    let entered;
    const reached = new Promise((resolve) => { entered = resolve; });
    owner = await persistence.openPersistentWorkspace({ id: 'racing-edit', fault: async (point) => {
      if (point === 'before-root-publish') { entered(); await gate; }
    } });
    owner.fs.writeFile('/workspace/file', encode('snapshot'));
    const pending = owner.flush(); await reached;
    const state = owner.inspect().state;
    owner.fs.writeFile('/workspace/file', encode('new edit'));
    let conflict;
    try { await owner.flush(); } catch (error) { conflict = error.code; }
    unblock(); const first = await pending;
    const second = await owner.flush();
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'racing-edit' });
    return { state, conflict, first, second, text: decode(owner.fs.readFile('/workspace/file')) };
  });
  assert.equal(racingEdit.state, 'saving'); assert.equal(racingEdit.conflict, 'BUSY');
  assert.equal(racingEdit.first.dirty, true); assert.equal(racingEdit.second.state, 'saved');
  assert.equal(racingEdit.text, 'new edit');
  checks.push('PERSIST-01: edits during flush remain dirty and concurrent publication is explicitly rejected');

  const budget = await page.evaluate(async () => {
    await owner.dispose();
    owner = await persistence.openPersistentWorkspace({ id: 'metadata-budget', maxMetadataBytes: 1024 });
    owner.fs.writeFile('/workspace/file', encode('baseline')); await owner.flush();
    for (let i = 0; i < 10; i++) owner.fs.writeFile(`/workspace/additional-file-${i}`, encode('new'));
    let code;
    try { await owner.flush(); } catch (error) { code = error.code; }
    const memoryFiles = owner.fs.readdir('/workspace').length;
    const failed = owner.inspect();
    const { createWorkspaceBackup } = await import('/dist/workspace/index.js');
    globalThis.unsavedBackup = await createWorkspaceBackup(owner.fs);
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'metadata-budget', maxMetadataBytes: 1024 });
    return { code, failed, memoryFiles, storedFiles: owner.fs.readdir('/workspace'), text: decode(owner.fs.readFile('/workspace/file')) };
  });
  assert.equal(budget.code, 'STORAGE'); assert.equal(budget.failed.dirty, true);
  assert.equal(budget.memoryFiles, 11); assert.deepEqual(budget.storedFiles, ['file']); assert.equal(budget.text, 'baseline');
  checks.push('PERSIST-02: metadata budget failure preserves the previous root and unsaved in-memory files');

  const imported = await page.evaluate(async () => {
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'backup-restore' });
    const { createWorkspaceBackup, restoreWorkspaceBackup } = await import('/dist/workspace/index.js');
    owner.fs.writeFile('previous', encode('previous')); await owner.flush();
    owner.fs.writeFile('/tmp/keep', encode('temporary'));
    await (await caches.open('independent-runtime-cache')).put('/asset', new Response('verified asset'));
    const before = owner.inspect().committedSequence;
    const restored = await restoreWorkspaceBackup(owner.fs, unsavedBackup, { replace: true });
    const dirty = owner.inspect();
    const corrupt = unsavedBackup.slice(); corrupt[corrupt.length - 33] ^= 1;
    let rejected;
    try { await restoreWorkspaceBackup(owner.fs, corrupt, { replace: true }); } catch (error) { rejected = error.code; }
    const preserved = owner.fs.readdir('/workspace').length;
    const cache = await (await (await caches.open('independent-runtime-cache')).match('/asset')).text();
    const temporary = decode(owner.fs.readFile('/tmp/keep'));
    await owner.flush(); await owner.dispose();
    const exportAfterDispose = (await createWorkspaceBackup(owner.fs)).length;
    owner = await persistence.openPersistentWorkspace({ id: 'backup-restore' });
    return { before, restored, dirty, rejected, preserved, cache, temporary, exportAfterDispose, files: owner.fs.readdir('/workspace'), baseline: decode(owner.fs.readFile('file')) };
  });
  assert.equal(imported.dirty.dirty, true); assert.equal(imported.dirty.committedSequence, imported.before);
  assert.equal(imported.restored.entries, 12); assert.equal(imported.rejected, 'INTEGRITY'); assert.equal(imported.preserved, 11);
  assert.equal(imported.cache, 'verified asset'); assert.equal(imported.temporary, 'temporary');
  assert.ok(imported.exportAfterDispose > 44); assert.equal(imported.files.length, 11); assert.equal(imported.baseline, 'baseline');
  checks.push('C18: failed-save backup restores all unsaved files, stays dirty until flush, and leaves runtime cache/tmp intact');
  checks.push('C18: corrupt backup cannot replace files; explicit flush/reopen retains the complete restored workspace');

  const saveBinding = await page.evaluate(async () => {
    await owner.dispose(); let fail = false, attempts = 0;
    owner = await persistence.openPersistentWorkspace({ id: 'save-binding', fault(point) {
      if (point === 'before-root-publish') { attempts++; if (fail) throw new Error('injected storage failure'); }
    } });
    const { createWorkspaceSaveController } = await import('/dist/workspace/index.js');
    const binding = createWorkspaceSaveController(owner, { delayMs: 20, maxWaitMs: 100 }), reader = binding.updates.getReader();
    const until = async predicate => { for (;;) { const { value, done } = await reader.read(); if (done) throw new Error('Save stream ended early'); if (predicate(value)) return value; } };
    owner.fs.writeFile('a', encode('manual')); await new Promise(resolve => setTimeout(resolve, 40));
    const initial = binding.inspect();
    await binding.save(); const manual = owner.inspect();
    binding.setAutosave(true); owner.fs.writeFile('a', encode('automatic'));
    const automatic = await until(value => value.workspace.state === 'saved' && value.workspace.generation === owner.fs.generation);
    fail = true; owner.fs.writeFile('a', encode('unsaved after failure'));
    const failure = await until(value => value.pausedAfterError), failedAttempts = attempts;
    owner.fs.writeFile('b', encode('still unsaved')); await new Promise(resolve => setTimeout(resolve, 60));
    const didNotRetry = attempts === failedAttempts;
    fail = false; await binding.save(); const recovered = binding.inspect();
    owner.fs.writeFile('unflushed', encode('keep only in memory')); await binding.dispose(); reader.releaseLock();
    const retained = { state: owner.inspect().state, watchers: owner.fs.watcherCount, file: decode(owner.fs.readFile('unflushed')) };
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'save-binding' });
    const restored = { a: decode(owner.fs.readFile('a')), b: decode(owner.fs.readFile('b')), files: owner.fs.readdir('/workspace') };
    return { initial, manual, automatic, failure, didNotRetry, recovered, retained, restored, attempts };
  });
  assert.equal(saveBinding.initial.workspace.committedGeneration, null); assert.equal(saveBinding.initial.autosave, false);
  assert.equal(saveBinding.manual.state, 'saved'); assert.equal(saveBinding.automatic.workspace.dirty, false);
  assert.equal(saveBinding.failure.workspace.state, 'error'); assert.equal(saveBinding.failure.workspace.dirty, true); assert.equal(saveBinding.didNotRetry, true);
  assert.equal(saveBinding.recovered.workspace.state, 'saved'); assert.equal(saveBinding.recovered.pausedAfterError, false);
  assert.deepEqual(saveBinding.retained, { state: 'dirty', watchers: 0, file: 'keep only in memory' });
  assert.deepEqual(saveBinding.restored, { a: 'unsaved after failure', b: 'still unsaved', files: ['a', 'b'] }); assert.equal(saveBinding.attempts, 4);
  checks.push('C18: manual save is default; opt-in autosave commits real OPFS/IDB changes and pauses on storage failure');
  checks.push('C18: retry saves retained data; binding disposal releases watchers without flushing or disposing the owner');

  const integration = await page.evaluate(async () => {
    await owner.dispose();
    owner = await persistence.openPersistentWorkspace({ id: 'container-lifecycle', maxBytes: 1024 });
    const { createContainer } = await import('/dist/index.js');
    const { createWasiAdapter } = await import('/dist/adapters/wasi/index.js');
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/command.wasm')).arrayBuffer());
    let mismatch;
    try { createContainer({ workspace: owner, maxBytes: 2048 }); } catch (error) { mismatch = error.code; }
    const container = createContainer({ workspace: owner, adapters: [createWasiAdapter()], commands: { tool: { adapter: 'wasi-preview1', bytes } } });
    const result = await container.run('tool', ['exit']);
    const dirty = await container.inspect(); await container.flush(); const saved = await container.inspect();
    await container.dispose();
    const data = decode(container.fs.readFile('/workspace/partial'));
    let locked;
    try { await persistence.openPersistentWorkspace({ id: 'container-lifecycle' }); } catch (error) { locked = error.code; }
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'container-lifecycle', maxBytes: 1024 });
    return { mismatch, result: result.code, dirty: dirty.workspace.state, saved: saved.workspace.state, profile: saved.persistence, quota: saved.limits.maxWorkspaceBytes, data, locked, restored: decode(owner.fs.readFile('/workspace/partial')) };
  });
  assert.deepEqual(integration, { mismatch: 'INVALID_ARGUMENT', result: 23, dirty: 'new', saved: 'saved', profile: 'opfs', quota: 1024, data: 'saved', locked: 'BUSY', restored: 'saved' });
  checks.push('PERSIST-01: container guest writes, explicit flush, quotas and owner lifetime compose with persistence');

  const irrecoverable = await page.evaluate(async () => {
    await owner.dispose();
    await corruptBlob('recovery', 'version-one'); await corruptBlob('recovery', 'version-three');
    let first, second;
    try { await persistence.openPersistentWorkspace({ id: 'recovery' }); } catch (error) { first = error.code; }
    try { await persistence.openPersistentWorkspace({ id: 'recovery' }); } catch (error) { second = error.code; }
    const directory = await blobDirectory('recovery');
    return { first, second, preserved: (await (await directory.getFileHandle(await digest(encode('version-three')))).getFile()).size };
  });
  assert.deepEqual(irrecoverable, { first: 'CORRUPT', second: 'CORRUPT', preserved: 7 });
  checks.push('PERSIST-02: unrecoverable storage is preserved, fails explicitly, and releases ownership');
  assert.deepEqual(pageErrors, []);
  const implementation = await readFile(resolve(root, 'dist/fs/persistence/index.js'));
  const evidence = {
    schemaVersion: 1, browser: await browser.version(), platform: process.platform,
    applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    userAgent: initial.userAgent, secureContext: initial.secure, isolatedProfileRequired: false,
    implementationSha256: createHash('sha256').update(implementation).digest('hex'),
    backupImplementationSha256: createHash('sha256').update(await readFile(resolve(root, 'dist/workspace/backup.js'))).digest('hex'),
    saveBindingImplementationSha256: createHash('sha256').update(await readFile(resolve(root, 'dist/workspace/save.js'))).digest('hex'),
    filesystemImplementationSha256: createHash('sha256').update(await readFile(resolve(root, 'dist/fs/memory.js'))).digest('hex'),
    results: checks, fixtureCount: checks.length
  };
  if (process.env.CONTAINER_PERSISTENCE_EVIDENCE) {
    const destination = resolve(process.env.CONTAINER_PERSISTENCE_EVIDENCE);
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
}
