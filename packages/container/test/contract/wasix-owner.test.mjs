import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { serveContainerOwner, createContainerOwnerClient } from '../../dist/adapters/wasix/index.js';
import { workerFactory } from './node-worker.mjs';
const live = new Uint8Array(readFileSync(new URL('../fixtures/live.wasm', import.meta.url)));
const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);

function owner(settings = {}, clientOptions = {}) {
  const container = createContainer({ adapters: [createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') })], commands: { fixture: { adapter: 'wasi-preview1-live', bytes: live } } });
  const channel = new MessageChannel(); let cacheClears = 0;
  const server = serveContainerOwner(channel.port1, {
    container,
    // This is a real WASI transport contract, not a Bash implementation or proof.
    async startShell(options, signal) {
      const process = await container.spawn('fixture', options.args ?? [], { cwd: options.cwd, env: options.env, signal });
      return { ...process, interrupt() { void process.terminate(); return 1; }, dispose: process.terminate };
    },
    clearAssetCache: async () => { cacheClears++; return { cleared: true }; }, ...settings
  });
  const client = createContainerOwnerClient(channel.port2, clientOptions);
  return { container, server, client, get cacheClears() { return cacheClears; } };
}

test('owner RPC preserves real WASI binary streaming with simultaneous stdout/stderr draining', { timeout: 30000 }, async () => {
  const fixture = owner(), { client } = fixture;
  try {
    const session = await client.startShell();
    const output = new Response(session.stdout).arrayBuffer(), errors = new Response(session.stderr).arrayBuffer();
    const writer = session.stdin.getWriter(), bytes = Uint8Array.from({ length: 200003 }, (_, i) => i % 256);
    for (let at = 0; at < bytes.length; at += 65536) await writer.write(bytes.subarray(at, at + 65536));
    await writer.close(); writer.releaseLock();
    assert.deepEqual(new Uint8Array(await output), bytes); assert.equal((await errors).byteLength, 0);
    assert.deepEqual(await session.exited, { code: 0, reason: 'exited' });
    assert.equal((await client.inspect()).processes.length, 0);
  } finally { await client.dispose(); }
});

test('owner filesystem compare-write protects editor bytes and backup/cache actions stay separate', { timeout: 30000 }, async () => {
  const fixture = owner(), { client, container } = fixture;
  try {
    await client.fs.mkdir('/workspace/demo');
    await client.fs.writeFile('/workspace/demo/main.c', encode('original'));
    const base = await client.fs.readFile('/workspace/demo/main.c');
    container.fs.writeFile('/workspace/demo/main.c', encode('external edit'));
    await assert.rejects(client.fs.writeFile('/workspace/demo/main.c', encode('my edit'), base), { code: 'ECONFLICT' });
    assert.equal(decode((await client.fs.readFile('/workspace/demo/main.c')).bytes), 'external edit');
    const current = await client.fs.readFile('/workspace/demo/main.c');
    await client.fs.writeFile('/workspace/demo/main.c', encode('saved edit'), current);
    assert.deepEqual(await client.fs.readdir('/workspace/demo'), [{ name: 'main.c', type: 'file' }]);
    const archive = await client.backup();
    await client.fs.unlink('/workspace/demo/main.c');
    await assert.rejects(client.restore(archive, { replace: false }), { code: 'INVALID_ARGUMENT' });
    await client.restore(archive, { replace: true });
    assert.equal(decode((await client.fs.readFile('/workspace/demo/main.c')).bytes), 'saved edit');
    assert.deepEqual(await client.clearAssetCache(), { cleared: true }); assert.equal(fixture.cacheClears, 1);
    assert.equal(decode((await client.fs.readFile('/workspace/demo/main.c')).bytes), 'saved edit', 'asset cleanup cannot delete the workspace');
    await assert.rejects(client.fs.readFile('/workspace/../tmp/outside'), { code: 'EACCES' });
    container.fs.writeFile('/tmp/outside', encode('private'));
    container.fs.symlink('/tmp/outside', '/workspace/escape');
    const outside = { inode: container.fs.stat('/tmp/outside').inode, bytes: encode('private') };
    for (const path of ['/workspace/../tmp/outside', '/workspace/escape']) {
      await assert.rejects(client.fs.writeFile(path, encode('overwrite'), outside), { code: 'EACCES' });
    }
    assert.equal(decode(container.fs.readFile('/tmp/outside')), 'private');
    await assert.rejects(client.flush(), { code: 'UNSUPPORTED_PROFILE' });
    await assert.rejects(client.setAutosave(true), { code: 'UNSUPPORTED_PROFILE' });
  } finally { await client.dispose(); }
});

test('owner interrupt remains available with pending output reads and exit', { timeout: 30000 }, async () => {
  const { client } = owner({ maxPendingRequests: 3 });
  try {
    const session = await client.startShell({ args: ['loop'] });
    const stdout = session.stdout.getReader().read().catch(error => ({ error }));
    const stderr = session.stderr.getReader().read().catch(error => ({ error }));
    assert.equal(await session.interrupt(), 1);
    assert.equal((await session.exited).reason, 'terminated');
    await Promise.all([stdout, stderr]);
  } finally { await client.dispose(); }
});

test('dispose cancels owner startup and releases the port without waiting for user input', { timeout: 30000 }, async () => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const { client, container } = owner({ startShell(options, signal) {
    assert.deepEqual(options, {}, 'omitted options preserve the trusted profile defaults');
    started();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { code: 'ABORTED' })), { once: true }));
  } });
  const pending = client.startShell(); void pending.catch(() => {}); await entered;
  await client.dispose(); await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal((await container.inspect()).disposed, true);
});

