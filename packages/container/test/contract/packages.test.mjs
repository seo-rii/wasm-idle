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
    schemaVersion: 1, distributionId: 'actual-wasi-fixture-v1', packages: [{
      id: 'fixture', identity: `sha256:${hash(command)}`,
      // Synthetic distribution metadata for the checked-in ABI fixture, not a release receipt.
      producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: '0000000000000000000000000000000000000000', receiptSha256: hash(command) },
      dependencies: [], mount: '/opt/toolchains/fixture', capabilities: ['wasi-preview1'],
      assets: [{ id: 'command', url, encoding: 'identity', delivery: identity, logical: identity }],
      files: [{ path: 'bin/tool', asset: 'command', executable: true }]
    }], commands: [{ name: 'tool', package: 'fixture', adapter: 'wasi-preview1', path: 'bin/tool', argv0: 'tool', prefixArgs: [] }]
  }));
  const distribution = await validateDistribution({ bytes: data, expectedSha256: hash(data), adapterIds: ['wasi-preview1'], allowedAssetURLs: [url] });
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
