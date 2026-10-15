import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, platform, release } from 'node:os';
import { chromium } from 'playwright-core';
import { createExampleServer, EXAMPLE_CSP } from '../../../examples/container/serve.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.CONTAINER_PRODUCT_TEST_OUTPUT;
if (!output) throw new Error('Set CONTAINER_PRODUCT_TEST_OUTPUT to a new evidence directory; checked-in receipts are not overwritten');
await mkdir(output, { recursive: true, mode: 0o700 });
const applicationCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const example = await createExampleServer({ ownerEntry: resolve(root, 'packages/container/test/fixtures/product-owner.mjs') });
const harnessSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true }), page = await context.newPage();
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/iu.test(message.text())) errors.push(message.text()); });
  page.on('dialog', dialog => { void dialog.accept(); });
  const url = `${example.origin}/?workspace=product-ui-test`;
  const ready = async target => {
    await target.waitForSelector('#editor:not([disabled])');
    await target.evaluate(async () => { await (await import('/main.mjs')).application; });
  };
  const current = () => page.evaluate(async () => (await (await import('/main.mjs')).application).client.inspect());
  const read = path => page.evaluate(async path => Array.from((await (await (await import('/main.mjs')).application).client.fs.readFile(path)).bytes), path);
  const publish = async text => {
    await page.locator('#editor').fill(text); await page.locator('#publish').click();
    await page.waitForFunction(() => document.querySelector('#editor-status').textContent.startsWith('Published revision'));
  };
  const save = async () => { await page.locator('#save').click(); await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('saved')); };
  const bodyRequests = () => example.requests.filter(path => path.startsWith('/assets/')).length;
  const response = await page.goto(url); await ready(page);
  assert.equal(response.headers()['content-security-policy'], EXAMPLE_CSP);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  assert.equal(bodyRequests(), 0);
  assert.match(await page.locator('#profile').textContent(), /WASI byte-guest fixture/u);
  assert.match(await page.locator('#editor').inputValue(), /#include <stdio.h>/u);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  checks.push('UI-01: real rendered owner opens isolated persistent workspace with zero guest-body downloads');

  await save(); const original = await read('/workspace/main.c');
  await page.locator('#editor').fill('unpublished editor text\n'); await save();
  assert.deepEqual(await read('/workspace/main.c'), original);
  assert.equal(await page.locator('#editor').inputValue(), 'unpublished editor text\n');
  await publish('published first revision\n'); await save();
  assert.equal(new TextDecoder().decode(Uint8Array.from(await read('/workspace/main.c'))), 'published first revision\n');
  checks.push('UI-02: save commits only published bytes; editor staging and published revision remain distinct');

  await page.locator('#editor').fill('preserve this conflicting buffer\n');
  await page.evaluate(async () => { const { client } = await (await import('/main.mjs')).application; await client.fs.writeFile('/workspace/main.c', new TextEncoder().encode('external live edit\n')); });
  await page.locator('#publish').click();
  await page.waitForFunction(() => document.querySelector('#editor-status').textContent.includes('ECONFLICT'));
  assert.equal(await page.locator('#editor').inputValue(), 'preserve this conflicting buffer\n');
  const [bufferDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#export-buffer').click()]);
  const bufferFile = resolve(output, 'exported-editor-buffer.txt'); await bufferDownload.saveAs(bufferFile);
  assert.equal(await readFile(bufferFile, 'utf8'), 'preserve this conflicting buffer\n');
  await page.locator('#reload').click();
  await page.waitForFunction(() => document.querySelector('#editor').value === 'external live edit\n');
  checks.push('UI-03: real concurrent owner edit reports conflict, preserves and exports the staged buffer, and requires explicit discard');

  await page.locator('#autosave').check();
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const channel = new BroadcastChannel('container-workbench-ui-test-faults'), id = crypto.randomUUID();
      const timer = setTimeout(() => { channel.close(); reject(new Error('Fault owner did not acknowledge')); }, 5000);
      channel.onmessage = event => { if (event.data?.acknowledged === id) { clearTimeout(timer); channel.close(); resolve(); } };
      channel.postMessage({ operation: 'fail-next-save', id });
    });
  });
  await publish('autosave failure must retain this file\n');
  await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('autosave paused'));
  const failed = await current(); assert.equal(failed.save.pausedAfterError, true); assert.equal(failed.workspace.lastError, 'STORAGE');
  assert.equal(new TextDecoder().decode(Uint8Array.from(await read('/workspace/main.c'))), 'autosave failure must retain this file\n');
  await save(); assert.equal((await current()).save.pausedAfterError, false);
  await page.locator('#autosave').uncheck();
  checks.push('UI-04: actual root-publication failure pauses autosave, exposes retry/export, preserves files and recovers through Save');

  await page.locator('#start').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
  assert.equal(bodyRequests(), 1);
  const input = '<img src=x onerror="globalThis.injected=true">\n한글\u0000' + 'z'.repeat(40000);
  await page.locator('#input').fill(input); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#stdout').textContent.endsWith('z'.repeat(1024)));
  assert.equal((await page.locator('#stdout').textContent()).length, 32768);
  assert.equal(await page.locator('#stdout img').count(), 0); assert.equal(await page.evaluate(() => globalThis.injected), undefined);
  assert.equal(await page.locator('#stderr').textContent(), '');
  await page.locator('#eof').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('exited; exit 0'));
  assert.deepEqual(await read('/workspace/input.bin'), Array.from(new TextEncoder().encode(input)));
  await save();
  checks.push('UI-05: real Wasm guest roundtrips UTF-8/NUL input to common workspace and stdout before EOF; rendering is bounded text with separate stderr');

  const [backupDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#backup').click()]);
  const backupFile = resolve(output, 'exported-published-workspace.json'); await backupDownload.saveAs(backupFile);
  const backupBytes = await readFile(backupFile);
  const backupDirect = await page.evaluate(async () => Array.from(await (await (await import('/main.mjs')).application).client.backup()));
  assert.deepEqual(Array.from(backupBytes), backupDirect);
  await publish('replace this newer published version\n');
  await page.locator('#restore-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}') });
  assert.equal(await page.locator('#restore').isDisabled(), true);
  await page.locator('#replace').check(); await page.locator('#restore').click();
  await page.waitForFunction(() => document.querySelector('#backup-status').dataset.state === 'error');
  assert.equal(new TextDecoder().decode(Uint8Array.from(await read('/workspace/main.c'))), 'replace this newer published version\n');
  await page.locator('#restore-file').setInputFiles(backupFile);
  await page.locator('#editor').fill('unpublished must block restore'); await page.locator('#restore').click();
  await page.waitForFunction(() => document.querySelector('#backup-status').textContent.includes('unpublished editor buffer'));
  await page.locator('#reload').click();
  await page.waitForFunction(() => document.querySelector('#editor').value === 'replace this newer published version\n');
  await page.locator('#restore').click(); await page.waitForFunction(() => document.querySelector('#backup-status').textContent.startsWith('Backup restored'));
  assert.equal(new TextDecoder().decode(Uint8Array.from(await read('/workspace/main.c'))), 'autosave failure must retain this file\n');
  await save();
  checks.push('UI-06: export downloads actual checksummed backup; explicit replacement rejects corrupt backups and protects unpublished buffers');

  await page.reload(); await ready(page);
  assert.equal(await page.locator('#editor').inputValue(), 'autosave failure must retain this file\n');
  assert.deepEqual(await read('/workspace/input.bin'), Array.from(new TextEncoder().encode(input)));
  assert.equal(bodyRequests(), 1);
  await page.locator('#start').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
  await page.locator('#input').fill('warm cache\n'); await page.locator('#send').click(); await page.locator('#eof').click();
  await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('exited; exit 0'));
  assert.equal(bodyRequests(), 1); await save();
  checks.push('UI-07: reload restores committed real files and reuses verified asset cache without another body download');

  await page.locator('#clear-cache').click(); await page.waitForFunction(() => document.querySelector('#cache-status').textContent.startsWith('Downloaded assets cleared'));
  assert.equal(await page.locator('#editor').inputValue(), 'autosave failure must retain this file\n');
  assert.equal(new TextDecoder().decode(Uint8Array.from(await read('/workspace/input.bin'))), 'warm cache\n');
  await page.locator('#gc').click(); await page.waitForFunction(() => document.querySelector('#cache-status').textContent.includes('recovery roots'));
  await page.reload(); await ready(page); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
  assert.equal(bodyRequests(), 2);
  await page.locator('#stop').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('terminated'));
  assert.equal((await current()).processes.length, 0);
  checks.push('UI-08: separate cache clear causes only asset refetch, orphan maintenance preserves recovery roots, and blocked-input Stop reclaims the actual guest');

  await page.evaluate(async () => { const { client } = await (await import('/main.mjs')).application; await client.fs.writeFile('/workspace/binary.bin', new Uint8Array([255, 254, 0])); });
  await page.locator('#directory-form button').click(); await page.getByRole('button', { name: 'binary.bin', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#editor-status').dataset.state === 'error');
  assert.equal(await page.locator('#editor').inputValue(), 'autosave failure must retain this file\n');
  assert.deepEqual(await read('/workspace/binary.bin'), [255, 254, 0]);
  await save();
  checks.push('UI-09: invalid UTF-8 never replaces the existing editor buffer or corrupts binary workspace files');

  const originalTextBytes = [239, 187, 191, 97, 13, 10, 98, 13, 10];
  await page.evaluate(async bytes => {
    const { client } = await (await import('/main.mjs')).application;
    await client.fs.writeFile('/workspace/windows.txt', Uint8Array.from(bytes));
  }, originalTextBytes);
  await page.locator('#directory-form button').click(); await page.getByRole('button', { name: 'windows.txt', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#file-path').value === '/workspace/windows.txt');
  assert.equal(await page.locator('#editor').inputValue(), '\ufeffa\nb\n');
  assert.equal(await page.locator('#publish').isDisabled(), true);
  await save(); assert.deepEqual(await read('/workspace/windows.txt'), originalTextBytes);
  await page.getByRole('button', { name: 'main.c', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#file-path').value === '/workspace/main.c');
  checks.push('UI-14: opening and saving an untouched UTF-8 BOM/CRLF file preserves its exact bytes despite browser text display normalization');

  await page.reload(); await ready(page); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
  await page.locator('#interrupt').click();
  await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('terminated'));
  assert.equal((await current()).processes.length, 0); assert.equal(bodyRequests(), 2);
  await save();
  checks.push('UI-11: foreground interrupt crosses the actual owner transport and terminates the byte guest without a pending read');

  const other = await context.newPage(); await other.goto(url); await other.waitForSelector('[role=alert]');
  assert.match(await other.locator('[role=alert]').textContent(), /BUSY/u);
  await publish('published but deliberately not saved\n');
  await page.locator('#close').click(); await page.waitForFunction(() => document.querySelector('#connection-status').textContent.startsWith('Owner closed'));
  assert.equal(await page.locator('#editor').isDisabled(), true);
  await other.reload(); await ready(other);
  assert.equal(await other.locator('#editor').inputValue(), 'autosave failure must retain this file\n');
  await other.locator('#close').click(); await other.waitForFunction(() => document.querySelector('#connection-status').textContent.startsWith('Owner closed'));
  checks.push('UI-10: second tab is visibly refused; explicit close releases ownership without saving a dirty revision');

  await page.goto(`${example.origin}/?workspace=product-ui-worker-failure`); await ready(page);
  await page.locator('#editor').fill('retain staged buffer after owner failure');
  await page.locator('#start').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
  await page.evaluate(() => { const channel = new BroadcastChannel('container-workbench-ui-test-faults'); channel.postMessage({ operation: 'crash-owner', id: crypto.randomUUID() }); setTimeout(() => channel.close(), 100); });
  await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('cleanup was not acknowledged'));
  assert.equal(await page.locator('#editor').inputValue(), 'retain staged buffer after owner failure');
  assert.equal(await page.locator('#export-buffer').isEnabled(), true); assert.equal(await page.locator('#publish').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#terminal-status').dataset.state === 'error');
  checks.push('UI-12: actual owner Worker failure rejects pending guest reads, disables runtime controls and preserves exportable editor text without claiming cleanup');

  const defaultExample = await createExampleServer();
  try {
    const defaultPage = await context.newPage();
    defaultPage.on('pageerror', error => errors.push(error.message));
    defaultPage.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/iu.test(message.text())) errors.push(message.text()); });
    await defaultPage.goto(`${defaultExample.origin}/?workspace=production-owner-smoke`); await ready(defaultPage);
    await defaultPage.locator('#start').click(); await defaultPage.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process'));
    await defaultPage.locator('#input').fill('normal owner entry\n'); await defaultPage.locator('#send').click(); await defaultPage.locator('#eof').click();
    await defaultPage.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('exited; exit 0'));
    assert.equal(await defaultPage.locator('#stdout').textContent(), 'normal owner entry\n');
    await defaultPage.locator('#close').click(); await defaultPage.waitForFunction(() => document.querySelector('#connection-status').textContent.startsWith('Owner closed'));
    assert.equal(defaultExample.requests.filter(path => path.startsWith('/assets/')).length, 1);
    await defaultPage.close();
  } finally { await defaultExample.close(); }
  checks.push('UI-13: the normal shipped owner entry also runs the real guest and acknowledges clean disposal without test fault hooks');
  assert.deepEqual(errors, []);

  const sourceHashes = { ...example.sourceHashes, ...defaultExample.sourceHashes };
  for (const [path, expected] of Object.entries(example.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'), expected, `Bundled source changed during browser test: ${path}`);
  for (const [path, expected] of Object.entries(defaultExample.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'), expected, `Default bundled source changed during browser test: ${path}`);
  for (const directory of ['examples/container', 'packages/container/src/adapters/wasix', 'packages/container/src/fs/persistence']) {
    for (const path of (await readdir(resolve(root, directory), { recursive: true })).filter(path => /\.(mjs|ts|css|html)$/u.test(path)).sort()) {
      const full = resolve(root, directory, path); sourceHashes[relative(root, full)] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  for (const path of ['packages/container/scripts/test-product-browser.mjs', 'packages/container/test/fixtures/product-owner.mjs']) sourceHashes[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  assert.equal(sourceHashes['packages/container/scripts/test-product-browser.mjs'], harnessSha256, 'Test script changed during execution');
  const evidence = { schemaVersion: 1, kind: 'container-rendered-workbench-browser', applicationCommit, testedWorkingTreeSourceHashes: sourceHashes, bundledSourcesRecheckedAfterRun: true,
    checkedAt: new Date().toISOString(), browser: await browser.version(), os: { platform: platform(), release: release(), architecture: arch() }, isolated: true,
    profile: 'real checked-in WASI byte guest; no Bash or compiler qualification claimed', fixture: example.receipt, fixtureLock: example.lock,
    checks, bodyRequests: bodyRequests(), pageErrors: errors, downloads: [{ file: 'exported-editor-buffer.txt', sha256: createHash('sha256').update(await readFile(bufferFile)).digest('hex') }, { file: 'exported-published-workspace.json', sha256: createHash('sha256').update(backupBytes).digest('hex') }]
  };
  await writeFile(resolve(output, 'product-browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: checks.length, bodyRequests: bodyRequests(), browser: evidence.browser }));
} finally { await browser?.close(); await example.close(); }
