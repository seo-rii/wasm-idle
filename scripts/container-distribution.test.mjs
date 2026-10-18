import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { digest, jsonBytes, prepareContainerDistribution, verifyContainerDistribution } from './container-distribution.mjs';

const wasm = await readFile(new URL('../packages/container/test/fixtures/command.wasm', import.meta.url));
async function fixture(run, gzip = false) {
  const root = await mkdtemp(join(tmpdir(), 'container-distribution-'));
  try {
    const identity = bytes => ({ bytes: bytes.length, sha256: digest(bytes) });
    const receipt = jsonBytes({ fixture: 'distribution packaging only' }), source = Buffer.from('ABI fixture source pack'), notice = Buffer.from('Fixture notice');
    const body = gzip ? gzipSync(wasm, { mtime: 0 }) : wasm;
    for (const [name, bytes] of [['tool', body], ['receipt', receipt], ['source', source], ['notice', notice]]) await writeFile(join(root, name), bytes);
    const recipe = { schemaVersion: 1, baseURL: 'https://assets.example/container/', adapterIds: ['wasi-preview1'],
      distribution: { schemaVersion: 1, distributionId: 'fixture-v1', packages: [{ id: 'tools', identity: `sha256:${digest(receipt)}`,
        producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: 'a'.repeat(40), receiptSha256: digest(receipt) },
        dependencies: [], mount: '/opt/toolchains/test', capabilities: ['wasi-preview1'],
        assets: [{ id: 'tool', url: 'https://replaced.invalid/tool', encoding: gzip ? 'gzip' : 'identity',
          delivery: { ...identity(body), mediaType: gzip ? 'application/gzip' : 'application/wasm' },
          logical: { ...identity(wasm), mediaType: 'application/wasm' } }],
        files: [{ path: 'bin/tool', asset: 'tool', executable: true }] }],
        commands: [{ name: 'tool', package: 'tools', adapter: 'wasi-preview1', path: 'bin/tool', argv0: 'tool', prefixArgs: [] }] },
      inputs: [{ package: 'tools', asset: 'tool', path: 'tool' }],
      provenance: [{ package: 'tools', license: 'MIT', sourceStatus: 'incomplete', receipt: { path: 'receipt', ...identity(receipt) },
        sources: [{ path: 'source', ...identity(source) }], notices: [{ path: 'notice', ...identity(notice) }] }],
      hostFiles: [] };
    const input = join(root, 'recipe.json'), output = join(root, 'release');
    const save = () => writeFile(input, jsonBytes(recipe)); await save();
    await run({ root, recipe, input, output, save });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('identical pinned inputs produce identical locks independently of local output paths', () => fixture(async ({ root, input, output }) => {
  const first = await prepareContainerDistribution({ input, output });
  const second = await prepareContainerDistribution({ input, output: join(root, 'another-release') });
  assert.equal(first.lockSha256, second.lockSha256);
  assert.equal(first.verified, true); assert.equal(first.sourceClosureReviewed, false);
  assert.equal(first.qualification, 'local-byte-closure-only'); assert.equal(first.deployed, false);
  assert.deepEqual(await readFile(join(output, 'application-lock.json')), await readFile(join(root, 'another-release/application-lock.json')));
  const lock = JSON.parse(await readFile(join(output, 'application-lock.json')));
  assert(lock.allowedAssetURLs.every(url => url.startsWith('https://assets.example/container/objects/')));
}));

test('gzip delivery and logical identities are both verified', () => fixture(async ({ input, output }) => {
  const result = await prepareContainerDistribution({ input, output });
  assert.equal((await verifyContainerDistribution({ directory: output, expectedSha256: result.lockSha256 })).verified, true);
}, true));

test('verification requires the application-provided lock digest', () => fixture(async ({ input, output }) => {
  await prepareContainerDistribution({ input, output });
  await assert.rejects(verifyContainerDistribution({ directory: output, expectedSha256: '0'.repeat(64) }), /lock integrity/);
}));

test('a changed packaged body fails the complete closure check', () => fixture(async ({ input, output }) => {
  const result = await prepareContainerDistribution({ input, output });
  const lock = JSON.parse(await readFile(join(output, 'application-lock.json')));
  const object = lock.files.find(entry => entry.mediaType === 'application/wasm');
  const bytes = await readFile(join(output, object.path)); bytes[bytes.length - 1] ^= 1;
  await writeFile(join(output, object.path), bytes);
  await assert.rejects(verifyContainerDistribution({ directory: output, expectedSha256: result.lockSha256 }), /Input identity/);
}));

test('missing notices leave no partial release and never replace a previous output', () => fixture(async ({ recipe, input, output, save }) => {
  recipe.provenance[0].notices = []; await save();
  await assert.rejects(prepareContainerDistribution({ input, output }), /notices inventory/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
  await writeFile(output, 'previous output');
  await assert.rejects(prepareContainerDistribution({ input, output }), { code: 'EEXIST' });
  assert.equal(await readFile(output, 'utf8'), 'previous output');
}));

test('unsupported adapter IDs fail before writing a release', () => fixture(async ({ recipe, input, output, save }) => {
  recipe.adapterIds = []; await save();
  await assert.rejects(prepareContainerDistribution({ input, output }));
  await assert.rejects(stat(output), { code: 'ENOENT' });
}));
