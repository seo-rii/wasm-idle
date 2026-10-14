// Opt-in real Clang header regression. Missing bytes or pins are failures, never skips.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { digest, loadClangBrowserInputs } from './clang-browser-inputs.mjs';
import { corpus, runHeaderCorpus } from '../test/fixtures/clang-headers/runner.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url)), repository = resolve(packageRoot, '../..');
const buildOnly = process.argv.slice(2).includes('--build-only');
assert(process.argv.slice(2).every((arg) => arg === '--build-only'), 'Only --build-only is supported');
const timeoutMs = Number(process.env.CONTAINER_CLANG_TIMEOUT_MS ?? 120000);
assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000, 'Invalid command timeout');
const evidence = {
  schemaVersion: 1, startedAt: new Date().toISOString(), passed: false, qualification: 'not-run',
  node: process.version, os: { platform: platform(), release: release(), arch: arch() },
  applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  timeoutMs, corpusSha256: digest(await readFile(new URL('../test/fixtures/clang-headers/corpus.json', import.meta.url))),
  corpus: { profileId: corpus.profileId, cases: corpus.cases.length, sources: Object.fromEntries(Object.entries(corpus.sources).map(([name, source]) => [name, { sha256: source.sha256, origin: source.origin }])) },
  startedWorkers: 0, liveWorkers: 0, headerCorpus: {}
};
let container, failure;
try {
  // Bundle from this physical checkout; do not execute another worktree's dist.
  const bundle = await build({
    absWorkingDir: repository,
    entryPoints: { host: resolve(packageRoot, 'test/fixtures/clang-headers/node-host.mjs'), 'clang-worker': resolve(packageRoot, 'src/adapters/clang/worker.ts') },
    alias: {
      '@wasm-idle/core': resolve(repository, 'packages/core/src/index.ts'),
      '@wasm-idle/llvm-core/tool-host': resolve(repository, 'packages/llvm-core/runtime/clang/src/tool-host.ts')
    },
    bundle: true, format: 'esm', platform: 'node', target: 'node22', outdir: '/fixture', write: false, metafile: true, logLevel: 'silent'
  });
  assert(Object.values(bundle.metafile.outputs).every((output) => output.imports.every((dependency) => dependency.path.startsWith('node:'))), 'Unresolved or remote host import');
  const outputs = new Map(bundle.outputFiles.map((file) => [file.path.split('/').at(-1), file.contents]));
  evidence.bundles = Object.fromEntries([...outputs].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }]));
  evidence.sources = {};
  for (const path of [...Object.keys(bundle.metafile.inputs), 'packages/container/scripts/test-clang-headers.mjs', 'packages/container/scripts/clang-browser-inputs.mjs', 'packages/container/test/fixtures/clang-headers/runner.mjs', 'packages/container/test/fixtures/clang-headers/corpus.json', 'packages/container/test/contract/node-worker-entry.mjs'].sort())
    evidence.sources[path] = digest(await readFile(resolve(repository, path)));
  if (buildOnly) {
    console.log(JSON.stringify({ status: 'prepared', qualification: 'not-run', bundles: evidence.bundles, corpusSha256: evidence.corpusSha256, cases: corpus.cases.length }));
  } else {
    assert(process.env.CONTAINER_EVIDENCE, 'Set CONTAINER_EVIDENCE to a new receipt file');
    const inputs = await loadClangBrowserInputs(process.env);
    assert.equal(inputs.assets.sysroot.metadata.logical.sha256, corpus.sysrootSha256, 'Corpus sysroot profile mismatch');
    evidence.producer = { receiptSha256: inputs.producerSha256, smokeSha256: inputs.producerSmokeSha256, source: inputs.producer.source, profile: inputs.producer.profile.profileId };
    evidence.assets = Object.fromEntries(Object.entries(inputs.assets).map(([name, asset]) => [name, asset.metadata]));
    const dataURL = (bytes) => `data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`;
    const { createContainer, createClangAdapter, untar } = await import(dataURL(outputs.get('host.js')));
    const workerModule = dataURL(outputs.get('clang-worker.js'));
    const adapter = createClangAdapter({
      clangSha256: inputs.assets.clang.metadata.logical.sha256, linkerSha256: inputs.assets.lld.metadata.logical.sha256,
      linkerPath: '/opt/toolchains/fixture/bin/wasm-ld',
      workerFactory: () => {
        const worker = new Worker(new URL('../test/contract/node-worker-entry.mjs', import.meta.url), { workerData: { module: workerModule } });
        evidence.startedWorkers++; evidence.liveWorkers++;
        let terminated;
        const wrapper = {
          onmessage: null, onerror: null, onmessageerror: null,
          postMessage: (data) => worker.postMessage(data),
          terminate: () => terminated ??= worker.terminate().then(() => { evidence.liveWorkers--; })
        };
        worker.on('message', (data) => wrapper.onmessage?.({ data }));
        worker.on('error', (error) => wrapper.onerror?.({ error }));
        worker.on('messageerror', (error) => wrapper.onmessageerror?.({ error }));
        return wrapper;
      }
    });
    // loadClangBrowserInputs has already pinned both delivery and logical bytes.
    const { gunzipSync } = await import('node:zlib');
    const decode = (asset) => asset.metadata.encoding === 'identity' ? asset.delivery : new Uint8Array(gunzipSync(asset.delivery));
    container = createContainer({ adapters: [adapter], commands: { clang: { adapter: adapter.id, bytes: decode(inputs.assets.clang) } }, maxMemoryBytes: 2 ** 32, maxBytes: 256 * 1024 * 1024, maxProcesses: 1 });
    const sysroot = '/usr/share/fixture-sysroot', files = [], paths = new Set();
    const add = (path, value) => {
      assert(path && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..') && !paths.has(path), 'Invalid sysroot fixture path');
      paths.add(path); files.push({ path, ...value });
    };
    untar(decode(inputs.assets.sysroot), {
      addDirectory(path) { add(path.replace(/\/$/u, ''), { type: 'directory', mode: 0o555 }); },
      addFile(path, data) { add(path, { type: 'file', mode: 0o444, data }); }
    });
    assert.equal(files.length, corpus.selectedSysroot.entries);
    assert.equal(files.filter((file) => file.type === 'file').length, corpus.selectedSysroot.files);
    container.fs.mountReadonly(sysroot, files);
    container.fs.mountReadonly('/opt/toolchains/fixture', [{ path: 'bin', type: 'directory', mode: 0o555 }, { path: 'bin/wasm-ld', type: 'file', mode: 0o555, data: decode(inputs.assets.lld) }]);
    container.fs.mkdir('/workspace/header corpus $ #');
    const cwd = '/workspace/header corpus $ #/한글'; container.fs.mkdir(cwd);
    await runHeaderCorpus({
      fs: container.fs, sysroot, cwd, sha256: digest, evidence: evidence.headerCorpus,
      async runCommand(id, args) {
        const result = await container.run('clang', args, { cwd, env: { LANG: 'C', PWD: '/deliberately-wrong-pwd' }, timeoutMs });
        assert.equal(evidence.liveWorkers, 0, `${id}: Worker was not reclaimed`);
        return result;
      }
    });
    evidence.passed = true;
    evidence.qualification = 'Node Worker batch snapshot; bounded selected-target header compile corpus; no exhaustive/header-runtime/browser claim';
  }
} catch (error) {
  failure = error; evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  await container?.dispose();
  if (container) evidence.inspection = await container.inspect();
  if (!buildOnly && process.env.CONTAINER_EVIDENCE) {
    evidence.finishedAt = new Date().toISOString();
    const path = resolve(process.env.CONTAINER_EVIDENCE);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ passed: evidence.passed, evidence: path, error: evidence.error, startedWorkers: evidence.startedWorkers, liveWorkers: evidence.liveWorkers }));
  }
}
if (failure) throw failure;
