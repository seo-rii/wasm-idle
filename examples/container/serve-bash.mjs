import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbenchModules, EXAMPLE_CSP } from './serve.mjs';
import { manifest } from '../../scripts/probe-container-shell-acceptance.mjs';
import { readPinnedProbeInputs, BASH_WASM_SHA256, MEMORY, COMMAND_TIMEOUT_MS, digest, identity } from '../../scripts/probe-container-shell-acceptance-lib.mjs';

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../..');

/** Explicit local development profile. No upload, production origin or mutable runtime lookup. */
export async function createBashExampleServer(configuration, options = {}) {
  const inputs = await readPinnedProbeInputs(configuration);
  const resources = new Map(), requests = [], downloads = {};
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), entry = request.method === 'GET' ? resources.get(url.pathname) : undefined;
    requests.push({ path: url.pathname, accepted: Boolean(entry), atMs: Date.now() });
    if (requests.length > 10000) requests.shift();
    if (entry && Object.hasOwn(downloads, url.pathname)) downloads[url.pathname]++;
    response.writeHead(entry ? 200 : 404, {
      'Content-Security-Policy': EXAMPLE_CSP, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Type': entry?.type ?? 'text/plain'
    });
    response.end(entry?.bytes ?? 'Not found');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(options.port ?? 0, '127.0.0.1', yes); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const distribution = manifest(origin, inputs), manifestSha256 = digest(Buffer.from(distribution));
    const parsed = JSON.parse(distribution), sdkBase = `${origin}/sdk/${inputs.receipt.packageId}`;
    const { validateDistribution } = await import('../../packages/container/dist/packages/distribution.js');
    await validateDistribution({ bytes: Buffer.from(distribution), expectedSha256: manifestSha256,
      adapterIds: ['wasi-preview1-live', 'llvm-clang-tool-host-v1'], allowedAssetURLs: parsed.packages.flatMap(pkg => pkg.assets.map(asset => asset.url)) });
    const config = {
      manifest: distribution, manifestSha256, assetURLs: parsed.packages.flatMap(pkg => pkg.assets.map(asset => asset.url)),
      sdkUrl: `${sdkBase}/index.mjs`, sdkWorkerUrl: `${sdkBase}/worker.mjs`, liveWorkerUrl: `${origin}/live-worker.mjs`, clangWorkerUrl: `${origin}/clang-worker.mjs`,
      sdkAsset: { packageId: 'shell', assetId: 'sdk' }, shellAsset: { packageId: 'shell', assetId: 'bash' }, bashWasmSha256: BASH_WASM_SHA256,
      memory: MEMORY, clangSha256: inputs.clang.assets.clang.metadata.logical.sha256, linkerSha256: inputs.clang.assets.lld.metadata.logical.sha256,
      cacheNamespace: 'container-workbench-bash', commandTimeoutMs: COMMAND_TIMEOUT_MS
    };
    const bundled = await buildWorkbenchModules({
      ownerEntry: resolve(directory, 'bash-owner.mjs'),
      profile: { profileLabel: 'Real GNU Bash · BusyBox · Clang · persistent workspace', terminalDescription: 'Actual /bin/bash --noprofile --norc reads these bytes as its script. External commands use the common container workspace. Raw streams; no PTY or job control.' },
      sdkImportURL: new URL(`${sdkBase}/index.mjs`).pathname,
      entries: { 'clang-worker': resolve(root, 'packages/container/src/adapters/clang/worker.ts') }, define: { __CONTAINER_BASH_CONFIG__: JSON.stringify(config) }
    });
    for (const [name, entry] of bundled.resources) resources.set(name, entry);
    for (const name of ['index.mjs', 'worker.mjs']) resources.set(new URL(`${sdkBase}/${name}`).pathname, { type: 'text/javascript', bytes: inputs.entries.get(name) });
    const bytesByAsset = new Map([['sdk', inputs.entries.get('wasmer_js_bg.wasm')], ['bash', inputs.bash], ['busybox', inputs.busybox], ...Object.entries(inputs.clang.assets).map(([name, asset]) => [name, asset.delivery])]);
    for (const pkg of parsed.packages) for (const asset of pkg.assets) {
      const bytes = bytesByAsset.get(asset.id); assert(bytes, `No pinned bytes for ${asset.id}`);
      assert.deepEqual(identity(bytes), { bytes: asset.delivery.bytes, sha256: asset.delivery.sha256 });
      const path = new URL(asset.url).pathname; resources.set(path, { type: asset.delivery.mediaType, bytes }); downloads[path] = 0;
    }
    resources.set('/distribution.json', { type: 'application/json', bytes: Buffer.from(distribution) });
    const sourceHashes = { ...bundled.sourceHashes };
    sourceHashes[relative(root, resolve(inputs.packageRoot, 'index.mjs'))] = inputs.receipt.entries['index.mjs'].sha256;
    for (const path of ['examples/container/serve-bash.mjs', 'examples/container/serve.mjs', 'scripts/probe-container-shell-acceptance.mjs', 'scripts/probe-container-shell-acceptance-lib.mjs', 'scripts/probe-patched-container-shell-lib.mjs', 'packages/container/scripts/clang-browser-inputs.mjs']) sourceHashes[path] = digest(await readFile(resolve(root, path)));
    return { origin, server, config, inputs, requests, downloads, sourceHashes: Object.freeze(sourceHashes), async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Use node examples/container/serve-bash.mjs /absolute/path/to/pinned-shell-config.json');
  const configuration = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const example = await createBashExampleServer(configuration, { port: Number(process.env.PORT ?? 4174) });
  console.log(`Real Bash container workbench: ${example.origin}`);
  const close = async () => { await example.close(); process.exit(0); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
