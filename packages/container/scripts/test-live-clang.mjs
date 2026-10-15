// Opt-in actual LLVM qualification; --node and --browser use the same live fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { digest, loadClangBrowserInputs, FULL_SYSROOT_SHA256 } from './clang-browser-inputs.mjs';
import { PROCESS_SYSROOT, PROCESS_SYSROOT_RECEIPT_SHA256 } from '../../../scripts/probe-container-shell-acceptance-lib.mjs';

const args = process.argv.slice(2);
assert(args.length === 5 && ['--node', '--browser'].includes(args[0]) && args[1] === '--config' && args[3] === '--output' && isAbsolute(args[2]) && isAbsolute(args[4]),
  'Use --node|--browser --config PINNED_CONFIGURATION --output FRESH_ABSOLUTE_DIRECTORY');
const browserMode = args[0] === '--browser', output = args[4];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const configuration = JSON.parse(await readFile(args[2], 'utf8'));
const inputs = await loadClangBrowserInputs({
  CONTAINER_PRODUCER_RECEIPT: configuration.clangProducerReceipt, CONTAINER_PRODUCER_RECEIPT_SHA256: configuration.clangProducerReceiptSha256,
  CONTAINER_PRODUCER_SMOKE: configuration.clangProducerSmoke, CONTAINER_PRODUCER_SMOKE_SHA256: configuration.clangProducerSmokeSha256,
  CONTAINER_CLANG_WASM: configuration.clangWasm, CONTAINER_LLD_WASM: configuration.lldWasm, CONTAINER_SYSROOT: configuration.sysroot
});
assert.equal(configuration.processSysrootReceiptSha256, PROCESS_SYSROOT_RECEIPT_SHA256);
assert((await stat(configuration.processSysrootReceipt)).size < 4 * 1024 * 1024);
const receiptBytes = await readFile(configuration.processSysrootReceipt);
assert.equal(digest(receiptBytes), PROCESS_SYSROOT_RECEIPT_SHA256);
const producer = JSON.parse(receiptBytes);
assert(producer.complete && producer.producerTreeClean && producer.cwdFixture.passed);
assert.equal(producer.inputs.sysroot.sha256, FULL_SYSROOT_SHA256);
assert.deepEqual(producer.changedEntries, ['lib/wasm32-wasi/crt1.o']);
assert.deepEqual(producer.outputs['sysroot.tar'], PROCESS_SYSROOT);
assert.equal((await stat(configuration.processSysroot)).size, PROCESS_SYSROOT.bytes);
const sysroot = await readFile(configuration.processSysroot);
assert.equal(digest(sysroot), PROCESS_SYSROOT.sha256);
const logical = name => inputs.assets[name].metadata.encoding === 'gzip'
  ? gunzipSync(inputs.assets[name].delivery, { maxOutputLength: 128 * 1024 * 1024 }) : inputs.assets[name].delivery;
const input = { clang: new Uint8Array(logical('clang')), linker: new Uint8Array(logical('lld')), sysroot: new Uint8Array(sysroot),
  clangSha256: inputs.assets.clang.metadata.logical.sha256, linkerSha256: inputs.assets.lld.metadata.logical.sha256 };
