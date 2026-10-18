import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateDistribution } from '../../dist/packages/distribution.js';
import { createContainerPackageManager } from '../../dist/packages/manager.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const payloads = {
  sysroot: new TextEncoder().encode('#define ANSWER 42\n'),
  tools: Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const assetURL = (name) => `https://assets.example.test/${name}-${hash(payloads[name])}`;
async function distribution(capabilities = []) {
  const manifest = {
    schemaVersion: 1, distributionId: 'test-1',
    packages: ['sysroot', 'tools'].map((id) => ({
      id, identity: `sha256:${hash(payloads[id])}`,
      producer: { repository: 'https://github.com/seo-rii/wasm-llvm', revision: 'b'.repeat(40), receiptSha256: hash(payloads[id]) },
      dependencies: id === 'tools' ? ['sysroot'] : [], mount: `/opt/toolchains/${id}`, capabilities,
      assets: [{ id: 'body', url: assetURL(id), encoding: 'identity', ...Object.fromEntries(['delivery', 'logical'].map((kind) => [kind, { sha256: hash(payloads[id]), bytes: payloads[id].byteLength, mediaType: 'application/octet-stream' }])) }],
      files: [{ path: id === 'tools' ? 'bin/tool' : 'include/std.h', asset: 'body', executable: id === 'tools' }]
    })), commands: [{ name: 'clang', package: 'tools', adapter: 'clang', path: 'bin/tool', argv0: 'clang', prefixArgs: ['--target=wasm32-wasi'] }]
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return validateDistribution({ bytes, expectedSha256: hash(bytes), adapterIds: ['clang'], allowedAssetURLs: Object.keys(payloads).map(assetURL) });
}
function response(url, corrupt = false) {
  const id = Object.keys(payloads).find((id) => assetURL(id) === url);
  const result = new Response(corrupt ? new Uint8Array(payloads[id].byteLength) : payloads[id], { headers: { 'content-type': 'application/octet-stream' } });
  Object.defineProperty(result, 'url', { value: url }); return result;
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('PKG-01/02: command lookup performs no fetch; first command prepares a dependency-first readonly closure', async () => {
  const requested = [];
  const manager = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch: async (url) => { requested.push(url); return response(url); } });
  assert.equal(manager.listCommands().length, 1);
  assert.equal(manager.resolveCommand('/usr/bin/clang').argv0, 'clang');
  assert.equal(manager.resolveCommand('unknown'), undefined); assert.equal(requested.length, 0);
  const prepared = await manager.prepareCommand('clang');
  assert.deepEqual(prepared.packages.map((pkg) => pkg.id), ['sysroot', 'tools']);
  assert.deepEqual(requested, [assetURL('sysroot'), assetURL('tools')]);
  assert.equal(prepared.executablePath, '/opt/toolchains/tools/bin/tool');
  assert.deepEqual(prepared.executable, payloads.tools);
  assert.equal(prepared.packages[0].files[0].executable, false);
  assert.ok(Object.isFrozen(prepared.packages));
  assert.ok(Object.isFrozen(prepared.packages[1].files[0]));
  assert.equal(manager.inspect().preparingBytes, 0);
  await manager.dispose();
});

test('prepared bytes and aliases cannot mutate the cache, executable or subsequent package generations', async () => {
  let calls = 0;
  const manager = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch: async (url) => { calls++; return response(url); } });
  const first = await manager.prepareCommand('clang');
  first.packages[1].files[0].bytes.fill(255);
  assert.deepEqual(first.executable, payloads.tools);
  first.executable.fill(254);
  const second = await manager.prepareCommand('/usr/bin/clang');
  assert.deepEqual(second.executable, payloads.tools);
  assert.deepEqual(second.packages[1].files[0].bytes, payloads.tools);
  assert.equal(calls, 2); assert.equal(manager.inspect().assets.memoryCacheHits, 2);
  await manager.dispose();
});

