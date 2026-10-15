import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { release } from 'node:os';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = dirname(fileURLToPath(import.meta.resolve('@wasm-idle/core')));
const importMap = '{"imports":{"@wasm-idle/core":"/core/index.js"}}';
const csp = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${createHash('sha256').update(importMap).digest('base64')}'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Content-Security-Policy', csp); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><meta charset="utf-8"><title>Workspace bindings contract</title><script type="importmap">${importMap}</script>`); return;
    }
    const base = pathname.startsWith('/core/') ? core : root;
    const path = resolve(base, '.' + decodeURIComponent(pathname.startsWith('/core/') ? pathname.slice(5) : pathname));
    if (relative(base, path).startsWith('..') || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript'); response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage(), faults = [];
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/u.test(message.text())) faults.push(message.text()); });
  const document = await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(document.headers()['content-security-policy'], csp);
  const result = await page.evaluate(async () => {
    const { createContainer } = await import('/dist/index.js');
    const { createLiveWasiAdapter } = await import('/dist/adapters/wasi-live/index.js');
    const { createWasiAdapter } = await import('/dist/adapters/wasi/index.js');
    const { openWorkspaceEditor } = await import('/dist/workspace/index.js');
    const { verifyWorkspaceBindings } = await import('/test/contract/workspace-fixture.mjs');
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/live.wasm')).arrayBuffer());
    let createdWorkers = 0, activeWorkers = 0;
    const factory = path => () => {
      const worker = new Worker(path, { type: 'module' }), terminate = worker.terminate.bind(worker); let disposed = false;
      createdWorkers++; activeWorkers++;
      worker.terminate = () => { if (!disposed) { disposed = true; activeWorkers--; } terminate(); }; return worker;
    };
    const result = await verifyWorkspaceBindings({ createContainer, openWorkspaceEditor, bytes,
      liveAdapter: createLiveWasiAdapter({ workerFactory: factory('/dist/adapters/wasi-live/worker.js') }),
      snapshotAdapter: createWasiAdapter({ workerFactory: factory('/dist/adapters/wasi/worker.js') })
    });
    return { ...result, createdWorkers, activeWorkers, isolated: crossOriginIsolated };
  });
  assert.equal(result.activeWorkers, 0); assert.equal(result.isolated, true); assert.deepEqual(faults, []);
  const sourceHashes = {};
  for (const file of (await readdir(resolve(root, 'src'), { recursive: true })).filter(file => file.endsWith('.ts')).sort()) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, 'src', file))).digest('hex');
  const evidence = {
    schemaVersion: 1, applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes,
    browser: browser.version(), platform: process.platform, kernel: release(), arch: process.arch, image: process.env.ImageVersion,
    contentSecurityPolicy: csp, fixtureSha256: createHash('sha256').update(await readFile(resolve(root, 'test/fixtures/live.wasm'))).digest('hex'), result, faults
  };
  if (process.env.CONTAINER_EVIDENCE) { await mkdir(dirname(process.env.CONTAINER_EVIDENCE), { recursive: true }); await writeFile(process.env.CONTAINER_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify(evidence));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
