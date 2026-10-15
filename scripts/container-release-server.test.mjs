import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { jsonBytes, digest, prepareContainerDistribution, verifyContainerDistribution } from './container-distribution.mjs';
import { createReleaseExampleServer } from '../examples/container/serve-release.mjs';
import { buildWorkbenchModules, EXAMPLE_CSP } from '../examples/container/serve.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = await readFile(join(repository, 'packages/container/test/fixtures/command.wasm'));
const identity = bytes => ({ bytes: bytes.length, sha256: digest(bytes) });
async function availablePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'container-host-contract-'));
  let application;
  try {
    const port = await availablePort(), baseURL = `http://127.0.0.1:${port}/container-release/`;
    const receipt = jsonBytes({ kind: 'host-server-unit-contract-only', artifact: identity(wasm), producerQualification: false });
    const source = await readFile(join(repository, 'packages/container/test/fixtures/command.c'));
    const notice = Buffer.from('Small ABI test fixture; not compiler or shell qualification.');
    const delivery = gzipSync(wasm, { mtime: 0 }), html = Buffer.from('<!doctype html><script type="module" src="./main.mjs"></script>');
    const main = Buffer.from('export const scope = "static host response contract";\n');
    for (const [name, bytes] of [['guest.gz', delivery], ['receipt.json', receipt], ['command.c', source], ['NOTICE', notice], ['index.html', html], ['main.mjs', main]]) await writeFile(join(root, name), bytes);
    const recipe = { schemaVersion: 1, baseURL, adapterIds: ['wasi-preview1'],
      distribution: { schemaVersion: 1, distributionId: 'host-server-unit', packages: [{ id: 'fixture', identity: `sha256:${digest(receipt)}`,
        producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: 'a'.repeat(40), receiptSha256: digest(receipt) }, dependencies: [], mount: '/opt/toolchains/fixture', capabilities: ['wasi-preview1'],
        assets: [{ id: 'guest', url: 'https://replaced.invalid/guest', encoding: 'gzip', delivery: { ...identity(delivery), mediaType: 'application/gzip' }, logical: { ...identity(wasm), mediaType: 'application/wasm' } }],
        files: [{ path: 'bin/guest', asset: 'guest', executable: true }] }], commands: [{ name: 'guest', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/guest', argv0: 'guest', prefixArgs: [] }] },
      inputs: [{ package: 'fixture', asset: 'guest', path: 'guest.gz' }],
      provenance: [{ package: 'fixture', license: 'fixture-contract-only', sourceStatus: 'incomplete', receipt: { path: 'receipt.json', ...identity(receipt) }, sources: [{ path: 'command.c', ...identity(source) }], notices: [{ path: 'NOTICE', ...identity(notice) }] }],
      hostFiles: [{ path: 'index.html', destination: 'index.html', ...identity(html), mediaType: 'text/html' }, { path: 'main.mjs', destination: 'main.mjs', ...identity(main), mediaType: 'text/javascript' }] };
    const input = join(root, 'recipe.json'), directory = join(root, 'release'); await writeFile(input, jsonBytes(recipe));
    const prepared = await prepareContainerDistribution({ input, output: directory });
    const lock = JSON.parse(await readFile(join(directory, 'application-lock.json'), 'utf8'));
    const start = async () => application = await createReleaseExampleServer({ directory, expectedSha256: prepared.lockSha256 });
    await run({ root, directory, prepared, lock, start, port, html, main, delivery });
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}

test('immutable host responses retain exact delivery bytes, MIME, isolation and CSP', () => fixture(async ({ directory, prepared, lock, start, html, main, delivery }) => {
  const server = await start();
  assert.equal(server.startURL, new URL(`host/${lock.host.sha256}/index.html`, lock.baseURL).href);
  const page = await fetch(server.startURL + '?workspace=unit');
  assert.equal(page.status, 200); assert.deepEqual(Buffer.from(await page.arrayBuffer()), html);
  assert.equal(page.headers.get('content-type'), 'text/html'); assert.equal(page.headers.get('content-security-policy'), EXAMPLE_CSP);
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin'); assert.equal(page.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(page.headers.get('cache-control'), 'no-store'); assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const host = await fetch(new URL('./main.mjs', server.startURL)); assert.equal(host.headers.get('content-type'), 'text/javascript'); assert.deepEqual(Buffer.from(await host.arrayBuffer()), main);
  const asset = await fetch(new URL(server.assetPaths.guest, server.origin));
  assert.equal(asset.headers.get('content-type'), 'application/gzip'); assert.equal(asset.headers.get('content-encoding'), null);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), delivery); assert.equal(server.downloads[server.assetPaths.guest], 1);
  assert.equal(server.qualificationContext.deployed, false); assert.equal(server.qualificationContext.sourceClosureReviewed, false);
  assert.equal((await verifyContainerDistribution({ directory, expectedSha256: prepared.lockSha256 })).verified, true);
}));

test('host server serves only the locked inventory and does not expose sibling files', () => fixture(async ({ root, start, lock }) => {
  await writeFile(join(root, 'private-sibling'), 'outside the release inventory');
  const server = await start();
  for (const path of ['/private-sibling', '/container-release/../private-sibling', '/container-release/not-in-lock']) assert.equal((await fetch(new URL(path, server.origin))).status, 404);
  assert.equal((await fetch(server.startURL, { method: 'POST' })).status, 404);
  assert.equal((await fetch(new URL(`host/${lock.host.sha256}/not-in-lock.mjs`, lock.baseURL))).status, 404);
}));

test('a host module changed after startup is rejected before any changed bytes are served', () => fixture(async ({ directory, lock, start, main }) => {
  const server = await start(), path = join(directory, 'host', lock.host.sha256, 'main.mjs');
  const changed = Buffer.from(main); changed[changed.length - 1] ^= 1; await writeFile(path, changed);
  const response = await fetch(new URL('./main.mjs', server.startURL)); assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('static host response'), false);
  await writeFile(path, main);
}));

test('independent lock failure never opens the serving port; disposal can be repeated', () => fixture(async ({ directory, start, port }) => {
  await assert.rejects(createReleaseExampleServer({ directory, expectedSha256: '0'.repeat(64) }), /lock integrity/u);
  const server = await start(); await Promise.all([server.close(), server.close()]); await server.close();
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}));

test('trusted Bash host keeps the SDK as a literal relative static module import', async () => {
  const bundled = await buildWorkbenchModules({ ownerEntry: join(repository, 'examples/container/bash-owner.mjs'), profile: { profileLabel: 'Static host graph contract only' },
    sdkImportURL: './sdk/index.mjs', entries: { 'clang-worker': join(repository, 'packages/container/src/adapters/clang/worker.ts') }, define: { __CONTAINER_BASH_CONFIG__: '{}' } });
  assert.match(Buffer.from(bundled.resources.get('/owner.mjs').bytes).toString(), /from "\.\/sdk\/index\.mjs"/u);
  assert.equal(Object.keys(bundled.sourceHashes).some(path => path.includes('local-package/')), false);
  await assert.rejects(buildWorkbenchModules({ sdkImportURL: 'https://unapproved.invalid/index.mjs' }), /explicit pinned SDK/u);
});
