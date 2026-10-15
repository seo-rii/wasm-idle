// Real BusyBox bytes, the actual container WASI worker, and Chromium. No CLI mocks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { platform, release, arch } from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values } = parseArgs({ options: {
  'producer-work': { type: 'string' }, 'producer-revision': { type: 'string' },
  'container-dist': { type: 'string' }, 'core-dist': { type: 'string' },
  'output': { type: 'string' },
} });
for (const name of ['producer-work', 'producer-revision', 'container-dist', 'output']) {
  assert.ok(values[name], `Required: --${name}`);
}
assert.match(values['producer-revision'], /^[a-f0-9]{40}$/);
const work = resolve(values['producer-work']);
const containerDist = resolve(values['container-dist']);
const coreDist = resolve(values['core-dist'] ?? resolve(containerDist, '../../core/dist'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receiptBytes = await readFile(resolve(work, 'receipt.json'));
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.status, 'producer-smoke-passed');
assert.equal(receipt.nativeSmokePassed, true);
assert.equal(receipt.wasiNodeSmokePassed, true);
assert.equal(receipt.processAbi.namespace, 'wasm_idle_process_v1');
const artifact = await readFile(resolve(work, 'busybox.wasm'));
assert.equal(sha(artifact), receipt.wasi.artifact.sha256);
assert.equal(artifact.length, receipt.wasi.artifact.size);
const applets = ['cat', 'echo', 'false', 'printf', 'pwd', 'true'];
assert.deepEqual(receipt.nodeWasiApplets, applets);
async function hashModules(root) {
  const hashes = {};
  for (const file of (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.js')).sort()) {
    hashes[file] = sha(await readFile(resolve(root, file)));
  }
  return hashes;
}
const initialContainerHashes = await hashModules(containerDist);
const initialCoreHashes = await hashModules(coreDist);
const requests = { node: 0, browser: 0 };
const bodyPath = (mode) => `/assets/${mode}/${sha(artifact)}.wasm`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><title>BusyBox container contract</title><script type="importmap">{"imports":{"@wasm-idle/core":"/core/index.js"}}</script>');
      return;
    }
    if (pathname === '/stats') {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(requests)); return;
    }
    for (const mode of ['node', 'browser']) {
      if (pathname === bodyPath(mode)) {
        requests[mode]++;
        response.setHeader('Content-Type', 'application/wasm');
        response.setHeader('Cache-Control', 'no-store');
        response.end(artifact); return;
      }
    }
    const prefix = pathname.startsWith('/container/') ? '/container/' : '/core/';
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const base = prefix === '/container/' ? containerDist : coreDist;
    const path = resolve(base, decodeURIComponent(pathname.slice(prefix.length)));
    const local = relative(base, path);
    if (local.startsWith('..') || local.startsWith('/') || !(await stat(path)).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

function fixture(mode) {
  const url = origin + bodyPath(mode);
  const identity = { sha256: sha(artifact), bytes: artifact.length, mediaType: 'application/wasm' };
  const data = JSON.stringify({ schemaVersion: 1, distributionId: `busybox-b0-${sha(artifact)}`, packages: [{
    id: 'busybox', identity: `sha256:${sha(artifact)}`, dependencies: [], mount: '/opt/toolchains/busybox',
    producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: values['producer-revision'], receiptSha256: sha(receiptBytes) },
    capabilities: ['wasi-preview1'],
    assets: [{ id: 'busybox', url, encoding: 'identity', delivery: identity, logical: identity }],
    files: [{ path: 'bin/busybox', asset: 'busybox', executable: true }],
  }], commands: ['busybox', ...applets].map((name) => ({
    name, package: 'busybox', adapter: 'wasi-preview1', path: 'bin/busybox', argv0: name, prefixArgs: [],
  })) });
  return { data, expectedSha256: sha(data), url, mode, stats: `${origin}/stats` };
}

