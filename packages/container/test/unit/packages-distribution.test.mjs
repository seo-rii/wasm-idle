import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateDistribution } from '../../dist/packages/distribution.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = 'a'.repeat(64);
const url = 'https://assets.example.test/pinned/tool.wasm';
const fixture = () => ({
  schemaVersion: 1, distributionId: 'test-1',
  packages: [{
    id: 'tools', identity: `sha256:${sha}`,
    producer: { repository: 'https://github.com/seo-rii/wasm-llvm', revision: 'b'.repeat(40), receiptSha256: sha },
    dependencies: [], mount: '/opt/toolchains/test', capabilities: ['wasi-preview1'],
    assets: [{ id: 'tool', url, encoding: 'identity', delivery: { sha256: sha, bytes: 8, mediaType: 'application/wasm' }, logical: { sha256: sha, bytes: 8, mediaType: 'application/wasm' } }],
    files: [{ path: 'bin/tool', asset: 'tool', executable: true }]
  }],
  commands: [{ name: 'tool', package: 'tools', adapter: 'wasi', path: 'bin/tool', argv0: 'tool', prefixArgs: [] }]
});
const validate = (manifest, options = {}) => {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return validateDistribution({ bytes, expectedSha256: hash(bytes), adapterIds: ['wasi'], allowedAssetURLs: [url], ...options });
};

test('PKG-01: pinned metadata validates and freezes without downloading asset bodies', async () => {
  const manifest = fixture();
  const result = await validate(manifest);
  manifest.packages[0].assets[0].url = 'https://wrong.test/';
  assert.equal(result.packages[0].assets[0].url, url);
  assert.ok(Object.isFrozen(result.packages[0].assets[0].delivery));
  assert.ok(Object.isFrozen(result.commands[0].prefixArgs));
  assert.equal(result.sha256.length, 64);
});

test('distribution bytes and application allowlists are snapshotted before asynchronous verification', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(fixture()));
  const urls = [url]; const adapters = ['wasi'];
  const pending = validateDistribution({ bytes, expectedSha256: hash(bytes), adapterIds: adapters, allowedAssetURLs: urls });
  bytes.fill(0); urls.length = 0; adapters.length = 0;
  assert.equal((await pending).commands[0].name, 'tool');
});

test('an application digest is required and an untrusted manifest digest cannot authenticate itself', async () => {
  await assert.rejects(validate(fixture(), { expectedSha256: '0'.repeat(64) }), { code: 'INTEGRITY' });
  await assert.rejects(validate(fixture(), { expectedSha256: '' }), { code: 'INVALID_DISTRIBUTION' });
  const manifest = fixture(); manifest.sha256 = sha;
  await assert.rejects(validate(manifest), { code: 'INVALID_DISTRIBUTION' });
});

test('malformed schema, mutable identities, unknown dependencies/adapters and cycles fail closed', async () => {
  for (const mutate of [
    (m) => { m.schemaVersion = 2; },
    (m) => { m.packages[0].identity = 'latest'; },
    (m) => { m.packages[0].producer.revision = 'main'; },
    (m) => { m.packages[0].dependencies = ['missing']; },
    (m) => { m.packages[0].dependencies = ['tools']; },
    (m) => { m.commands[0].adapter = 'https://arbitrary.test/host.js'; },
    (m) => { m.commands[0].adapter = 'javascript'; },
    (m) => { m.packages[0].files[0].executable = false; },
    (m) => { m.commands.push(m.commands[0]); },
    (m) => { m.packages[0].assets[0].encoding = 'tar'; }
  ]) {
    const manifest = fixture(); mutate(manifest);
    await assert.rejects(validate(manifest), { code: 'INVALID_DISTRIBUTION' });
  }
});

test('PKG-08: path escape, duplicate paths, file/directory and mount conflicts reject before fetch', async () => {
  for (const path of ['/abs', '../escape', 'a/../escape', 'a//b', 'a/./b', 'a/', '', 'x\0y', '\ud800']) {
    const manifest = fixture(); manifest.packages[0].files[0].path = path;
    await assert.rejects(validate(manifest), { code: 'INVALID_DISTRIBUTION' });
  }
  for (const path of ['bin/tool', 'bin/tool/child', 'bin']) {
    const manifest = fixture(); manifest.packages[0].files.push({ path, asset: 'tool', executable: false });
    await assert.rejects(validate(manifest), { code: 'INVALID_DISTRIBUTION' });
  }
  const overlap = fixture(); overlap.packages.push({ ...overlap.packages[0], id: 'other', mount: '/opt/toolchains/test/child' });
  await assert.rejects(validate(overlap), { code: 'INVALID_DISTRIBUTION' });
  const writable = fixture(); writable.packages[0].mount = '/workspace';
  await assert.rejects(validate(writable), { code: 'INVALID_DISTRIBUTION' });
});

test('backslash remains an ordinary POSIX filename character', async () => {
  const manifest = fixture(); manifest.packages[0].files[0].path = 'bin/a\\b'; manifest.commands[0].path = 'bin/a\\b';
  assert.equal((await validate(manifest)).commands[0].path, 'bin/a\\b');
});

test('URLs are exact allowlisted, canonical, fragment-free and credential-free', async () => {
  for (const badURL of ['https://assets.example.test/pinned/other', `${url}#fragment`, 'https://user:secret@assets.example.test/pinned/tool.wasm', 'file:///tmp/tool.wasm', 'https://assets.example.test/pinned/../pinned/tool.wasm']) {
    const manifest = fixture(); manifest.packages[0].assets[0].url = badURL;
    await assert.rejects(validate(manifest), { code: 'INVALID_DISTRIBUTION' });
  }
});

test('all index allocations have explicit byte/count/depth limits', async () => {
  for (const limits of [{ maxManifestBytes: 1 }, { maxAssetBytes: 7 }, { maxFileBytes: 7 }, { maxTotalAssetBytes: 15 }, { maxTotalFileBytes: 7 }, { maxPathDepth: 2 }, { maxFiles: -1 }, { maxPackages: Infinity }]) {
    await assert.rejects(validate(fixture(), { limits }), { code: 'INVALID_DISTRIBUTION' });
  }
  const manifest = fixture();
  for (let n = 1; n < 4; n++) manifest.packages.push({ ...manifest.packages[0], id: `pkg${n}`, mount: `/opt/toolchains/pkg${n}`, dependencies: [n === 1 ? 'tools' : `pkg${n - 1}`] });
  await assert.rejects(validate(manifest, { limits: { maxDependencyDepth: 3 } }), { code: 'INVALID_DISTRIBUTION' });
  await validate(manifest, { limits: { maxDependencyDepth: 4 } });
});
