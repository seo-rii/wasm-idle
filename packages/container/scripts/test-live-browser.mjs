import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { release } from 'node:os';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url)), core = resolve(root, '../core/dist');
const importMap = '{"imports":{"@wasm-idle/core":"/core/index.js"}}';
const csp = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${createHash('sha256').update(importMap).digest('base64')}'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Content-Security-Policy', csp); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname !== '/batch') { response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); }
    if (pathname === '/' || pathname === '/batch') {
      response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><meta charset="utf-8"><title>Live WASI contract</title><script type="importmap">${importMap}</script>`); return;
    }
    const base = pathname.startsWith('/core/') ? core : root;
    const path = resolve(base, '.' + decodeURIComponent(pathname.startsWith('/core/') ? pathname.slice(5) : pathname));
    if (relative(base, path).startsWith('..') || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(), faults = [];
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/u.test(message.text())) faults.push(message.text()); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const document = await page.goto(origin); assert.equal(document.headers()['content-security-policy'], csp);
  const result = await page.evaluate(async () => {
    const { createContainer } = await import('/dist/index.js');
    const { createLiveWasiAdapter } = await import('/dist/adapters/wasi-live/index.js');
    const { pathCases, runPathCase } = await import('/test/contract/live-path-cases.mjs');
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/live.wasm')).arrayBuffer());
    const pathBytes = new Uint8Array(await (await fetch('/test/fixtures/path.wasm')).arrayBuffer());
    let liveWorkers = 0, createdWorkers = 0;
    const createWorker = () => {
      const worker = new Worker('/dist/adapters/wasi-live/worker.js', { type: 'module' });
      createdWorkers++; liveWorkers++;
      const terminate = worker.terminate.bind(worker); let dead = false;
      worker.terminate = () => { if (!dead) { dead = true; liveWorkers--; } terminate(); };
      return worker;
    };
    const adapter = createLiveWasiAdapter({ pipeBytes: 4093, workerFactory: createWorker });
    const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } }, maxProcesses: 2 });
    const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
    const drain = async stream => new Uint8Array(await new Response(stream).arrayBuffer());
    const checks = [];
    const check = (id, ok) => { if (!ok) throw new Error(`Live contract failed: ${id}`); checks.push(id); };
    try {
      check('isolated', crossOriginIsolated);
      const input = Uint8Array.from({ length: 262147 }, (_, i) => i % 256);
      const copied = await c.run('tool', [], { stdin: input });
      check('FD-01/02', copied.code === 0 && copied.stdout.length === input.length && copied.stdout.every((n, i) => n === input[i]));
      const flood = await c.run('tool', ['flood']);
      check('FD-03', flood.code === 0 && flood.stdout.length === 131073 && flood.stderr.length === 131073 && flood.stdout.every((n, i) => n === flood.stderr[i]));
      check('non-tty', (await c.run('tool', ['non-tty'])).code === 0);
      const vectored = await c.spawn('tool', ['readv']), vectoredInput = vectored.stdin.getWriter();
      const vectoredOutput = drain(vectored.stdout); let readDeadline;
      try {
        await vectoredInput.write(new Uint8Array([65]));
        const output = await Promise.race([vectoredOutput, new Promise((_, reject) => {
          readDeadline = setTimeout(() => reject(new Error('Vectored read waited for EOF after progress')), 5000);
        })]);
        check('FD-vectored-read-before-eof', decode(output) === 'A' && (await vectored.exited).code === 0);
      } finally { clearTimeout(readDeadline); await vectoredInput.close(); vectoredInput.releaseLock(); }

      const first = await c.spawn('tool', ['visible']), reader = first.stdout.getReader(), writer = first.stdin.getWriter();
      check('output-before-input-eof', decode((await reader.read()).value) === 'ready');
      check('FS-07', decode((await c.run('tool', ['read'])).stdout) === 'before');
      c.fs.writeFile('/workspace/visible', encode('editor'));
      c.fs.mountReadonly('/opt/toolchains/live', [{ path: 'manifest', type: 'file', mode: 0o444, data: encode('verified') }]);
      await writer.write(new Uint8Array([1]));
      check('editor-live-visibility', decode((await reader.read()).value) === 'editor');
      check('open-preopen-after-mount', (await reader.read()).done && (await first.exited).code === 0);
      await writer.close(); writer.releaseLock(); reader.releaseLock();
      const closed = await c.spawn('tool', ['close-output']);
      check('FD-04', decode(await drain(closed.stdout)) === 'eof' && (await c.inspect()).processes.length === 1);
      await closed.stdin.getWriter().close(); check('FD-04-exit', (await closed.exited).code === 0);
      for (const mode of ['copy', 'flood', 'loop']) {
        const p = await c.spawn('tool', [mode]);
        await new Promise(resolve => setTimeout(resolve, 30)); await p.terminate(); await p.terminate();
        check(`PROC-03-${mode}`, (await p.exited).reason === 'terminated');
        await drain(p.stdout); await drain(p.stderr);
        check(`restart-${mode}`, (await c.run('tool')).code === 0);
      }
      let rejected = false;
      try { await c.spawnPipeline([{ command: 'tool' }, { command: 'tool' }, { command: 'tool' }]); }
      catch (error) { rejected = error.code === 'RESOURCE_LIMIT'; }
      check('FD-06', rejected && (await c.inspect()).processes.length === 0);
      const pipe = await c.spawnPipeline([{ command: 'tool', args: ['yes'] }, { command: 'tool', args: ['one'] }]);
      const output = drain(pipe.stdout), errors = Promise.all(pipe.stderr.map(drain)); await pipe.stdin.getWriter().close();
      const exits = await pipe.exited;
      check('FD-05', decode(await output) === 'y' && exits[0].code === 64 && exits[1].code === 0 && (await errors).every(bytes => !bytes.length));
      const crash = await c.run('tool', ['crash']);
      check('live-crash-visibility', crash.reason === 'runtime-error' && decode(c.fs.readFile('/workspace/visible')) === 'before');
      for (const mode of pathCases) {
        const result = await runPathCase(mode, pathBytes, createWorker);
        check(`atomic-path-${mode}`, result.code === 0 && result.interleaved);
      }
      check('cleanup', liveWorkers === 0 && (await c.inspect()).processes.length === 0);
      return { checks, createdWorkers, liveWorkers, browser: navigator.userAgent, isolated: crossOriginIsolated, inspect: await c.inspect() };
    } finally { await c.dispose(); }
  });
  await page.goto(`${origin}/batch`);
  const batch = await page.evaluate(async () => {
    const { createContainer } = await import('/dist/index.js');
    const { createLiveWasiAdapter } = await import('/dist/adapters/wasi-live/index.js');
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/live.wasm')).arrayBuffer());
    let workers = 0;
    const adapter = createLiveWasiAdapter({ workerFactory: () => { workers++; throw new Error('Must reject before Worker allocation'); } });
    const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } } });
    try {
      let errorCode; try { await c.run('tool'); } catch (error) { errorCode = error.code; }
      return { isolated: crossOriginIsolated, errorCode, workers, processes: (await c.inspect()).processes.length };
    } finally { await c.dispose(); }
  });
  assert.deepEqual(batch, { isolated: false, errorCode: 'UNSUPPORTED_PROFILE', workers: 0, processes: 0 });
  assert.deepEqual(faults, []);
  const sourceHashes = {};
  for (const file of (await readdir(resolve(root, 'src'), { recursive: true })).filter(file => file.endsWith('.ts')).sort()) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, 'src', file))).digest('hex');
  const testHashes = {};
  for (const file of ['test/fixtures/live.c', 'test/fixtures/path.c', 'test/fixtures/path.wasm', 'test/contract/live-path-cases.mjs', 'scripts/test-live-browser.mjs']) testHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  const evidence = {
    schemaVersion: 1, applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes, testHashes,
    browser: browser.version(), platform: process.platform, kernel: release(), arch: process.arch, image: process.env.ImageVersion,
    contentSecurityPolicy: csp, fixtureSha256: createHash('sha256').update(await readFile(resolve(root, 'test/fixtures/live.wasm'))).digest('hex'),
    result, batch, faults
  };
  if (process.env.CONTAINER_EVIDENCE) { await mkdir(dirname(process.env.CONTAINER_EVIDENCE), { recursive: true }); await writeFile(process.env.CONTAINER_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