await mkdir(output, { mode: 0o700 });
const sourceHashes = {}, evidence = {
  schemaVersion: 1, passed: false, mode: browserMode ? 'isolated-chromium' : 'node-worker', profile: 'llvm-clang-tool-host-live-v1',
  applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, arch: process.arch, sourceHashes,
  producerReceiptSha256: inputs.producerSha256, producerSmokeSha256: inputs.producerSmokeSha256,
  processSysrootReceiptSha256: PROCESS_SYSROOT_RECEIPT_SHA256,
  assets: { clang: inputs.assets.clang.metadata.logical, linker: inputs.assets.lld.metadata.logical, sysroot: PROCESS_SYSROOT }, faults: []
};
let server, browser;
try {
  for (const path of ['packages/container/scripts/test-live-clang.mjs', 'packages/container/scripts/clang-browser-inputs.mjs',
    'packages/container/test/contract/node-worker-entry.mjs', 'scripts/probe-container-shell-acceptance-lib.mjs', 'scripts/browser-test-cookies.mjs']) {
    sourceHashes[path] = digest(await readFile(resolve(root, path)));
  }
  const bundles = await build({
    absWorkingDir: root, entryPoints: {
      harness: resolve(root, 'packages/container/test/fixtures/clang-live/fixture.mjs'),
      'clang-worker': resolve(root, 'packages/container/src/adapters/clang-live/worker.ts'),
      'wasi-worker': resolve(root, 'packages/container/src/adapters/wasi-live/worker.ts')
    }, outdir: resolve(output, 'bundle'), bundle: true, format: 'esm', platform: browserMode ? 'browser' : 'node', target: 'es2022',
    outExtension: { '.js': '.mjs' }, write: false,
    alias: { '@wasm-idle/core': resolve(root, 'packages/core/src/index.ts'), '@wasm-idle/llvm-core/tool-host': resolve(root, 'packages/llvm-core/runtime/clang/src/tool-host.ts') },
    plugins: [{ name: 'record-consumed-source', setup(builder) {
      builder.onLoad({ filter: /\.(?:ts|mjs|js)$/ }, async ({ path }) => {
        const bytes = await readFile(path); sourceHashes[relative(root, path)] = digest(bytes);
        return { contents: bytes.toString('utf8'), loader: path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }]
  });
  evidence.bundles = Object.fromEntries(bundles.outputFiles.map(file => [relative(output, file.path), digest(file.contents)]));
  if (!browserMode) {
    await mkdir(resolve(output, 'bundle'), { mode: 0o700 });
    for (const file of bundles.outputFiles) await writeFile(file.path, file.contents, { flag: 'wx', mode: 0o600 });
    let workers = 0;
    const factory = name => {
      const worker = new Worker(pathToFileURL(resolve(root, 'packages/container/test/contract/node-worker-entry.mjs')),
        { workerData: { module: pathToFileURL(resolve(output, 'bundle', `${name}.mjs`)).href } });
      workers++; worker.once('exit', () => { workers--; });
      const wrapper = { onmessage: null, onerror: null, onmessageerror: null, postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
      worker.on('message', data => wrapper.onmessage?.({ data }));
      worker.on('error', error => { evidence.faults.push(error.message); wrapper.onerror?.({ error }); });
      return wrapper;
    };
    const { runLiveClangFixture } = await import(pathToFileURL(resolve(output, 'bundle/harness.mjs')).href);
    evidence.result = await runLiveClangFixture(input, factory, phase => console.log(`phase: ${phase}`));
    evidence.nodeWorkersAfterDispose = workers;
    assert.equal(workers, 0);
  } else {
    const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
    evidence.csp = csp;
    const served = new Map(bundles.outputFiles.map(file => [`/${relative(resolve(output, 'bundle'), file.path)}`, { type: 'text/javascript', body: file.contents }]));
    served.set('/', { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Live LLVM fixture</title>' });
    for (const name of ['clang', 'linker', 'sysroot']) served.set(`/assets/${name}`, { type: name === 'sysroot' ? 'application/x-tar' : 'application/wasm', body: input[name] });
    server = createServer((request, response) => {
      response.setHeader('Content-Security-Policy', csp); response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const file = served.get(new URL(request.url, 'http://localhost').pathname);
      if (!file) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', file.type); response.end(file.body);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: configuration.chromium,
      args: ['--no-sandbox', '--js-flags=--wasm-num-compilation-tasks=1'] });
    evidence.browser = browser.version();
    const context = await browser.newContext(); await addBrowserTestCookies(context, origin);
    const page = await context.newPage();
    page.on('pageerror', error => evidence.faults.push(error.message));
    page.on('console', message => { if (message.type() === 'error') evidence.faults.push(message.text()); });
    context.on('request', request => { const url = new URL(request.url()); if (url.origin !== origin || !served.has(url.pathname)) evidence.faults.push(`Unexpected request: ${url.pathname}`); });
    await page.goto(origin);
    evidence.result = await page.evaluate(async ({ clangSha256, linkerSha256, sysrootSha256 }) => {
      if (!crossOriginIsolated) throw new Error('Live compiler fixture requires isolation');
      const input = { clangSha256, linkerSha256 };
      for (const [name, expected] of [['clang', clangSha256], ['linker', linkerSha256], ['sysroot', sysrootSha256]]) {
        const bytes = new Uint8Array(await (await fetch(`/assets/${name}`)).arrayBuffer());
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (actual !== expected) throw new Error(`${name} fixture integrity mismatch`); input[name] = bytes;
      }
      const { runLiveClangFixture } = await import('/harness.mjs');
      return runLiveClangFixture(input, name => new Worker(`/${name}.mjs`, { type: 'module' }));
    }, { clangSha256: input.clangSha256, linkerSha256: input.linkerSha256, sysrootSha256: PROCESS_SYSROOT.sha256 });
    const session = await browser.newBrowserCDPSession();
    // Worker.terminate() is void in browsers; observe engine retirement before
    // closing the context, which would otherwise hide an owned worker leak.
    const retirementStarted = performance.now();
    do {
      const targets = await session.send('Target.getTargets');
      evidence.workerTargetsAfterDispose = targets.targetInfos.filter(target => ['worker', 'shared_worker', 'service_worker'].includes(target.type));
      if (!evidence.workerTargetsAfterDispose.length) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (performance.now() - retirementStarted < 10000);
    evidence.workerRetirementMs = performance.now() - retirementStarted;
    await session.detach(); assert.deepEqual(evidence.workerTargetsAfterDispose, []);
    await context.close();
  }
  for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(digest(await readFile(resolve(root, path))), hash, `Source changed during qualification: ${path}`);
  assert.deepEqual(evidence.faults, []);
  assert.equal(evidence.result.passed, true, evidence.result.error);
  evidence.passed = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: evidence.passed, checks: evidence.result?.checks, error: evidence.error, receipt: resolve(output, 'receipt.json') }));
}
