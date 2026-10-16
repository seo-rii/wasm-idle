import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { validateDistribution } from '../../dist/packages/distribution.js';
import { createVerifiedAssetLoader } from '../../dist/packages/assets.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const url = 'https://assets.example.test/pinned/tool.wasm';
const payload = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = (bytes, mediaType) => ({ sha256: hash(bytes), bytes: bytes.byteLength, mediaType });
async function distribution(options = {}) {
  const delivery = options.delivery ?? payload;
  const logical = options.logical ?? payload;
  const manifest = {
    schemaVersion: 1, distributionId: 'test-1',
    packages: [{ id: 'tools', identity: `sha256:${hash(delivery)}`,
      producer: { repository: 'https://github.com/seo-rii/wasm-llvm', revision: 'b'.repeat(40), receiptSha256: hash(delivery) },
      dependencies: [], mount: '/opt/toolchains/test', capabilities: [],
      assets: [{ id: 'tool', url, encoding: options.encoding ?? 'identity', delivery: receipt(delivery, options.encoding === 'gzip' ? 'application/gzip' : 'application/wasm'), logical: receipt(logical, 'application/wasm') }],
      files: [{ path: 'bin/tool', asset: 'tool', executable: true }]
    }], commands: [{ name: 'tool', package: 'tools', adapter: 'wasi', path: 'bin/tool', argv0: 'tool', prefixArgs: [] }]
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return validateDistribution({ bytes, expectedSha256: hash(bytes), adapterIds: ['wasi'], allowedAssetURLs: [url] });
}

function response(bytes = payload, options = {}) {
  const result = new Response(bytes, { status: options.status ?? 200, headers: { 'content-type': options.mime ?? 'application/wasm', ...options.headers } });
  Object.defineProperty(result, 'url', { value: options.url ?? url });
  if (options.redirected) Object.defineProperty(result, 'redirected', { value: true });
  return result;
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('PKG-03: verified bytes are reused and callers cannot mutate the cache', async () => {
  let requests = 0;
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async (requested, options) => {
    requests++; assert.equal(requested, url); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
    return response();
  } });
  const first = await loader.load('tools', 'tool'); first.fill(255);
  assert.deepEqual(await loader.load('tools', 'tool'), payload);
  assert.equal(requests, 1);
  assert.equal(loader.inspect().memoryCacheHits, 1);
  assert.equal(loader.inspect().consumers, 0);
  await loader.dispose();
});

test('PKG-04: one consumer cancel preserves another consumer and exactly one underlying fetch', async () => {
  const started = deferred(); const release = deferred(); let requests = 0; let networkSignal;
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async (_url, options) => {
    requests++; networkSignal = options.signal; started.resolve(); await release.promise; return response();
  } });
  const cancel = new AbortController();
  const first = loader.load('tools', 'tool', { signal: cancel.signal });
  const second = loader.load('tools', 'tool');
  const canceled = assert.rejects(first, { code: 'ABORTED' });
  await started.promise; cancel.abort(); await canceled;
  assert.equal(networkSignal.aborted, false); assert.equal(requests, 1);
  release.resolve(); assert.deepEqual(await second, payload);
  assert.equal(loader.inspect().pendingRequests, 0); assert.equal(loader.inspect().consumers, 0);
  await loader.dispose();
});

test('the last cancellation stops fetch and a new generation can retry despite a late old response', async () => {
  const started = deferred(); const late = deferred(); let requests = 0; let networkSignal;
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async (_url, options) => {
    requests++;
    if (requests === 1) { networkSignal = options.signal; started.resolve(); await late.promise; }
    return response();
  } });
  const signal = new AbortController();
  const first = loader.load('tools', 'tool', { signal: signal.signal });
  const failure = assert.rejects(first, { code: 'ABORTED' });
  await started.promise; signal.abort(); await failure;
  assert.equal(networkSignal.aborted, true);
  assert.deepEqual(await loader.load('tools', 'tool'), payload);
  late.resolve(); await new Promise((r) => setImmediate(r));
  assert.equal(requests, 2); assert.equal(loader.inspect().pendingRequests, 0);
  await loader.dispose();
});

