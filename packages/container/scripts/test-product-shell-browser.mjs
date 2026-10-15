import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, platform, release } from 'node:os';
import { chromium } from 'playwright-core';
import { createBashExampleServer } from '../../../examples/container/serve-bash.mjs';
import { EXAMPLE_CSP } from '../../../examples/container/serve.mjs';
import { SCRIPT, SOURCE, CLANG_TRIPLE_WARNING, digest, identity } from '../../../scripts/probe-container-shell-acceptance-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The same browser gate accepts a verified immutable local host graph's server adapter. */
export async function runProductShellBrowser({ configuration, output, application, configurationSha256 = digest(Buffer.from(JSON.stringify(configuration))) }) {
  assert(output && isAbsolute(output), 'CONTAINER_PRODUCT_SHELL_OUTPUT must be a new absolute evidence directory');
  await mkdir(output, { recursive: true, mode: 0o700 });
  assert.equal(await stat(resolve(output, 'product-shell-browser-evidence.json')).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; }), undefined, 'Existing browser receipts are preserved; choose a new output directory');
  const applicationCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
  const example = application ?? await createBashExampleServer(configuration);
  let browser, page;
  const receipt = {
    schemaVersion: 1, kind: 'rendered-real-bash-container-workbench', complete: false, qualified: false,
    applicationCommit, startedAt: new Date().toISOString(), script: SCRIPT, scriptSha256: digest(Buffer.from(SCRIPT)),
    configurationSha256, packageReceiptSha256: configuration.packageReceiptSha256,
    producerReceiptSha256: configuration.clangProducerReceiptSha256, busyboxReceiptSha256: configuration.busyboxReceiptSha256,
    processSysrootReceiptSha256: configuration.processSysrootReceiptSha256,
    os: { platform: platform(), release: release(), architecture: arch() }, runs: [], checks: [], errors: [],
    scope: 'Actual rendered workbench, public WASIX session, real Bash/BusyBox/Clang, common workspace, OPFS save/reload and independently verified asset cache; loopback deployment only, no PTY or production CDN claim',
    distributionSha256: example.config.manifestSha256,
    ...(example.qualificationContext ? { application: example.qualificationContext } : {})
  };
  const saveEvidence = () => writeFile(resolve(output, 'product-shell-browser-evidence.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  try {
    await saveEvidence();
    browser = await chromium.launch({ headless: true, executablePath: configuration.chromium ?? process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
    receipt.browser = await browser.version();
    const cdp = await browser.newBrowserCDPSession(); await cdp.send('Target.setDiscoverTargets', { discover: true });
    const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(target => target.type === 'worker');
    const waitWorkers = async expected => {
      const deadline = Date.now() + 5000;
      let targets;
      do { targets = await workers(); if (targets.length === expected) return targets.map(({ type, url }) => ({ type, url })); await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
      assert.equal(targets.length, expected, `Owned dedicated Worker targets: ${targets.map(target => target.url).join(', ')}`);
    };
    receipt.workerTargets = { initial: await waitWorkers(0) };
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' }); page = await context.newPage();
    page.setDefaultTimeout(300000);
    page.on('pageerror', error => receipt.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/iu.test(message.text())) receipt.errors.push(message.text()); });
    page.on('dialog', dialog => { void dialog.accept(); });
    const startURL = new URL(example.startURL ?? '/', example.origin); startURL.searchParams.set('workspace', 'real-bash-ui');
    const url = startURL.href;
    const ready = async () => {
      await page.waitForFunction(() => document.querySelector('#editor:not([disabled])') || document.querySelector('[role=alert]'));
      if (await page.locator('[role=alert]').count()) assert.fail(await page.locator('[role=alert]').textContent());
    };
    const client = async (method, ...args) => page.evaluate(async ({ method, args }) => {
      const { client } = await (await import(new URL('./main.mjs', location.href).href)).application;
      if (method === 'read') { const file = await client.fs.readFile(args[0]); return { ...file, bytes: Array.from(file.bytes), stat: await client.fs.stat(args[0]) }; }
      return client[method](...args);
    }, { method, args });
    const send = async text => { await page.locator('#input').fill(text); await page.locator('#send').click(); await page.waitForFunction(() => !document.querySelector('#send').disabled || document.querySelector('#terminal-status').dataset.state === 'error'); };
    const start = async () => { await page.locator('#start').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Running process') || document.querySelector('#terminal-status').dataset.state === 'error'); assert.match(await page.locator('#terminal-status').textContent(), /^Running process/u); };
    const finish = async () => { await page.locator('#eof').click(); await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.includes('exit 0') || document.querySelector('#terminal-status').dataset.state === 'error'); assert.match(await page.locator('#terminal-status').textContent(), /^exited; exit 0/u); };
    const save = async () => { await page.locator('#save').click(); await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('saved') || document.querySelector('#save-status').dataset.state === 'error'); assert.match(await page.locator('#save-status').textContent(), /^saved/u); };
    const compilerDownloads = () => Object.fromEntries(['clang', 'lld', 'sysroot'].map(name => [name, example.downloads[example.assetPaths?.[name] ?? `/assets/${name}`] ?? 0]));
    const checkWorkspace = async () => {
      const source = await client('read', '/workspace/demo/main.c'), result = await client('read', '/workspace/demo/result.txt'), artifact = await client('read', '/workspace/demo/hello.wasm');
      assert.deepEqual(source.bytes, SOURCE); assert.equal(Buffer.from(result.bytes).toString(), 'hello\n');
      assert.deepEqual(artifact.bytes.slice(0, 8), [0, 97, 115, 109, 1, 0, 0, 0]); assert(artifact.stat.mode & 0o111, 'Artifact executable metadata must survive publication and persistence');
      return { source: { ...identity(Buffer.from(source.bytes)), inode: source.inode }, result: { ...identity(Buffer.from(result.bytes)), inode: result.inode }, artifact: { ...identity(Buffer.from(artifact.bytes)), inode: artifact.inode, mode: artifact.stat.mode } };
    };

    const document = await page.goto(url); await ready();
    assert.equal(document.headers()['content-security-policy'], EXAMPLE_CSP);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    assert.deepEqual(compilerDownloads(), { clang: 0, lld: 0, sysroot: 0 });
    assert.match(await page.locator('#profile').textContent(), /Real GNU Bash/u);
    receipt.checks.push('PRODUCT-SH-01: rendered actual Bash profile opens persistent workspace with no compiler body requests');
    receipt.phase = 'starting-cold-shell'; await saveEvidence();
    await start();
    assert.deepEqual(compilerDownloads(), { clang: 0, lld: 0, sysroot: 0 });
    const boundary = SCRIPT.indexOf('clang main.c'); assert(boundary > 0);
    const prefix = SCRIPT.slice(0, boundary), suffix = SCRIPT.slice(boundary); assert.equal(prefix + suffix, SCRIPT);
    await send(prefix);
    await page.waitForFunction(async () => { try { const { client } = await (await import(new URL('./main.mjs', location.href).href)).application; const source = await client.fs.readFile('/workspace/demo/main.c'); return new TextDecoder().decode(source.bytes).includes('puts("hello")'); } catch { return false; } });
    assert.deepEqual(compilerDownloads(), { clang: 0, lld: 0, sysroot: 0 });
    receipt.checks.push('PRODUCT-SH-02: actual Bash creates source in common workspace before the first Clang request');
    receipt.phase = 'cold-compiler'; await saveEvidence();
    const coldStart = { ...example.downloads }, coldAt = performance.now();
    await send(suffix); await finish();
    assert.equal(await page.locator('#stdout').textContent(), 'hello\n'); assert.equal(await page.locator('#stderr').textContent(), CLANG_TRIPLE_WARNING);
    const coldFiles = await checkWorkspace();
    assert.deepEqual(compilerDownloads(), { clang: 1, lld: 1, sysroot: 1 });
    assert.equal((await client('inspect')).processes.length, 0);
    receipt.workerTargets.afterColdShell = await waitWorkers(1);
    await save();
    receipt.runs.push({ id: 'cold-unchanged-plan-script', elapsedMs: performance.now() - coldAt, inputSha256: digest(Buffer.from(prefix + suffix)), stdout: 'hello\n', stderr: CLANG_TRIPLE_WARNING, files: coldFiles, downloads: { start: coldStart, end: { ...example.downloads } }, inspection: await client('inspect') });
    receipt.checks.push('PRODUCT-SH-03: unchanged plan script runs actual Bash→Clang→artifact→BusyBox pipe/redirect; all files and executable metadata are committed');
    receipt.phase = 'persisted-artifact-reload';
    await saveEvidence();

    const [backup] = await Promise.all([page.waitForEvent('download'), page.locator('#backup').click()]);
    const backupFile = resolve(output, 'real-bash-workspace-backup.json'); await backup.saveAs(backupFile);
    const backupBytes = await readFile(backupFile); assert(backupBytes.length < 1024 * 1024, 'Backup must exclude compiler/package bytes');
    receipt.backup = { file: 'real-bash-workspace-backup.json', ...identity(backupBytes) };

    await page.reload(); await ready();
    assert.deepEqual(await checkWorkspace(), coldFiles);
    const restartStart = { ...example.downloads };
    await start();
    const restartScript = 'set -eu\ncd /workspace/demo\n./hello.wasm | grep hello > restored.txt\ncat restored.txt\n';
    await send(restartScript); await finish();
    assert.equal(await page.locator('#stdout').textContent(), 'hello\n'); assert.equal(await page.locator('#stderr').textContent(), '');
    assert.equal(Buffer.from((await client('read', '/workspace/demo/restored.txt')).bytes).toString(), 'hello\n');
    assert.deepEqual(example.downloads, restartStart); await save();
    receipt.workerTargets.afterRestoredArtifactShell = await waitWorkers(1);
    receipt.runs.push({ id: 'reload-reexecute-persisted-artifact', script: restartScript, files: await checkWorkspace(), downloads: { start: restartStart, end: { ...example.downloads } }, inspection: await client('inspect') });
    receipt.checks.push('PRODUCT-SH-04: new owner restores source/result/executable Wasm and directly reruns it through real BusyBox without body downloads');
    receipt.phase = 'warm-compiler'; await saveEvidence();

    await page.reload(); await ready(); const warmStart = { ...example.downloads }, warmAt = performance.now();
    await start(); await send(SCRIPT); await finish();
    assert.equal(await page.locator('#stdout').textContent(), 'hello\n'); assert.equal(await page.locator('#stderr').textContent(), CLANG_TRIPLE_WARNING);
    const warmFiles = await checkWorkspace(); assert.equal(warmFiles.artifact.sha256, coldFiles.artifact.sha256);
    assert.deepEqual(example.downloads, warmStart); await save();
    receipt.workerTargets.afterWarmShell = await waitWorkers(1);
    receipt.runs.push({ id: 'warm-unchanged-plan-script', elapsedMs: performance.now() - warmAt, inputSha256: digest(Buffer.from(SCRIPT)), files: warmFiles, downloads: { start: warmStart, end: { ...example.downloads } }, inspection: await client('inspect') });
    receipt.checks.push('PRODUCT-SH-05: a fresh owner repeats the unchanged real compiler workflow using verified persistent bytes with zero repeated body downloads');
    receipt.phase = 'foreground-interrupt';
    await saveEvidence();

    await page.reload(); await ready(); await start(); await send('cat\n');
    await page.waitForFunction(async () => (await (await (await import(new URL('./main.mjs', location.href).href)).application).client.inspect()).processes.some(process => process.command === 'cat' && process.state === 'running'));
    await page.locator('#interrupt').click();
    await page.waitForFunction(async () => (await (await (await import(new URL('./main.mjs', location.href).href)).application).client.inspect()).processes.length === 0);
    await send("printf 'shell-alive\\n'\n"); await finish();
    assert.equal(await page.locator('#stdout').textContent(), 'shell-alive\n');
    receipt.checks.push('PRODUCT-SH-06: UI foreground interrupt releases a real BusyBox command blocked on stdin while actual Bash survives and executes the next input');
    await save(); await page.locator('#close').click();
    await page.waitForFunction(() => document.querySelector('#connection-status').textContent.startsWith('Owner closed'));
    receipt.workerTargets.afterOwnerClosed = await waitWorkers(0);
    assert.deepEqual(receipt.errors, []);
    const sourceHashes = { ...example.sourceHashes, 'packages/container/scripts/test-product-shell-browser.mjs': harnessSha256 };
    for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(digest(await readFile(resolve(root, path))), expected, `Source changed during test: ${path}`);
    receipt.sourceHashes = sourceHashes; receipt.sourcesRecheckedAfterRun = true; receipt.requests = example.requests; receipt.downloads = example.downloads;
    receipt.complete = true; receipt.qualified = true; receipt.phase = 'complete';
    console.log(JSON.stringify({ passed: receipt.checks.length, runs: receipt.runs.length, browser: receipt.browser, downloads: example.downloads }));
  } catch (error) {
    receipt.error = String(error?.stack ?? error); receipt.downloads = { ...example.downloads }; receipt.requests = [...example.requests];
    try { receipt.lastUI = await page?.evaluate(() => Object.fromEntries(['profile', 'editor-status', 'terminal-status', 'save-status', 'connection-status', 'stdout', 'stderr'].map(id => [id, document.getElementById(id)?.textContent?.slice(0, 4096) ?? null]))); } catch {}
    throw error;
  }
  finally { receipt.finishedAt = new Date().toISOString(); await saveEvidence(); await browser?.close(); await example.close(); }

  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Absolute pinned shell configuration required');
  const bytes = await readFile(process.argv[2]);
  await runProductShellBrowser({ configuration: JSON.parse(bytes), configurationSha256: digest(bytes), output: process.env.CONTAINER_PRODUCT_SHELL_OUTPUT });
}
