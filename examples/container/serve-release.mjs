import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyContainerDistribution, digest } from '../../scripts/container-distribution.mjs';
import { EXAMPLE_CSP } from './serve.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Read-only acceptance server for an independently pinned immutable local release. */
export async function createReleaseExampleServer({ directory, expectedSha256, sourceHashes: buildSources = {} }) {
  assert(isAbsolute(directory), 'Absolute immutable release directory required');
  const verification = await verifyContainerDistribution({ directory, expectedSha256 });
  const lockPath = join(directory, 'application-lock.json'), lockBytes = await readFile(lockPath);
  assert.equal(digest(lockBytes), expectedSha256, 'Application lock changed after verification');
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const base = new URL(lock.baseURL);
  assert(base.protocol === 'http:' && base.hostname === '127.0.0.1' && base.port, 'This acceptance server binds only an explicitly pinned loopback port');
  const manifestBytes = await readFile(join(directory, lock.manifest.path));
  assert.equal(digest(manifestBytes), lock.manifest.sha256, 'Distribution manifest changed after verification');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const files = new Map(lock.files.map(file => [new URL(file.path, base).pathname, file]));
  const requests = [], downloads = {}, assetPaths = {};
  for (const pkg of manifest.packages) for (const asset of pkg.assets) {
    const path = new URL(asset.url).pathname;
    assert(new URL(asset.url).origin === base.origin, 'Local acceptance requires a same-origin immutable closure');
    assert(!Object.hasOwn(assetPaths, asset.id), 'Unique app asset identities required for browser counters');
    assetPaths[asset.id] = path; downloads[path] = 0;
  }
  const sourceHashes = { ...buildSources, [lockPath]: expectedSha256, [join(directory, lock.manifest.path)]: lock.manifest.sha256 };
  for (const file of lock.host.files) sourceHashes[join(directory, 'host', lock.host.sha256, file.path)] = file.sha256;
  sourceHashes['examples/container/serve-release.mjs'] = digest(await readFile(join(root, 'examples/container/serve-release.mjs')));
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, base), file = request.method === 'GET' ? files.get(url.pathname) : undefined;
      const record = { path: url.pathname, accepted: Boolean(file), atMs: Date.now() };
      requests.push(record); if (requests.length > 10000) requests.shift();
      const headers = { 'Content-Security-Policy': EXAMPLE_CSP, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      if (!file) { response.writeHead(404, headers).end('Not found'); return; }
      const bytes = await readFile(join(directory, file.path));
      // Native host imports do not pass through the asset loader. Serve only the
      // exact bytes already authenticated by the application lock, on every request.
      assert.equal(bytes.length, file.bytes, 'Hosting response size changed'); assert.equal(digest(bytes), file.sha256, 'Hosting response digest changed');
      if (response.destroyed) return;
      record.sha256 = file.sha256; record.bytes = bytes.length; record.mediaType = file.mediaType;
      if (Object.hasOwn(downloads, url.pathname)) downloads[url.pathname]++;
      response.writeHead(200, { ...headers, 'Content-Type': file.mediaType, 'Content-Length': bytes.length }); response.end(bytes);
    })().catch(() => {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else response.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Pinned hosting response failed validation');
    });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(Number(base.port), '127.0.0.1', yes); });
  let closing;
  return {
    origin: base.origin, startURL: new URL(`host/${lock.host.sha256}/index.html`, base).href,
    config: { manifestSha256: lock.manifest.sha256 }, sourceHashes: Object.freeze(sourceHashes), requests, downloads, assetPaths,
    qualificationContext: { kind: 'verified-immutable-local-release', directory, expectedLockSha256: expectedSha256, hostSha256: lock.host.sha256,
      manifestSha256: lock.manifest.sha256, sourceClosureReviewed: verification.sourceClosureReviewed, deployed: false },
    close() { return closing ??= (async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); })(); }
  };
}