// This same function runs with real Node worker_threads and inside Chromium.
async function exercise(config) {
  const { createContainer, validateDistribution, createContainerPackageManager } = await import(config.containerModule);
  const { createWasiAdapter } = await import(config.adapterModule);
  const count = async () => (await (await fetch(config.stats)).json())[config.mode];
  const before = await count();
  const distribution = await validateDistribution({ bytes: new TextEncoder().encode(config.data),
    expectedSha256: config.expectedSha256, adapterIds: ['wasi-preview1'], allowedAssetURLs: [config.url] });
  const manager = createContainerPackageManager({ distribution, capabilities: ['wasi-preview1'],
    persistentCache: config.mode === 'browser'
      ? { enabled: true, namespace: 'busybox-container-b0', version: 'v1', storageReserveBytes: 0 }
      : false });
  let liveWorkers = 0;
  const adapter = createWasiAdapter({ workerFactory() {
    const worker = config.workerFactory ? config.workerFactory() : new Worker(config.workerModule, { type: 'module' });
    liveWorkers++;
    const stop = worker.terminate.bind(worker);
    let stopped;
    worker.terminate = () => stopped ??= Promise.resolve(stop()).finally(() => { liveWorkers--; });
    return worker;
  } });
  const container = createContainer({ packages: manager, adapters: [adapter] });
  const bytes = Uint8Array.from({ length: 8193 }, (_, i) => i % 256);
  const encode = (text) => new TextEncoder().encode(text);
  const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  const hex = (value) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const cases = [];
  try {
    const metadata = ['busybox', 'cat', 'echo', 'false', 'printf', 'pwd', 'true'].map((name) => manager.resolveCommand(name).name);
    const afterMetadata = await count();
    container.fs.mkdir('/workspace/a b');
    container.fs.writeFile('/workspace/a b/binary file.bin', bytes);
    const tests = [
      ['printf-binary', 'printf', ['A\\000B\\377\\n'], new Uint8Array(), Uint8Array.of(65, 0, 66, 255, 10), 0],
      ['printf-argv', 'printf', ['<%s><%s>\n', '', '한 글'], new Uint8Array(), encode('<><한 글>\n'), 0],
      ['cat-stdin', 'cat', [], bytes, bytes, 0],
      ['cat-relative', 'cat', ['binary file.bin'], new Uint8Array(), bytes, 0],
      ['cat-absolute', 'cat', ['/workspace/a b/binary file.bin'], new Uint8Array(), bytes, 0],
      ['cat-missing', 'cat', ['missing.bin'], new Uint8Array(), new Uint8Array(), 1,
        encode("cat: can't open 'missing.bin': No such file or directory\n")],
      ['echo-utf8', 'echo', ['한 글'], new Uint8Array(), encode('한 글\n'), 0],
      ['pwd', 'pwd', [], new Uint8Array(), encode('/workspace/a b\n'), 0],
      ['true', 'true', [], new Uint8Array(), new Uint8Array(), 0],
      ['false', 'false', [], new Uint8Array(), new Uint8Array(), 1],
    ];
    for (const [id, applet, args, stdin, stdout, code, stderr = new Uint8Array()] of tests) {
      for (const alias of [false, true]) {
        const result = await container.run(alias ? applet : 'busybox', alias ? args : [applet, ...args],
          { cwd: '/workspace/a b', env: {}, stdin });
        cases.push({ id, invocation: alias ? 'argv0' : 'multicall', code: result.code, reason: result.reason,
          stdoutBytes: result.stdout.length, stdoutHex: result.stdout.length <= 64 ? hex(result.stdout) : undefined,
          stdoutSha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', result.stdout))), stderrHex: hex(result.stderr),
          passed: result.code === code && result.reason === 'exited' && same(result.stdout, stdout) && same(result.stderr, stderr) });
      }
    }
    let readonlyCode;
    try { container.fs.writeFile('/opt/toolchains/busybox/bin/busybox', Uint8Array.of(1)); }
    catch (error) { readonlyCode = error.code; }
    const changed = encode('host edit remains in the common workspace\n');
    container.fs.writeFile('/workspace/a b/binary file.bin', changed);
    const refreshed = await container.run('/usr/bin/cat', ['binary file.bin'], { cwd: '/workspace/a b' });
    const inspection = await container.inspect();
    return { before, afterMetadata, after: await count(), metadata, cases, readonlyCode,
      hostEditVisible: same(refreshed.stdout, changed) && refreshed.code === 0,
      retainedFile: same(container.fs.readFile('/workspace/a b/binary file.bin'), changed),
      liveWorkers, processCount: inspection.processes.length,
      memoryCacheEntries: manager.inspect().assets.cachedEntries,
      isolated: globalThis.crossOriginIsolated ?? false,
      userAgent: globalThis.navigator?.userAgent ?? null,
      cacheNames: globalThis.caches ? await caches.keys() : [] };
  } finally { await container.dispose(); await manager.dispose(); }
}

