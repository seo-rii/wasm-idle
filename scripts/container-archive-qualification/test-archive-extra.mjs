import assert from 'node:assert/strict';
import { WASI } from 'node:wasi';
import { parseArgs } from 'node:util';
import { createNodeWasiMetadata } from '../../runtimes/wasm-busybox/test/node-wasi-fixture.mjs';
import { directoryTarHex, directoryTreeTarHex, duplicateDirectoryTarHex, storedBadCrcZipHex, DIRECTORY_ARCHIVE_MTIME_MS, DIRECTORY_LAST_ARCHIVE_MTIME_MS } from '../../runtimes/wasm-busybox/test/archive-regression-fixtures.mjs';
import { readFileSync, writeFileSync, mkdirSync, cpSync, openSync, closeSync, symlinkSync, readlinkSync, existsSync, readdirSync, lstatSync, utimesSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const directory = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { artifact: { type: 'string' }, native: { type: 'string' }, work: { type: 'string' }, output: { type: 'string' } } });
for (const key of ['artifact', 'native', 'work', 'output']) assert(values[key], 'Required: --' + key);
const root = resolve(values.work), output = resolve(values.output), wasmPath = resolve(values.artifact), native = resolve(values.native);
assert(!existsSync(root), 'Existing work directory is preserved'); assert(!existsSync(output), 'Existing output is preserved');
assert(existsSync(wasmPath) && existsSync(native), 'Explicit final WASI and native artifacts must exist');
mkdirSync(root, { mode: 0o700 });
const fixtures = spawnSync('python3', [join(directory, 'fixtures.py'), join(root, 'fixtures')], { encoding: 'utf8', timeout: 10000 });
assert.equal(fixtures.status, 0, fixtures.stderr);
const runRoot = join(root, 'cases');
const nativeIdentity = { path: native, bytes: readFileSync(native).length, sha256: createHash('sha256').update(readFileSync(native)).digest('hex') };
const sourceIdentities = Object.fromEntries([fileURLToPath(import.meta.url), fileURLToPath(new URL('../../runtimes/wasm-busybox/test/node-wasi-fixture.mjs', import.meta.url)), fileURLToPath(new URL('../../runtimes/wasm-busybox/test/archive-regression-fixtures.mjs', import.meta.url)), join(directory, 'fixtures.py')].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
for (const [name, hex] of [['directory-only.tar', directoryTarHex], ['directory-tree.tar', directoryTreeTarHex], ['directory-duplicate.tar', duplicateDirectoryTarHex], ['stored-bad-crc.zip', storedBadCrcZipHex]])
  assert.equal(readFileSync(join(root, 'fixtures', name)).toString('hex'), hex, 'Node/browser regression fixtures must be identical');
const artifact = readFileSync(wasmPath), module = await WebAssembly.compile(artifact);
const evidence = { schemaVersion: 1, profile: 'busybox-archive-extra-final-artifact', native: nativeIdentity, sourceIdentities, artifact: {
  path: wasmPath,
  bytes: artifact.length, sha256: createHash('sha256').update(artifact).digest('hex')
}, imports: WebAssembly.Module.imports(module), cases: [] };
const payload = readFileSync(join(root, 'fixtures/payload.bin'));
const utf8 = bytes => Buffer.from(bytes).toString();
const original = 'existing user content\n';
const tree = directory => {
  const result = [];
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), path = prefix + name, st = lstatSync(file);
      if (st.isSymbolicLink()) result.push([path, 'symlink', readlinkSync(file)]);
      else if (st.isDirectory()) { result.push([path, 'dir']); visit(file, path + '/'); }
      else result.push([path, 'file', readFileSync(file).toString('hex')]);
    }
  };
  visit(directory);
  return result;
};

