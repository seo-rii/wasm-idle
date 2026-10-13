import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url));
const coreRoot = resolve(root, '../core/dist');
const fixture = await readFile(resolve(root, 'test/fixtures/command.wasm'));
const fixtureSha256 = createHash('sha256').update(fixture).digest('hex');
let assetRequests = 0;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Container contract</title><script type="importmap">{"imports":{"@wasm-idle/core":"/core/index.js"}}</script>'); return; }
    if (pathname === '/asset.wasm') {
      assetRequests++; response.setHeader('Content-Type', 'application/wasm');
      response.setHeader('Cache-Control', 'no-store'); response.end(fixture); return;
    }
    const base = pathname.startsWith('/core/') ? coreRoot : root;
    const path = resolve(base, '.' + decodeURIComponent(pathname.startsWith('/core/') ? pathname.slice(5) : pathname));
    if (relative(base, path).startsWith('..') || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const faults = []; page.on('pageerror', (error) => faults.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { createContainer } = await import('/dist/index.js');
    const { createWasiAdapter } = await import('/dist/adapters/wasi/index.js');
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/command.wasm')).arrayBuffer());
    let liveWorkers = 0;
    const adapter = createWasiAdapter({ workerFactory: () => {
      const worker = new Worker('/dist/adapters/wasi/worker.js', { type: 'module' });
      liveWorkers++;
      const terminate = worker.terminate.bind(worker); let dead = false;
      worker.terminate = () => { if (!dead) { dead = true; liveWorkers--; } terminate(); };
      return worker;
    } });
    const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } } });
    try {
      c.fs.mkdir('/workspace/a b');
      const invocation = await c.run('tool', ['roundtrip', '', '한 글'], { cwd: '/workspace/a b', env: { MARK: '한 글' } });
      const input = Uint8Array.from({ length: 8193 }, (_, i) => i % 256);
      const echo = await c.run('tool', [], { stdin: input });
      const flood = await c.run('tool', ['flood']);
      const abort = new AbortController();
      const p = await c.spawn('tool', ['loop'], { signal: abort.signal });
      await p.stdin.getWriter().close();
      await new Promise((r) => setTimeout(r, 50)); abort.abort();
      const stopped = await p.exited;
      const after = await c.run('tool', ['exit']);
      const crash = await c.run('tool', ['crash']);
      const bad = await c.run('tool', ['bad']);
      const files = c.fs.readdir('/workspace');
      return {
        isolated: crossOriginIsolated, userAgent: navigator.userAgent,
        argv: Array.from(invocation.stdout), env: Array.from(invocation.stderr), code: invocation.code,
        actualCwdFile: Array.from(c.fs.readFile('/workspace/a b/out.bin')),
        binaryExact: echo.stdout.every((n, i) => n === input[i]) && echo.stdout.length === input.length,
        flood: [flood.code, flood.stdout.length, flood.stderr.length], stopped, after: after.code,
        crash: crash.reason, bad: bad.code, files, liveWorkers,
        inspect: await c.inspect()
      };
    } finally { await c.dispose(); }
  });
  assert.equal(result.isolated, false); assert.equal(result.code, 0);
  assert.deepEqual(result.argv, Array.from(new TextEncoder().encode('tool\0roundtrip\0\0한 글\0')));
  assert.deepEqual(result.env, Array.from(new TextEncoder().encode('MARK=한 글\0')));
  assert.deepEqual(result.actualCwdFile, Array.from(new TextEncoder().encode('saved')));
  assert.equal(result.binaryExact, true); assert.deepEqual(result.flood, [0, 65536, 65536]);
  assert.equal(result.stopped.reason, 'terminated'); assert.equal(result.after, 23);
  assert.equal(result.crash, 'runtime-error'); assert.equal(result.files.includes('crash'), false);
  assert.equal(result.bad, 0); assert.equal(result.liveWorkers, 0); assert.equal(result.inspect.processes.length, 0);
  const cacheRuns = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload();
    assert.equal(assetRequests, attempt);
    const cached = await page.evaluate(async ({ sha256, bytes }) => {
      const { createContainer, validateDistribution, createContainerPackageManager } = await import('/dist/index.js');
      const { createWasiAdapter } = await import('/dist/adapters/wasi/index.js');
      const identity = { sha256, bytes, mediaType: 'application/wasm' };
      const url = `${location.origin}/asset.wasm`;
      const index = new TextEncoder().encode(JSON.stringify({
        schemaVersion: 1, distributionId: 'browser-contract-v1', packages: [{
          id: 'fixture', identity: `sha256:${sha256}`,
          producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: '0000000000000000000000000000000000000000', receiptSha256: sha256 },
          dependencies: [], mount: '/opt/toolchains/fixture', capabilities: ['wasi-preview1'],
          assets: [{ id: 'command', url, encoding: 'identity', delivery: identity, logical: identity }],
          files: [{ path: 'bin/tool', asset: 'command', executable: true }]
        }], commands: [{ name: 'tool', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/tool', argv0: 'tool', prefixArgs: [] }]
      }));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', index)), (n) => n.toString(16).padStart(2, '0')).join('');
      const distribution = await validateDistribution({ bytes: index, expectedSha256: digest, adapterIds: ['wasi-preview1'], allowedAssetURLs: [url] });
      const manager = createContainerPackageManager({
        distribution, capabilities: ['wasi-preview1'], maxCachedBytes: 0,
        persistentCache: { enabled: true, namespace: 'container-browser-contract', version: 'fixture-v1', storageReserveBytes: 0 }
      });
      const container = createContainer({ packages: manager, adapters: [createWasiAdapter()] });
      try {
        const metadata = manager.resolveCommand('tool').name;
        const before = performance.getEntriesByType('resource').filter((entry) => entry.name === url).length;
        const result = await container.run('tool', ['exit']);
        return { code: result.code, reason: result.reason, metadata, before, memoryCacheEntries: manager.inspect().assets.cachedEntries, cacheNames: await caches.keys() };
      } finally { await container.dispose(); await manager.dispose(); }
    }, { sha256: fixtureSha256, bytes: fixture.length });
    assert.equal(cached.code, 23); assert.equal(cached.reason, 'exited');
    assert.equal(cached.metadata, 'tool'); assert.equal(cached.before, 0); assert.equal(cached.memoryCacheEntries, 0);
    assert.ok(cached.cacheNames.length > 0); assert.equal(assetRequests, 1);
    cacheRuns.push(cached);
  }
  assert.deepEqual(faults, []);
  const sourceHashes = {};
  for (const file of (await readdir(resolve(root, 'src'), { recursive: true })).filter((f) => f.endsWith('.ts')).sort()) { sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, 'src', file))).digest('hex'); }
  const evidence = { schemaVersion: 1, sourceHashes, browser: browser.version(), platform: process.platform, arch: process.arch, fixtureSha256, result, cache: { cacheRuns, assetRequests, reloaded: true, httpCache: 'no-store', memoryCache: false } };
  const output = process.env.CONTAINER_EVIDENCE;
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