test('PKG-08: a corrupt dependency closure never publishes a partial preparation and retry succeeds', async () => {
  const published = []; let corrupt = true;
  const manager = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch: async (url) => response(url, corrupt && url === assetURL('tools')) });
  await assert.rejects(manager.prepareCommand('clang').then((value) => { published.push(value); }), { code: 'INTEGRITY' });
  assert.deepEqual(published, []); assert.deepEqual(manager.inspect().pendingPackages, []); assert.equal(manager.inspect().preparingBytes, 0);
  corrupt = false; published.push(await manager.prepareCommand('clang'));
  assert.equal(published[0].packages.length, 2);
  await manager.dispose();
});

test('capabilities, missing command/package and preparation budgets fail before network work', async () => {
  let calls = 0; const fetch = async (url) => { calls++; return response(url); };
  const manager = createContainerPackageManager({ distribution: await distribution(['threads']), persistentCache: false, fetch });
  assert.equal(manager.resolveCommand('clang').name, 'clang');
  await assert.rejects(manager.prepareCommand('clang'), { code: 'UNSUPPORTED_PROFILE' });
  await assert.rejects(manager.prepareCommand('missing'), { code: 'COMMAND_NOT_FOUND' });
  await assert.rejects(manager.prepare('missing'), { code: 'INVALID_DISTRIBUTION' });
  await manager.dispose();
  const budget = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch, maxPreparingBytes: 1 });
  await assert.rejects(budget.prepareCommand('clang'), { code: 'RESOURCE_LIMIT' });
  await budget.dispose(); assert.equal(calls, 0);
});

test('concurrent preparations share each asset but retain separate cancellation and owned file results', async () => {
  const started = deferred(); const release = deferred(); let calls = 0; let networkSignal;
  const manager = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch: async (url, options) => {
    calls++; networkSignal = options.signal; started.resolve(); await release.promise; return response(url);
  } });
  const controller = new AbortController();
  const first = manager.prepareCommand('clang', { signal: controller.signal });
  const second = manager.prepareCommand('clang');
  const failure = assert.rejects(first, { code: 'ABORTED' });
  await started.promise; controller.abort(); await failure;
  assert.equal(networkSignal.aborted, false); release.resolve();
  assert.equal((await second).packages.length, 2); assert.equal(calls, 2);
  assert.deepEqual(manager.inspect().pendingPackages, []); await manager.dispose();
});

test('dispose cancels all preparations, settles once and leaves no pending bytes or requests', async () => {
  const started = deferred();
  const manager = createContainerPackageManager({ distribution: await distribution(), persistentCache: false, fetch: async () => { started.resolve(); return new Promise(() => {}); } });
  const preparing = manager.prepareCommand('clang'); const failure = assert.rejects(preparing, { code: 'ABORTED' });
  await started.promise;
  assert.equal(manager.inspect().pendingPackages.length, 1); assert.ok(manager.inspect().preparingBytes > 0);
  const disposed = manager.dispose(); assert.equal(manager.dispose(), disposed); await disposed; await failure;
  assert.deepEqual(manager.inspect().pendingPackages, []); assert.equal(manager.inspect().preparingBytes, 0); assert.equal(manager.inspect().assets.pendingRequests, 0);
  assert.throws(() => manager.resolveCommand('clang'), { code: 'DISPOSED' });
  await assert.rejects(manager.prepareCommand('clang'), { code: 'DISPOSED' });
});

test('host capability arrays and preparation signals are snapshotted', async () => {
  const capabilities = ['wasi']; const started = deferred();
  const manager = createContainerPackageManager({ distribution: await distribution(['wasi']), capabilities, persistentCache: false, fetch: async () => { started.resolve(); return new Promise(() => {}); } });
  capabilities.length = 0;
  const controller = new AbortController(); const request = { signal: controller.signal };
  const preparing = manager.prepareCommand('clang', request); const failure = assert.rejects(preparing, { code: 'ABORTED' });
  request.signal = undefined; await started.promise; controller.abort(); await failure;
  await manager.dispose();
});
