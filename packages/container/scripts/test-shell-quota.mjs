// Opt-in real Bash/SDK/WASI quota regression. Requires an independently pinned rebuilt SDK.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv.length, 3, 'Usage: node packages/container/scripts/test-shell-quota.mjs /absolute/config.json');
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const key of ['packageReceipt', 'bashWebc', 'chromium', 'output']) assert(isAbsolute(config[key]), `Absolute ${key} required`);
for (const key of ['packageReceiptSha256', 'bashWebcSha256', 'bashWasmSha256']) assert.match(config[key], /^[a-f0-9]{64}$/u);
assert(!config.output.startsWith(root + '/'), 'Evidence output must be outside the checkout');
const pinned = async (path, expected, maximum = 64 * 1024 * 1024) => {
  const body = await readFile(path);
  assert(body.length <= maximum, `Bounded fixture input: ${path}`);
  assert.equal(digest(body), expected, `Pinned fixture input: ${path}`);
  return body;
};
const receipt = JSON.parse(await pinned(config.packageReceipt, config.packageReceiptSha256, 1024 * 1024));
assert.equal(receipt.complete, true); assert.equal(receipt.schemaVersion, 1);
assert.match(receipt.packageId, /^sha256-[a-f0-9]{64}$/u);
const sdkRoot = join(dirname(config.packageReceipt), receipt.packageId), files = new Map();
for (const name of ['index.mjs', 'worker.mjs', 'wasmer_js_bg.wasm']) {
  const body = await pinned(join(sdkRoot, name), receipt.entries[name].sha256);
  assert.equal(body.length, receipt.entries[name].bytes);
  files.set(name.endsWith('.wasm') ? '/assets/sdk' : `/sdk/${name}`, { body, type: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
}
files.set('/assets/bash', { body: await pinned(config.bashWebc, config.bashWebcSha256), type: 'application/octet-stream' });
files.set('/assets/live', { body: await readFile(join(root, 'packages/container/test/fixtures/live.wasm')), type: 'application/wasm' });
const entry = 'packages/container/';
const bundled = await build({ absWorkingDir: root,
  entryPoints: { owner: join(root, entry, 'test/shell-quota/worker.mjs'), 'live-worker': join(root, entry, 'src/adapters/wasi-live/worker.ts') },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: '/bundle', write: false, metafile: true,
  alias: {
    '@wasm-idle/container': join(root, entry, 'src/index.ts'),
    '@wasm-idle/container/adapters/wasix': join(root, entry, 'src/adapters/wasix/index.ts'),
    '@wasm-idle/container/adapters/wasi-live': join(root, entry, 'src/adapters/wasi-live/index.ts'),
    '@wasm-idle/core': join(root, 'packages/core/src/index.ts')
  },
  plugins: [{ name: 'trusted-sdk', setup(builder) {
    builder.onResolve({ filter: /^@wasm-idle\/pinned-wasix-sdk$/ }, () => ({ path: '/sdk/index.mjs', external: true }));
  } }]
});
const sources = {};
for (const name of Object.keys(bundled.metafile.inputs)) sources[name] = digest(await readFile(join(root, name)));
for (const file of bundled.outputFiles) files.set(file.path, { body: file.contents, type: 'text/javascript' });
files.set('/', { body: Buffer.from('<!doctype html><title>Container quota regression</title>'), type: 'text/html' });
const hashes = ['sdk', 'bash', 'live'].map(name => digest(files.get(`/assets/${name}`).body));
await mkdir(config.output, { mode: 0o700 });
const server = createServer((request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'");
  const item = files.get(request.url);
  if (!item) return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': item.type }); response.end(item.body);
});
let browser;
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: config.chromium });
  const context = await browser.newContext(); await addBrowserTestCookies(context, url);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const evidence = await page.evaluate(data => new Promise((done, reject) => {
    const worker = new Worker('/bundle/owner.js', { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Quota fixture exceeded 90 seconds')); }, 90000);
    worker.onmessage = ({ data }) => { if (['result', 'failure'].includes(data.type)) { clearTimeout(timeout); done(data); } };
    worker.onerror = error => { clearTimeout(timeout); worker.terminate(); reject(new Error(error.message)); };
    worker.postMessage(data);
  }), { hashes, bashWasmSha256: config.bashWasmSha256 });
  Object.assign(evidence, { browser: await browser.version(), packageReceiptSha256: config.packageReceiptSha256, sources, errors });
  await writeFile(join(config.output, 'receipt.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  assert.equal(evidence.type, 'result'); assert.equal(evidence.isolation, true);
  assert.equal(evidence.stdout, 'guest:51\nraw:51\n'); assert.equal(evidence.stderr, '');
  assert.deepEqual(evidence.result, { code: 0, reason: 'exited' });
  assert.equal(evidence.directErrors[0].code, 'ENOSPC'); assert.equal(evidence.directErrors[0].errno, 51);
  assert(evidence.filesystemErrors.length >= 2 && evidence.filesystemErrors.every(error => error.code === 'ENOSPC'));
  assert.equal(evidence.workers.active, 0); assert.equal(evidence.workers.created, evidence.workers.terminated);
  assert.deepEqual(errors, []);
  console.log('Real Bash, raw SDK descriptor and WASI guest preserve ENOSPC.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