function validate(result, expectedBefore) {
  assert.equal(result.before, expectedBefore);
  assert.equal(result.afterMetadata, expectedBefore, 'Command metadata must not fetch the body');
  assert.equal(result.after, 1, 'All aliases and warm runs reuse the verified body');
  assert.equal(result.cases.length, 20);
  assert.deepEqual(result.cases.filter((entry) => !entry.passed), []);
  assert.equal(result.readonlyCode, 'EROFS');
  assert.equal(result.hostEditVisible, true);
  assert.equal(result.retainedFile, true);
  assert.equal(result.processCount, 0);
  assert.equal(result.liveWorkers, 0);
}

let browser;
try {
  const workerURL = pathToFileURL(resolve(containerDist, 'adapters/wasi/worker.js')).href;
  const node = await exercise({ ...fixture('node'),
    containerModule: pathToFileURL(resolve(containerDist, 'index.js')).href,
    adapterModule: pathToFileURL(resolve(containerDist, 'adapters/wasi/index.js')).href,
    workerFactory() {
      const worker = new Worker(new URL('../test/container-worker.mjs', import.meta.url), { workerData: { module: workerURL } });
      const wrapper = { onmessage: null, onerror: null, onmessageerror: null,
        postMessage: (data) => worker.postMessage(data), terminate: () => worker.terminate() };
      worker.on('message', (data) => wrapper.onmessage?.({ data }));
      worker.on('error', (error) => wrapper.onerror?.({ error }));
      worker.on('messageerror', (error) => wrapper.onmessageerror?.({ error }));
      return wrapper;
    } });
  validate(node, 0);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const browserRuns = [];
  for (let i = 0; i < 2; i++) {
    if (i === 0) await page.goto(origin);
    else await page.reload();
    const result = await page.evaluate(exercise, { ...fixture('browser'), containerModule: '/container/index.js',
      adapterModule: '/container/adapters/wasi/index.js', workerModule: '/container/adapters/wasi/worker.js' });
    validate(result, i);
    assert.equal(result.isolated, false, 'This fixture qualifies the non-isolated batch profile');
    assert.ok(result.cacheNames.length > 0);
    browserRuns.push(result);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashModules(containerDist), initialContainerHashes, 'Container modules changed during the fixture');
  assert.deepEqual(await hashModules(coreDist), initialCoreHashes, 'Core modules changed during the fixture');
  const repository = resolve(containerDist, '../../..');
  const evidence = { schemaVersion: 1, fixture: 'BB-01', passed: true,
    generatedAt: new Date().toISOString(), producerRevision: values['producer-revision'],
    producerReceiptSha256: sha(receiptBytes), sourceSha256: receipt.sourceSha256,
    artifact: receipt.wasi.artifact, imports: receipt.wasi.smoke.imports,
    applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    containerDistHashes: initialContainerHashes, coreDistHashes: initialCoreHashes,
    fixtureSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    browser: browser.version(), host: { platform: platform(), release: release(), arch: arch(), node: process.version },
    profile: 'batch-snapshot', unsupported: ['live filesystem', 'pipes', 'shell', 'B1 applets', 'interactive stdin'],
    node, browserRuns, bodyRequests: requests,
    cache: { pageReloaded: true, httpCache: 'no-store', namespace: 'busybox-container-b0', persistent: true } };
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, nodeCases: 20, browserCases: 40, bodyRequests: requests,
    artifact: receipt.wasi.artifact, browser: browser.version(), output }, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