test('owner rejects oversized frames before filesystem mutation', { timeout: 30000 }, async () => {
  const { client, container } = owner({ maxFileBytes: 4 });
  try {
    await assert.rejects(client.fs.writeFile('/workspace/large', encode('12345')), { code: 'RESOURCE_LIMIT' });
    assert.throws(() => container.fs.stat('/workspace/large'), { code: 'ENOENT' });
    await client.fs.writeFile('/workspace/small', encode('1234'));
    assert.equal(decode((await client.fs.readFile('/workspace/small')).bytes), '1234');
  } finally { await client.dispose(); }
});

test('owner lifetime failure rejects blocked I/O and exit while reporting cleanup unconfirmed', { timeout: 30000 }, async () => {
  const lifetime = new AbortController(), failures = [];
  const { client, server, container } = owner({}, { signal: lifetime.signal, onFailure: error => failures.push(error) });
  const session = await client.startShell({ args: ['loop'] });
  const output = session.stdout.getReader().read(); void output.catch(() => {});
  lifetime.abort();
  await assert.rejects(output, { code: 'ABORTED' });
  await assert.rejects(session.exited, { code: 'ABORTED' });
  assert.equal(failures.length, 1); assert.match(failures[0].message, /cleanup is unconfirmed/);
  // An independent owner acknowledgment is required to assert actual cleanup.
  await server.dispose(); assert.equal((await container.inspect()).processes.length, 0);
});

test('owner disposal is bounded when a startup hook ignores cancellation and cleans a late session', { timeout: 30000 }, async () => {
  let entered, resume, lateDisposed = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const { client, container } = owner({ startShell() { entered(); return new Promise(resolve => { resume = resolve; }); } });
  const pending = client.startShell(); void pending.catch(() => {}); await ready;
  await client.dispose(); await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal((await container.inspect()).disposed, true);
  resume({ async dispose() { lateDisposed = true; } });
  await new Promise(resolve => setImmediate(resolve)); assert(lateDisposed);
});

test('cleanup failure is reported after all owner resources receive disposal', { timeout: 30000 }, async () => {
  let persistenceDisposed = false;
  const { client, container } = owner({
    save: { dispose() { throw new Error('save owner failure'); } },
    async dispose() { persistenceDisposed = true; }
  });
  await assert.rejects(client.dispose(), { code: 'STARTUP_FAILED' });
  assert(persistenceDisposed); assert.equal((await container.inspect()).disposed, true);
});