async function run(id, command, args, check, { input = Buffer.alloc(0), setup, nativeCheck = true, nativeDivergence } = {}) {
  const runs = [];
  for (const engine of nativeCheck ? ['native', 'wasi'] : ['wasi']) {
    for (const alias of [false, true]) {
      const directory = join(runRoot, id, `${engine}-${alias ? 'argv0' : 'multicall'}`);
      const workspace = join(directory, 'workspace');
      mkdirSync(workspace, { recursive: true });
      cpSync(join(root, 'fixtures'), workspace, { recursive: true });
      setup?.(workspace);
      let code, stdout, stderr;
      if (engine === 'native') {
        const result = spawnSync(native, alias ? args : [command, ...args], {
          argv0: alias ? command : 'busybox', cwd: workspace, env: { LANG: 'C', LC_ALL: 'C' }, input,
          timeout: 10000, maxBuffer: 2 ** 20
        });
        if (result.error) throw result.error;
        code = result.status; stdout = result.stdout; stderr = result.stderr;
      } else {
        const inputPath = join(directory, 'stdin');
        writeFileSync(inputPath, input);
        const fds = [openSync(inputPath, 'r'), openSync(join(directory, 'stdout'), 'w'), openSync(join(directory, 'stderr'), 'w')];
        try {
          const wasi = new WASI({ version: 'preview1', args: alias ? [command, ...args] : ['busybox', command, ...args],
            env: { LANG: 'C', LC_ALL: 'C' }, preopens: { '/workspace': workspace },
            stdin: fds[0], stdout: fds[1], stderr: fds[2], returnOnExit: true });
          let instance;
          const metadata = createNodeWasiMetadata(wasi.wasiImport, { preopens: { '/workspace': workspace }, getInstance: () => instance });
          try {
          instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport, wasm_idle_fs_v1: metadata.imports,
            wasm_idle_process_v1: { initial_cwd(pointer, capacity) {
              const bytes = Buffer.from('/workspace\0');
              if (bytes.length > capacity || pointer + bytes.length > instance.exports.memory.buffer.byteLength) return -1;
              new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
              return bytes.length;
            } } });
          code = wasi.start(instance);
          } finally { metadata.dispose(); }
        } finally { for (const fd of fds) { try { closeSync(fd); } catch (error) { if (error.code !== 'EBADF') throw error; } } }
        stdout = readFileSync(join(directory, 'stdout')); stderr = readFileSync(join(directory, 'stderr'));
      }
      const value = { engine, alias, code, stdout, stderr, workspace };
      const details = check(value);
      const treeSha256 = createHash('sha256').update(JSON.stringify(tree(workspace).filter(([path]) => path !== 'output.tar'))).digest('hex');
      const observed = { engine, alias, code, stdoutHex: stdout.toString('hex'), stderr: utf8(stderr), treeSha256, ...(details ? { details } : {}) };
      const reference = runs.find(run => run.engine === 'native' && run.alias === alias);
      if (engine === 'wasi' && reference) {
        if (nativeDivergence) {
          assert.notDeepEqual([observed.code, observed.stdoutHex, observed.stderr, observed.treeSha256, observed.details], [reference.code, reference.stdoutHex, reference.stderr, reference.treeSha256, reference.details], id);
          observed.nativeDifferentialPassed = false;
          observed.expectedNativeDivergence = nativeDivergence;
        } else {
          assert.equal(observed.code, reference.code, id);
          assert.equal(observed.stdoutHex, reference.stdoutHex, id);
          assert.equal(observed.stderr, reference.stderr, id);
          assert.equal(observed.treeSha256, reference.treeSha256, id);
          observed.nativeDifferentialPassed = true;
        }
      }
      runs.push(observed);
    }
  }
  evidence.cases.push({ id, command, args, runs, passed: true, ...(nativeDivergence ? { expectedNativeDivergence: nativeDivergence } : {}) });
}
const success = value => { assert.equal(value.code, 0, utf8(value.stderr)); assert.equal(value.stderr.length, 0); };
const fail = value => { assert.notEqual(value.code, 0); assert(value.stderr.length > 0); };
const extracted = value => {
  success(value);
  assert.equal(readFileSync(join(value.workspace, 'tree/text.txt'), 'utf8'), 'alpha\nbeta\n');
  assert.deepEqual(readFileSync(join(value.workspace, 'tree/payload.bin')), payload);
  assert.equal(readlinkSync(join(value.workspace, 'tree/link')), 'text.txt');
};
const existingTree = workspace => { mkdirSync(join(workspace, 'tree')); writeFileSync(join(workspace, 'tree/text.txt'), original); };

