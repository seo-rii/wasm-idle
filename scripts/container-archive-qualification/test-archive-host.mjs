import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';


const directory = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { artifact: { type: 'string' }, 'source-root': { type: 'string' }, 'dependency-root': { type: 'string' }, work: { type: 'string' }, output: { type: 'string' } } });
for (const key of ['artifact', 'source-root', 'work', 'output']) assert(values[key], 'Required: --' + key);
const root = resolve(values.work), repository = resolve(values['source-root']), output = resolve(values.output), artifactPath = resolve(values.artifact);
await assert.rejects(access(root), { code: 'ENOENT' }, 'Existing work directory is preserved');
await assert.rejects(access(output), { code: 'ENOENT' }, 'Existing evidence is preserved');
await mkdir(root, { mode: 0o700 });
const dependencyRequire = createRequire(pathToFileURL(resolve(values['dependency-root'] ?? repository, 'package.json')));
const { build } = dependencyRequire('esbuild');
const fixtureResult = spawnSync('python3', [join(directory, 'fixtures.py'), join(root, 'fixtures')], { encoding: 'utf8', timeout: 10000 });
assert.equal(fixtureResult.status, 0, fixtureResult.stderr);
const sources = new Map();
for (const path of [fileURLToPath(import.meta.url), join(directory, 'fixtures.py')]) sources.set(path, createHash('sha256').update(await readFile(path)).digest('hex'));

