import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createContainer, validateDistribution, createContainerPackageManager } from '../../dist/index.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { workerFactory, command } from './node-worker.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(options = {}) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (options.offline) { response.writeHead(503).end(); return; }
    response.setHeader('content-type', 'application/wasm'); response.end(options.corrupt ? new Uint8Array(command.length) : command);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/${hash(command)}.wasm`;
  const identity = { sha256: hash(command), bytes: command.length, mediaType: 'application/wasm' };
  const data = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, distributionId: 'actual-wasi-fixture-v1', packages: ['fixture', 'dependency', 'extended'].map(id => ({
      id, identity: `sha256:${hash(command)}`,
      // Synthetic distribution metadata for the checked-in ABI fixture, not a release receipt.
      producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: '0000000000000000000000000000000000000000', receiptSha256: hash(command) },
      dependencies: id === 'extended' ? ['dependency'] : [], mount: `/opt/toolchains/${id}`, capabilities: ['wasi-preview1'],
      assets: [{ id: 'command', url: `${url}?package=${id}`, encoding: 'identity', delivery: identity, logical: identity }],
      files: ['bin/tool', 'bin/other'].map(path => ({ path, asset: 'command', executable: true }))
    })), commands: [
      { name: 'tool', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/tool', argv0: 'tool', prefixArgs: [] },
      { name: 'alias', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/tool', argv0: 'multicall', prefixArgs: ['roundtrip', '한 글'] },
      { name: 'other', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/other', argv0: 'other', prefixArgs: ['exit'] },
      ...['dependency', 'extended'].map(id => ({ name: id, package: id, adapter: 'wasi-preview1', path: 'bin/tool', argv0: id, prefixArgs: [] }))
    ]
  }));
  const distribution = await validateDistribution({ bytes: data, expectedSha256: hash(data), adapterIds: ['wasi-preview1'], allowedAssetURLs: ['fixture', 'dependency', 'extended'].map(id => `${url}?package=${id}`) });
  const manager = createContainerPackageManager({ distribution, capabilities: ['wasi-preview1'], persistentCache: false, maxCachedBytes: options.maxCachedBytes });
  const container = createContainer({ packages: manager, adapters: [createWasiAdapter({ workerFactory })], maxBytes: options.maxBytes });
  return { container, manager, get requests() { return requests; }, async close() { await container.dispose(); await manager.dispose(); await new Promise((r) => server.close(r)); } };
}
test('PKG-01/02/03: real HTTP fetch starts on command demand and preserved verified bytes serve a second Wasm run', async () => {
  const f = await fixture();
  try {
    assert.equal(f.requests, 0); assert.equal(f.container.packages.resolveCommand('tool').name, 'tool'); assert.equal(f.requests, 0);
    assert.throws(() => f.container.fs.stat('/opt/toolchains/fixture'));
    const input = new Uint8Array([0, 255, 128, 3]);
    assert.deepEqual((await f.container.run('tool', [], { stdin: input })).stdout, input);
    assert.equal(f.requests, 1);
    assert.throws(() => f.container.fs.writeFile('/opt/toolchains/fixture/bin/tool', input), { code: 'EROFS' });
    assert.equal((await f.container.run('/usr/bin/tool', ['exit'])).code, 23); assert.equal(f.requests, 1);
    f.container.fs.writeFile('/workspace/program', command);
    assert.equal((await f.container.run('wasm-run', ['/workspace/program', 'exit'])).code, 23);
  } finally { await f.close(); }
});
test('an already mounted closure runs again without re-preparing, caching or fetching its packages', async () => {
  const options = { maxCachedBytes: 0 };
  const f = await fixture(options);
  try {
    assert.equal((await f.container.run('tool', ['exit'])).code, 23); assert.equal(f.requests, 1);
    options.offline = true;
    const result = await f.container.run('/usr/bin/tool', [], { stdin: new Uint8Array([7, 0, 9]) });
    assert.equal(result.code, 0); assert.deepEqual(result.stdout, new Uint8Array([7, 0, 9]));
    assert.equal(f.requests, 1);
    assert.equal(f.manager.inspect().assets.memoryCacheHits, 0); assert.equal(f.manager.inspect().assets.cachedEntries, 0);
  } finally { await f.close(); }
});
test('PKG-05/08: corrupt body and mount quota cannot publish executable files', async () => {
  for (const options of [{ corrupt: true }, { maxBytes: 4 }]) {
    const f = await fixture(options);
    try {
      const generation = f.container.fs.generation;
      await assert.rejects(f.container.run('tool'));
      assert.throws(() => f.container.fs.stat('/opt/toolchains/fixture'));
      assert.equal(f.container.fs.generation, generation);
      assert.equal((await f.container.inspect()).processes.length, 0);
      f.container.fs.writeFile('/workspace/edit', new Uint8Array([1]));
    } finally { await f.close(); }
  }
});

test('a new alias and another executable reuse the mounted closure with both asset caches disabled', async () => {
  const options = { maxCachedBytes: 0 };
  const f = await fixture(options);
  try {
    assert.equal(f.requests, 0);
    assert.equal((await f.container.run('tool', ['exit'])).code, 23);
    assert.equal(f.requests, 1);
    options.offline = true;
    const alias = await f.container.run('/usr/bin/alias', [''], { env: { TEST: 'alias' } });
    assert.equal(alias.code, 0);
    assert.equal(new TextDecoder().decode(alias.stdout), 'multicall\0roundtrip\0한 글\0\0');
    assert.equal(new TextDecoder().decode(alias.stderr), 'TEST=alias\0');
    assert.equal((await f.container.run('other')).code, 23);
    assert.equal(f.requests, 1);
    assert.equal(f.manager.inspect().assets.cachedEntries, 0);
    assert.equal(f.manager.inspect().assets.memoryCacheHits, 0);
    // An unrelated package must still pass preparation; mounted bytes alone do not grant readiness.
    await assert.rejects(f.container.run('extended'), { code: 'STARTUP_FAILED' });
    assert.equal(f.requests, 2);
    assert.throws(() => f.container.fs.stat('/opt/toolchains/extended'), { code: 'ENOENT' });
    assert.equal((await f.container.inspect()).processes.length, 0);
  } finally { await f.close(); }
});

test('commands in a verified transitive dependency can run without a second preparation', async () => {
  const options = { maxCachedBytes: 0 };
  const f = await fixture(options);
  try {
    assert.equal((await f.container.run('extended', ['exit'])).code, 23);
    assert.equal(f.requests, 2);
    options.offline = true;
    const bytes = new Uint8Array([0, 255, 9]);
    const result = await f.container.run('dependency', [], { stdin: bytes });
    assert.equal(result.code, 0); assert.deepEqual(result.stdout, bytes);
    assert.equal(f.requests, 2);
  } finally { await f.close(); }
});

test('failed atomic mounting does not mark an alias as ready', async () => {
  const options = { maxCachedBytes: 0, maxBytes: 4 };
  const f = await fixture(options);
  try {
    await assert.rejects(f.container.run('tool'), error => error.code === 'STARTUP_FAILED' && error.cause.code === 'ENOSPC');
    assert.equal(f.requests, 1);
    options.offline = true;
    await assert.rejects(f.container.run('alias'), { code: 'STARTUP_FAILED' });
    assert.equal(f.requests, 2);
    assert.throws(() => f.container.fs.stat('/opt/toolchains/fixture'), { code: 'ENOENT' });
  } finally { await f.close(); }
});