test('PKG-05: hash/size/MIME/exact URL/redirect/206 rejection never populates logical cache', async () => {
  for (const makeResponse of [
    () => response(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])),
    () => response(payload.subarray(0, 7)),
    () => response(payload, { mime: 'text/plain' }),
    () => response(payload, { url: `${url}?different` }),
    () => response(payload, { redirected: true }),
    () => response(payload, { status: 206 }),
    () => response(payload, { headers: { 'content-length': 'broken' } })
  ]) {
    let calls = 0;
    const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async () => { calls++; return calls === 1 ? makeResponse() : response(); } });
    await assert.rejects(loader.load('tools', 'tool'));
    assert.equal(loader.inspect().cachedEntries, 0); assert.equal(loader.inspect().pendingRequests, 0);
    assert.deepEqual(await loader.load('tools', 'tool'), payload);
    assert.equal(calls, 2); await loader.dispose();
  }
});

test('gzip delivery and logical byte identities are independently verified and bounded', async () => {
  const compressed = new Uint8Array(gzipSync(payload));
  const good = createVerifiedAssetLoader({ distribution: await distribution({ delivery: compressed, encoding: 'gzip' }), persistentCache: false, fetch: async () => response(compressed, { mime: 'application/gzip' }) });
  assert.deepEqual(await good.load('tools', 'tool'), payload);
  await good.dispose();
  for (const logical of [new Uint8Array(8), payload.subarray(0, 7), new Uint8Array(9)]) {
    const bad = createVerifiedAssetLoader({ distribution: await distribution({ delivery: compressed, logical, encoding: 'gzip' }), persistentCache: false, fetch: async () => response(compressed, { mime: 'application/gzip' }) });
    await assert.rejects(bad.load('tools', 'tool'), { code: 'INTEGRITY' });
    assert.equal(bad.inspect().cachedEntries, 0); await bad.dispose();
  }
  const wrongMime = createVerifiedAssetLoader({ distribution: await distribution({ delivery: compressed, encoding: 'gzip' }), persistentCache: false, fetch: async () => response(compressed) });
  await assert.rejects(wrongMime.load('tools', 'tool'), { code: 'INTEGRITY' }); await wrongMime.dispose();
});

test('PKG-06/07: unavailable storage permits verified execution; offline miss identifies the pin', async () => {
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: { enabled: true }, fetch: async () => response() });
  assert.deepEqual(await loader.load('tools', 'tool'), payload); await loader.dispose();
  const offline = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.load('tools', 'tool'), (error) => error.code === 'STARTUP_FAILED' && error.message.includes(hash(payload)) && error.message.includes(url));
  await offline.dispose();
});

test('loader budgets, forgery, abort-before-load and idempotent disposal fail predictably', async () => {
  assert.throws(() => createVerifiedAssetLoader({ distribution: {} }), { code: 'INVALID_DISTRIBUTION' });
  const verified = await distribution();
  assert.throws(() => createVerifiedAssetLoader({ distribution: verified, maxCachedBytes: -1 }), { code: 'INVALID_ARGUMENT' });
  const started = deferred();
  const loader = createVerifiedAssetLoader({ distribution: verified, persistentCache: false, maxConsumers: 1, fetch: async () => { started.resolve(); return new Promise(() => {}); } });
  const signal = new AbortController(); signal.abort();
  await assert.rejects(loader.load('tools', 'tool', { signal: signal.signal }), { code: 'ABORTED' });
  const pending = loader.load('tools', 'tool');
  const failure = assert.rejects(pending, { code: 'ABORTED' });
  await started.promise;
  await assert.rejects(loader.load('tools', 'tool'), { code: 'RESOURCE_LIMIT' });
  const disposed = loader.dispose(); assert.equal(loader.dispose(), disposed);
  await disposed; await failure;
  assert.equal(loader.inspect().consumers, 0);
  await assert.rejects(loader.load('tools', 'tool'), { code: 'DISPOSED' });
});

test('memory caching can be disabled independently of persistent storage', async () => {
  let calls = 0;
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, maxCachedBytes: 0, fetch: async () => { calls++; return response(); } });
  await loader.load('tools', 'tool'); await loader.load('tools', 'tool');
  assert.equal(calls, 2); assert.equal(loader.inspect().cachedBytes, 0); await loader.dispose();
});

test('cancellation uses the original signal even when request options mutate', async () => {
  const started = deferred();
  const loader = createVerifiedAssetLoader({ distribution: await distribution(), persistentCache: false, fetch: async () => { started.resolve(); return new Promise(() => {}); } });
  const controller = new AbortController(); const options = { signal: controller.signal };
  const result = loader.load('tools', 'tool', options);
  const failure = assert.rejects(result, { code: 'ABORTED' });
  options.signal = new AbortController().signal;
  await started.promise; controller.abort(); await failure;
  await loader.dispose(); assert.equal(loader.inspect().pendingRequests, 0);
});