const bundled = await build({ stdin: { contents: `export { MemoryFileSystem } from ${JSON.stringify(join(repository, 'packages/container/src/fs/index.ts'))};\nexport { createWasiHost } from ${JSON.stringify(join(repository, 'packages/container/src/adapters/wasi/host.ts'))};`,
  resolveDir: repository, sourcefile: 'archive-host-probe.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false, logLevel: 'silent', metafile: true, plugins: [{ name: 'record-host-sources', setup(builder) { builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => { const bytes = await readFile(path); sources.set(path, createHash('sha256').update(bytes).digest('hex')); return { contents: bytes, loader: path.endsWith('.ts') ? 'ts' : 'js' }; }); } }] });
const hostModule = join(root, 'host-bundle.mjs');
assert(Object.values(bundled.metafile.outputs).every(file => file.imports.length === 0), 'Actual host bundle must be self-contained');
await writeFile(hostModule, bundled.outputFiles[0].contents, { flag: 'wx', mode: 0o600 });
const { MemoryFileSystem, createWasiHost } = await import(pathToFileURL(hostModule).href);
const bytes = await readFile(artifactPath), module = await WebAssembly.compile(bytes);
const fixtures = Object.fromEntries(await Promise.all(['input.tar', 'input.zip', 'payload.bin', 'payload.bin.gz'].map(async name => [name, await readFile(join(root, 'fixtures', name))])));
const results = [];
const decoded = bytes => new TextDecoder().decode(bytes);

async function run(fs, name, args, stdin = new Uint8Array()) {
  const host = createWasiHost({ fs, args: [name, ...args], env: {}, cwd: '/workspace', stdin, maxOutputBytes: 2 ** 20 });
  try {
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports, wasm_idle_fs_v1: host.filesystemImports });
    return host.run(instance);
  } finally { host.dispose(); }
}
const setup = maxBytes => {
  const fs = new MemoryFileSystem({ maxBytes: maxBytes ?? 1024 * 1024 });
  for (const [name, bytes] of Object.entries(fixtures)) fs.writeFile(`/workspace/${name}`, bytes);
  return fs;
};
const passed = (id, value) => { assert.equal(value.code, 0, decoded(value.stderr)); results.push({ id, code: value.code, passed: true }); };
const failed = (id, value) => { assert.notEqual(value.code, 0); assert(value.stderr.length > 0); if (id.endsWith('-quota')) assert.match(decoded(value.stderr), /No space|quota|File too large/i); results.push({ id, code: value.code, stderr: decoded(value.stderr), passed: true }); };

{
  const fs = setup();
  // Default timestamp restoration uses the actual stage 3 host contract.
  passed('tar-content-existing-host', await run(fs, 'tar', ['-xf', 'input.tar']));
  assert.equal(decoded(fs.readFile('/workspace/tree/text.txt')), 'alpha\nbeta\n');
  assert.equal(fs.readlink('/workspace/tree/link'), 'text.txt');
  assert.equal(fs.stat('/workspace/tree/text.txt').mtimeMs, 1700000000000);
  passed('tar-create-with-real-metadata', await run(fs, 'tar', ['-cf', 'host-created.tar', 'tree']));
  const listing = await run(fs, 'tar', ['-tf', 'host-created.tar']);
  passed('tar-list-host-created', listing);
  assert(decoded(listing.stdout).includes('tree/text.txt\n'));
}
{
  const fs = setup();
  passed('unzip-content-existing-host', await run(fs, 'unzip', ['-q', 'input.zip']));
  assert.deepEqual(fs.readFile('/workspace/tree/payload.bin'), new Uint8Array(fixtures['payload.bin']));
  const old = fs.readFile('/workspace/tree/text.txt');
  failed('unzip-existing-file-conflict', await run(fs, 'unzip', ['-q', 'input.zip']));
  assert.deepEqual(fs.readFile('/workspace/tree/text.txt'), old);
}
{
  const fs = setup();
  passed('gunzip-content-existing-host', await run(fs, 'gunzip', ['-c', 'payload.bin.gz']));
  fs.mountReadonly('/opt/archive-readonly', [{ path: 'protected.txt', type: 'file', mode: 0o444, data: new TextEncoder().encode('protected') }]);
  const old = fs.readFile('/opt/archive-readonly/protected.txt');
  failed('tar-readonly', await run(fs, 'tar', ['-xf', 'input.tar', '-C', '/opt/archive-readonly']));
  failed('unzip-readonly', await run(fs, 'unzip', ['-q', 'input.zip', '-d', '/opt/archive-readonly']));
  assert.deepEqual(fs.readFile('/opt/archive-readonly/protected.txt'), old);
  assert.deepEqual(fs.readdir('/opt/archive-readonly'), ['protected.txt']);
  fs.mountReadonly('/opt/codec-readonly', [
    { path: 'payload.bin', type: 'file', mode: 0o444, data: fixtures['payload.bin'] },
    { path: 'packed.gz', type: 'file', mode: 0o444, data: fixtures['payload.bin.gz'] }
  ]);
  failed('gzip-readonly', await run(fs, 'gzip', ['-k', '/opt/codec-readonly/payload.bin']));
  failed('gunzip-readonly', await run(fs, 'gunzip', ['-k', '/opt/codec-readonly/packed.gz']));
  assert.deepEqual(fs.readFile('/opt/codec-readonly/payload.bin'), new Uint8Array(fixtures['payload.bin']));
  assert.deepEqual(fs.readFile('/opt/codec-readonly/packed.gz'), new Uint8Array(fixtures['payload.bin.gz']));
  assert.deepEqual(fs.readdir('/opt/codec-readonly').sort(), ['packed.gz', 'payload.bin']);
}
{
  // Fit inputs and existing content, then leave too little space for extraction.
  const initialSize = Object.values(fixtures).reduce((n, bytes) => n + bytes.length, 0);
  const fs = setup(initialSize + 30);
  const old = new TextEncoder().encode('preserve me');
  fs.writeFile('/workspace/existing.txt', old);
  failed('tar-quota', await run(fs, 'tar', ['-xf', 'input.tar']));
  assert.deepEqual(fs.readFile('/workspace/existing.txt'), old);
  assert(fs.byteLength <= fs.maxBytes);
}
{
  const initialSize = Object.values(fixtures).reduce((n, bytes) => n + bytes.length, 0);
  const fs = setup(initialSize + 30);
  const old = new TextEncoder().encode('preserve me');
  fs.writeFile('/workspace/existing.txt', old);
  failed('unzip-quota', await run(fs, 'unzip', ['-q', 'input.zip']));
  assert.deepEqual(fs.readFile('/workspace/existing.txt'), old);
  assert(fs.byteLength <= fs.maxBytes);
}
{
  const initialSize = Object.values(fixtures).reduce((n, bytes) => n + bytes.length, 0);
  const fs = setup(initialSize + 30);
  fs.rename('/workspace/payload.bin.gz', '/workspace/packed.gz');
  const source = fs.readFile('/workspace/packed.gz');
  failed('gunzip-quota', await run(fs, 'gunzip', ['-k', 'packed.gz']));
  assert.deepEqual(fs.readFile('/workspace/packed.gz'), source);
  assert(fs.byteLength <= fs.maxBytes);
}
{
  const initialSize = Object.values(fixtures).reduce((n, bytes) => n + bytes.length, 0);
  const fs = setup(initialSize + 30);
  fs.rename('/workspace/payload.bin', '/workspace/unpacked');
  const source = fs.readFile('/workspace/unpacked');
  failed('gzip-quota', await run(fs, 'gzip', ['-k', 'unpacked']));
  assert.deepEqual(fs.readFile('/workspace/unpacked'), source);
  assert(fs.byteLength <= fs.maxBytes);
}
assert.equal(results.length, 14);
const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(createHash('sha256').update(await readFile(artifactPath)).digest('hex'), artifactSha256, 'Artifact changed during validation');
for (const [path, sha] of sources) assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), sha, 'Host source changed');
const receipt = { complete: true, passed: true, artifactPath, sourceRoot: repository, sourceIdentities: Object.fromEntries(sources), hostBundleSha256: createHash('sha256').update(bundled.outputFiles[0].contents).digest('hex'), scope: 'Actual stage 3 batch WASI host and MemoryFileSystem with stored mode imports and default tar timestamp restoration; no browser/live qualification',
  artifactSha256: createHash('sha256').update(bytes).digest('hex'), cases: results };
await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ passed: results.length, artifactSha256: receipt.artifactSha256 }));
