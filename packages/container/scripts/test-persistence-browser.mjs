import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><title>Workspace persistence contract</title>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!pathname.startsWith('/dist/') || relative(root, path).startsWith('..') || !(await stat(path)).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(path));
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
    return { inode, flushed, snapshot: owner.exportSnapshot(), secure: isSecureContext, userAgent: navigator.userAgent };
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
      inspection: owner.inspect(), tmp, tool
    };
  });
  assert.deepEqual(restored.bytes, [0, 255, 13, 10, 128]); assert.equal(restored.inode, initial.inode);
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
    await owner.dispose(); owner = await persistence.openPersistentWorkspace({ id: 'metadata-budget', maxMetadataBytes: 1024 });
    return { code, failed, memoryFiles, storedFiles: owner.fs.readdir('/workspace'), text: decode(owner.fs.readFile('/workspace/file')) };
  });
  assert.equal(budget.code, 'STORAGE'); assert.equal(budget.failed.dirty, true);
  assert.equal(budget.memoryFiles, 11); assert.deepEqual(budget.storedFiles, ['file']); assert.equal(budget.text, 'baseline');
  checks.push('PERSIST-02: metadata budget failure preserves the previous root and unsaved in-memory files');

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
    userAgent: initial.userAgent, secureContext: initial.secure, isolatedProfileRequired: false,
    implementationSha256: createHash('sha256').update(implementation).digest('hex'),
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
