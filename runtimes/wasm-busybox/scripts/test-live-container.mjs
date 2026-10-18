// Real, receipt-pinned BusyBox through the isolated WASI adapter in Node/Chromium.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { release } from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { exerciseLiveBusybox } from '../test/live-container-cases.mjs';

const { values } = parseArgs({ options: {
  'producer-work': { type: 'string' }, 'producer-revision': { type: 'string' },
  'container-dist': { type: 'string' }, 'core-dist': { type: 'string' },
  'output': { type: 'string' }, 'node-only': { type: 'boolean', default: false },
} });
for (const key of ['producer-work', 'producer-revision', 'container-dist', 'output']) assert.ok(values[key], `Required: --${key}`);
assert.match(values['producer-revision'], /^[0-9a-f]{40}$/);
const work = resolve(values['producer-work']), dist = resolve(values['container-dist']);
const core = resolve(values['core-dist'] ?? resolve(dist, '../../core/dist'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receiptBytes = await readFile(resolve(work, 'receipt.json')), receipt = JSON.parse(receiptBytes);
assert.equal(receipt.status, 'producer-smoke-passed'); assert.equal(receipt.b1SmokePassed, true);
assert.equal(receipt.nativeSmokePassed, true); assert.equal(receipt.wasiNodeSmokePassed, true);
const artifact = await readFile(resolve(work, 'busybox.wasm'));
assert.equal(sha(artifact), receipt.wasi.artifact.sha256); assert.equal(artifact.length, receipt.wasi.artifact.size);
const applets = ['cat', 'cp', 'echo', 'false', 'grep', 'mkdir', 'mv', 'printf', 'pwd', 'rm', 'true'];
assert.deepEqual(receipt.nodeWasiApplets, applets);
const sources = {
  harness: fileURLToPath(import.meta.url),
  cases: fileURLToPath(new URL('../test/live-container-cases.mjs', import.meta.url)),
  worker: fileURLToPath(new URL('../test/live-container-worker.mjs', import.meta.url)),
};
const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, path]) => [key, await readFile(path)])));
async function modules(root) {
  const hashes = {};
  for (const path of (await readdir(root, { recursive: true })).filter(path => path.endsWith('.js')).sort()) hashes[path] = sha(await readFile(resolve(root, path)));
  return hashes;
}
const containerHashes = await modules(dist), coreHashes = await modules(core);
const importMap = '{"imports":{"@wasm-idle/core":"/core/index.js"}}';
const csp = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${createHash('sha256').update(importMap).digest('base64')}'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
const bodyRequests = { node: 0, browser: 0 };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Content-Security-Policy', csp); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><meta charset="utf-8"><title>BusyBox live contract</title><script type="importmap">${importMap}</script>`); return;
    }
    if (path === '/cases.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(sourceBytes.cases); return; }
    for (const mode of ['node', 'browser']) if (path === `/assets/${mode}/${sha(artifact)}.wasm`) {
      bodyRequests[mode]++; response.setHeader('Content-Type', 'application/wasm'); response.setHeader('Cache-Control', 'no-store'); response.end(artifact); return;
    }
    const prefix = path.startsWith('/container/') ? '/container/' : '/core/';
    if (!path.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const base = prefix === '/container/' ? dist : core, file = resolve(base, decodeURIComponent(path.slice(prefix.length)));
    if (relative(base, file).startsWith('..') || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
function fixture(mode) {
  const assetURL = `${origin}/assets/${mode}/${sha(artifact)}.wasm`;
  const identity = { sha256: sha(artifact), bytes: artifact.length, mediaType: 'application/wasm' };
  const distribution = JSON.stringify({ schemaVersion: 1, distributionId: `busybox-live-${sha(artifact)}`, packages: [{
    id: 'busybox', identity: `sha256:${sha(artifact)}`, dependencies: [], mount: '/opt/toolchains/busybox',
    producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: values['producer-revision'], receiptSha256: sha(receiptBytes) },
    capabilities: ['wasi-preview1'], assets: [{ id: 'busybox', url: assetURL, encoding: 'identity', delivery: identity, logical: identity }],
    files: [{ path: 'bin/busybox', asset: 'busybox', executable: true }],
  }], commands: ['busybox', ...applets].map(name => ({ name, package: 'busybox', adapter: 'wasi-preview1-live', path: 'bin/busybox', argv0: name, prefixArgs: [] })) });
  return { distribution, distributionSha256: sha(distribution), assetURL };
}
const output = resolve(values.output);
const save = async evidence => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n'); };
let browser;
try {
  const workerModule = pathToFileURL(resolve(dist, 'adapters/wasi-live/worker.js')).href;
  const node = await exerciseLiveBusybox({ ...fixture('node'),
    containerModule: pathToFileURL(resolve(dist, 'index.js')).href, adapterModule: pathToFileURL(resolve(dist, 'adapters/wasi-live/index.js')).href,
    workerFactory() {
      const worker = new Worker(pathToFileURL(sources.worker), { workerData: { module: workerModule } });
      const wrapper = { onmessage: null, onerror: null, onmessageerror: null,
        postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
      worker.on('message', data => wrapper.onmessage?.({ data })); worker.on('error', error => wrapper.onerror?.({ error }));
      worker.on('messageerror', error => wrapper.onmessageerror?.({ error })); return wrapper;
    } });
  await save({ status: 'node-complete-browser-pending', artifact: receipt.wasi.artifact, node });
  assert.equal(node.passed, true, JSON.stringify(node)); assert.equal(bodyRequests.node, 1);
  if (values['node-only']) console.log(JSON.stringify({ passed: true, profile: 'node-only', cases: node.checks.length, output }));
  else {
    if (process.env.BUSYBOX_MIN_AVAILABLE_KIB !== undefined) {
      const minimum = Number(process.env.BUSYBOX_MIN_AVAILABLE_KIB);
      assert.ok(Number.isSafeInteger(minimum) && minimum >= 0, 'Invalid browser memory admission threshold');
      const memory = await readFile('/proc/meminfo', 'utf8');
      const available = Number(/^MemAvailable:\s+(\d+)\s+kB$/mu.exec(memory)?.[1]);
      assert.ok(Number.isSafeInteger(available) && available >= minimum,
        `Browser memory admission pending: ${available} KiB available, ${minimum} KiB required`);
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
    const page = await browser.newPage(), faults = [];
    page.on('pageerror', error => faults.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/u.test(message.text())) faults.push(message.text()); });
    const document = await page.goto(origin); assert.equal(document.headers()['content-security-policy'], csp);
    const chromiumResult = await page.evaluate(async config => {
      const { exerciseLiveBusybox } = await import('/cases.mjs'); return exerciseLiveBusybox(config);
    }, { ...fixture('browser'), containerModule: '/container/index.js', adapterModule: '/container/adapters/wasi-live/index.js', workerModule: '/container/adapters/wasi-live/worker.js' });
    await save({ status: 'browser-complete-validation-pending', artifact: receipt.wasi.artifact, node, chromium: chromiumResult });
    assert.equal(chromiumResult.passed, true, JSON.stringify(chromiumResult)); assert.equal(chromiumResult.isolated, true);
    assert.equal(bodyRequests.browser, 1); assert.deepEqual(faults, []);
    assert.deepEqual(await modules(dist), containerHashes); assert.deepEqual(await modules(core), coreHashes);
    for (const [key, path] of Object.entries(sources)) assert.equal(sha(await readFile(path)), sha(sourceBytes[key]));
    await save({ schemaVersion: 1, passed: true, fixture: 'BB-LIVE-01', profile: 'isolated-live-wasi', generatedAt: new Date().toISOString(),
      producerRevision: values['producer-revision'], producerReceiptSha256: sha(receiptBytes), artifact: receipt.wasi.artifact,
      imports: receipt.wasi.smoke.imports, sourceSha256: receipt.sourceSha256,
      applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(dist, '../../..'), encoding: 'utf8' }).trim(),
      containerDistHashes: containerHashes, coreDistHashes: coreHashes, fixtureHashes: Object.fromEntries(Object.entries(sourceBytes).map(([key, bytes]) => [key, sha(bytes)])),
      browser: browser.version(), host: { platform: process.platform, arch: process.arch, release: release(), node: process.version },
      contentSecurityPolicy: csp, bodyRequests,
      distributionHashes: { node: fixture('node').distributionSha256, browser: fixture('browser').distributionSha256 },
      node, chromium: chromiumResult,
      unsupported: ['actual shell and shell redirection', 'PTY and job control', 'unqualified BusyBox applets and modes'] });
    console.log(JSON.stringify({ passed: true, nodeCases: node.checks.length, chromiumCases: chromiumResult.checks.length, bodyRequests, output }));
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
