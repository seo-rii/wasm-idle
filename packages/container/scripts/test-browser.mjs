import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Container contract</title>'); return; }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (relative(root, path).startsWith('..') || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
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
  assert.deepEqual(faults, []);
  const sourceHashes = {};
  for (const file of (await readdir(resolve(root, 'src'), { recursive: true })).filter((f) => f.endsWith('.ts')).sort()) { sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, 'src', file))).digest('hex'); }
  const evidence = { schemaVersion: 1, sourceHashes, browser: browser.version(), platform: process.platform, arch: process.arch, fixtureSha256: createHash('sha256').update(await readFile(resolve(root, 'test/fixtures/command.wasm'))).digest('hex'), result };
  const output = process.env.CONTAINER_EVIDENCE;
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