await run('gzip-stream', 'gzip', ['-c'], value => { success(value); assert.deepEqual(gunzipSync(value.stdout), payload); }, { input: payload });
await run('gzip-file-stdout', 'gzip', ['-ck', 'payload.bin'], value => {
  success(value); assert.deepEqual(gunzipSync(value.stdout), payload); assert.deepEqual(readFileSync(join(value.workspace, 'payload.bin')), payload);
});
// The fixture already has payload.bin.gz, so a different source tests new output creation.
await run('gzip-new-file', 'gzip', ['-k', 'other.bin'], value => {
  success(value); assert.deepEqual(gunzipSync(readFileSync(join(value.workspace, 'other.bin.gz'))), payload);
  assert.deepEqual(readFileSync(join(value.workspace, 'other.bin')), payload);
}, { setup(workspace) { writeFileSync(join(workspace, 'other.bin'), payload); } });
await run('gzip-existing-refused', 'gzip', ['-k', 'payload.bin'], value => {
  fail(value); assert.deepEqual(readFileSync(join(value.workspace, 'payload.bin')), payload);
  assert.deepEqual(gunzipSync(readFileSync(join(value.workspace, 'payload.bin.gz'))), payload);
}, { nativeCheck: false });
await run('gunzip-file-stdout', 'gunzip', ['-c', 'payload.bin.gz'], value => { success(value); assert.deepEqual(value.stdout, payload); });
await run('gunzip-file', 'gunzip', ['-k', 'other.gz'], value => {
  success(value); assert.deepEqual(readFileSync(join(value.workspace, 'other')), payload); assert(existsSync(join(value.workspace, 'other.gz')));
}, { setup(workspace) { cpSync(join(workspace, 'payload.bin.gz'), join(workspace, 'other.gz')); } });
await run('gunzip-test', 'gunzip', ['-t', 'payload.bin.gz'], value => { success(value); assert.equal(value.stdout.length, 0); });
await run('gunzip-corrupt', 'gunzip', ['-t', 'broken.gz'], fail);
await run('tar-list', 'tar', ['-tf', 'input.tar'], value => {
  success(value); assert.equal(utf8(value.stdout), 'tree/\ntree/text.txt\ntree/payload.bin\ntree/link\n');
});
await run('tar-extract', 'tar', ['-xf', 'input.tar'], extracted);
await run('tar-extract-stdout', 'tar', ['-xOf', 'input.tar', 'tree/text.txt'], value => { success(value); assert.equal(utf8(value.stdout), 'alpha\nbeta\n'); });
await run('tar-create', 'tar', ['-cf', 'output.tar', 'newtree'], value => {
  success(value);
  const listed = spawnSync('tar', ['-tf', join(value.workspace, 'output.tar')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.trim().split('\n').sort(), ['newtree/', 'newtree/link', 'newtree/text.txt', `newtree/${'long-'.repeat(30)}.txt`].sort());
  const content = spawnSync('tar', ['-xOf', join(value.workspace, 'output.tar'), 'newtree/text.txt'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(content.status, 0, content.stderr); assert.equal(content.stdout, 'text\n');
}, { setup(workspace) { mkdirSync(join(workspace, 'newtree')); writeFileSync(join(workspace, 'newtree/text.txt'), 'text\n'); writeFileSync(join(workspace, 'newtree', 'long-'.repeat(30) + '.txt'), 'long path\n'); symlinkSync('text.txt', join(workspace, 'newtree/link')); } });
await run('tar-output-existing-preserved', 'tar', ['-cf', 'output.tar', 'payload.bin'], value => { fail(value); assert.equal(readFileSync(join(value.workspace, 'output.tar'), 'utf8'), original); }, { setup(workspace) { writeFileSync(join(workspace, 'output.tar'), original); }, nativeCheck: false });
await run('tar-existing-preserved', 'tar', ['-xf', 'input.tar'], value => {
  fail(value); assert.equal(readFileSync(join(value.workspace, 'tree/text.txt'), 'utf8'), original);
}, { setup: existingTree, nativeCheck: false });
await run('tar-permissions-refused', 'tar', ['-xpf', 'input.tar'], value => { fail(value); assert(!existsSync(join(value.workspace, 'tree'))); }, { nativeCheck: false });
await run('tar-special-refused', 'tar', ['-xf', 'special.tar'], value => { fail(value); assert(!existsSync(join(value.workspace, 'fifo'))); }, { nativeCheck: false });
await run('tar-hardlink-refused', 'tar', ['-xf', 'hardlink.tar'], value => { fail(value); assert(!existsSync(join(value.workspace, 'hard'))); }, { nativeCheck: false });
await run('tar-short-read', 'tar', ['-xf', 'short.tar'], fail);
await run('tar-compression-refused', 'tar', ['-czf', 'output.tar.gz', 'payload.bin'], value => { fail(value); assert(!existsSync(join(value.workspace, 'output.tar.gz'))); }, { nativeCheck: false });
await run('tar-parent-symlink-refused', 'tar', ['-xf', 'parent-link.tar'], value => {
  fail(value); assert(!existsSync(join(value.workspace, 'elsewhere/child.txt')));
}, { setup(workspace) { mkdirSync(join(workspace, 'elsewhere')); symlinkSync('elsewhere', join(workspace, 'parent')); }, nativeCheck: false });
await run('unzip-extract', 'unzip', ['-q', 'input.zip'], extracted);
await run('unzip-stdout', 'unzip', ['-p', 'input.zip', 'tree/text.txt'], value => { success(value); assert.equal(utf8(value.stdout), 'alpha\nbeta\n'); });
await run('unzip-list', 'unzip', ['-l', 'input.zip'], value => { success(value); assert(utf8(value.stdout).includes('tree/payload.bin')); });
await run('unzip-existing-preserved', 'unzip', ['-q', 'input.zip'], value => { fail(value); assert.equal(readFileSync(join(value.workspace, 'tree/text.txt'), 'utf8'), original); }, { setup: existingTree, nativeCheck: false });
await run('unzip-overwrite-refused', 'unzip', ['-oq', 'input.zip'], value => { fail(value); assert.equal(readFileSync(join(value.workspace, 'tree/text.txt'), 'utf8'), original); }, { setup: existingTree, nativeCheck: false });

for (const omitTime of [false, true]) await run(`tar-directory-file-conflict${omitTime ? '-m' : ''}`, 'tar', [omitTime ? '-xmf' : '-xf', 'directory-only.tar'], value => {
  const stat = lstatSync(join(value.workspace, 'data'));
  assert(stat.isFile());
  if (value.engine === 'native') {
    success(value);
    assert.equal(stat.mtimeMs, omitTime ? 1300000000000 : DIRECTORY_ARCHIVE_MTIME_MS);
  } else {
    fail(value);
    assert.match(utf8(value.stderr), /not a directory/);
    assert.equal(stat.atimeMs, 1200000000000);
    assert.equal(stat.mtimeMs, 1300000000000);
  }
  assert.equal(readFileSync(join(value.workspace, 'data'), 'utf8'), original);
  return { atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs };
}, { setup(workspace) { writeFileSync(join(workspace, 'data'), original); utimesSync(join(workspace, 'data'), 1200000000, 1300000000); }, nativeDivergence: 'Upstream tar accepts EEXIST for a directory entry even when the existing object is a regular file; WASI must fail before changing existing metadata.' });
await run('tar-directory-times', 'tar', ['-xf', 'directory-tree.tar'], value => {
  success(value);
  const directory = lstatSync(join(value.workspace, 'data'));
  assert.equal(lstatSync(join(value.workspace, 'data/file.txt')).mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
  assert.equal(readFileSync(join(value.workspace, 'data/file.txt'), 'utf8'), 'child');
  if (value.engine === 'native') assert.notEqual(directory.mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
  else { assert.equal(directory.atimeMs, DIRECTORY_ARCHIVE_MTIME_MS); assert.equal(directory.mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS); }
  return { directoryMtimeMs: directory.mtimeMs };
}, { nativeDivergence: 'Upstream tar restores a directory timestamp before its child is created; the WASI profile restores after all children.' });
await run('tar-directory-omit-times', 'tar', ['-xmf', 'directory-tree.tar'], value => {
  success(value);
  assert.notEqual(lstatSync(join(value.workspace, 'data')).mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
  assert.notEqual(lstatSync(join(value.workspace, 'data/file.txt')).mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
});
await run('tar-directory-duplicate-last-time', 'tar', ['-xf', 'directory-duplicate.tar'], value => {
  success(value);
  assert.equal(lstatSync(join(value.workspace, 'data')).mtimeMs, DIRECTORY_LAST_ARCHIVE_MTIME_MS);
  assert.equal(lstatSync(join(value.workspace, 'data/file.txt')).mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
});
await run('tar-directory-times-after-deferred-link', 'tar', ['-xf', 'directory-deferred-link.tar'], value => {
  success(value);
  assert.equal(readlinkSync(join(value.workspace, 'data/link')), '../sibling');
  const stat = lstatSync(join(value.workspace, 'data'));
  if (value.engine === 'native') assert.notEqual(stat.mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
  else assert.equal(stat.mtimeMs, DIRECTORY_ARCHIVE_MTIME_MS);
  return { directoryMtimeMs: stat.mtimeMs };
}, { nativeDivergence: 'Upstream tar creates deferred symlinks after restoring directory timestamps; WASI restores after deferred links.' });
const storedCrcDivergence = 'Upstream BusyBox does not validate stored ZIP CRC; native success is recorded, while the WASI profile must report the actual CRC mismatch.';
await run('unzip-stored-bad-crc-stdout', 'unzip', ['-p', 'stored-bad-crc.zip'], value => {
  assert.equal(utf8(value.stdout), 'dxpected bytes\n');
  if (value.engine === 'native') success(value);
  else { fail(value); assert.match(utf8(value.stderr), /crc error/); }
}, { nativeDivergence: storedCrcDivergence });
await run('unzip-stored-bad-crc-file', 'unzip', ['-q', 'stored-bad-crc.zip'], value => {
  assert.equal(readFileSync(join(value.workspace, 'data.txt'), 'utf8'), 'dxpected bytes\n');
  assert.equal(readFileSync(join(value.workspace, 'existing.txt'), 'utf8'), original);
  if (value.engine === 'native') success(value);
  else { fail(value); assert.match(utf8(value.stderr), /crc error/); }
}, { setup(workspace) { writeFileSync(join(workspace, 'existing.txt'), original); }, nativeDivergence: storedCrcDivergence });
await run('unzip-stored-bad-crc-symlink', 'unzip', ['-q', 'stored-symlink-bad-crc.zip'], value => {
  if (value.engine === 'native') { success(value); assert.equal(readlinkSync(join(value.workspace, 'link')), 'uarget'); }
  else { fail(value); assert.match(utf8(value.stderr), /crc error/); assert(!lstatSync(join(value.workspace, 'link'), { throwIfNoEntry: false })); }
}, { nativeDivergence: storedCrcDivergence });
await run('unzip-stored-binary-and-empty', 'unzip', ['-q', 'stored-boundary.zip'], value => {
  success(value);
  assert.deepEqual(readFileSync(join(value.workspace, 'stored.bin')), readFileSync(join(root, 'fixtures/stored-boundary.bin')));
  assert.equal(readFileSync(join(value.workspace, 'empty.txt')).length, 0);
});

assert.equal(evidence.cases.length, 35);
assert.equal(evidence.cases.reduce((n, value) => n + value.runs.length, 0), 120);
assert.equal(createHash('sha256').update(readFileSync(wasmPath)).digest('hex'), evidence.artifact.sha256, 'WASI artifact changed during validation');
assert.equal(createHash('sha256').update(readFileSync(native)).digest('hex'), nativeIdentity.sha256, 'Native artifact changed during validation');
for (const [path, sha] of Object.entries(sourceIdentities)) assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), sha, 'Runner source changed');
evidence.complete = true; evidence.passed = true;
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ passed: evidence.cases.length, invocations: evidence.cases.reduce((n, value) => n + value.runs.length, 0), artifact: evidence.artifact }));
