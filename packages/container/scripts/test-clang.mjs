// Opt-in real producer acceptance. Never downloads or substitutes a mock compiler.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { dirname, posix } from 'node:path';
import untar from '../../llvm-core/dist/core/src/tar.js';
import { createContainer } from '../dist/index.js';
import { createWasiAdapter } from '../dist/adapters/wasi/index.js';
import { createClangAdapter } from '../dist/adapters/clang/index.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function asset(name) {
  const path = process.env[name]; if (!path) throw new Error(`Set ${name} to verified producer bytes (.wasm or .wasm.gz)`);
  const file = await readFile(path); const bytes = new Uint8Array(path.endsWith('.gz') ? gunzipSync(file) : file);
  return { bytes, sha256: digest(bytes), deliverySha256: digest(file) };
}
const clang = await asset('CONTAINER_CLANG_WASM'), linker = await asset('CONTAINER_LLD_WASM');
function workerFactory(module) {
  return () => {
    const worker = new Worker(new URL('../test/contract/node-worker-entry.mjs', import.meta.url), { workerData: { module } });
    const wrapper = { onmessage: null, onerror: null, onmessageerror: null, postMessage: (data) => worker.postMessage(data), terminate: () => worker.terminate() };
    worker.on('message', (data) => wrapper.onmessage?.({ data }));
    worker.on('error', (error) => wrapper.onerror?.({ error }));
    worker.on('messageerror', (error) => wrapper.onmessageerror?.({ error }));
    return wrapper;
  };
}
const linkerPath = '/opt/toolchains/fixture/bin/wasm-ld';
const adapter = createClangAdapter({ clangSha256: clang.sha256, linkerSha256: linker.sha256, linkerPath, workerFactory: workerFactory(new URL('../dist/adapters/clang/worker.js', import.meta.url).href) });
const c = createContainer({
  adapters: [adapter, createWasiAdapter({ workerFactory: workerFactory(new URL('../dist/adapters/wasi/worker.js', import.meta.url).href) })],
  commands: { clang: { adapter: adapter.id, bytes: clang.bytes } }, maxMemoryBytes: 2 ** 32, maxBytes: 128 * 1024 * 1024
});
const results = [];
const rootOnly = process.env.CONTAINER_ROOT_ONLY === '1';
const fixturePath = (path) => rootOnly ? posix.resolve('/workspace/a b', path) : path;
const text = (bytes) => new TextDecoder().decode(bytes);
const write = (path, value) => c.fs.writeFile(path, new TextEncoder().encode(value));
async function run(args, expected = 0) {
  const start = performance.now();
  const result = await c.run('clang', args, { cwd: rootOnly ? '/' : '/workspace/a b', timeoutMs: 120000 });
  results.push({ args, code: result.code, reason: result.reason, stdout: text(result.stdout), stderr: text(result.stderr), elapsedMs: performance.now() - start });
  assert.equal(result.reason, 'exited', JSON.stringify(results.at(-1)));
  assert.equal(result.code, expected, JSON.stringify(results.at(-1)));
  return result;
}
let failure;
try {
  const files = [
    { path: 'bin', type: 'directory', mode: 0o555 },
    { path: 'bin/wasm-ld', type: 'file', mode: 0o555, data: linker.bytes }
  ];
  if (process.env.CONTAINER_SYSROOT) {
    // Local release fixture only. Runtime package loading never extracts archives.
    const archive = new Uint8Array(await readFile(process.env.CONTAINER_SYSROOT));
    assert.equal(digest(archive), process.env.CONTAINER_SYSROOT_SHA256 ?? '91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402');
    files.push({ path: 'sysroot', type: 'directory', mode: 0o555 });
    untar(archive, {
      addDirectory(path) { files.push({ path: `sysroot/${path.replace(/\/$/u, '')}`, type: 'directory', mode: 0o555 }); },
      addFile(path, data) { files.push({ path: `sysroot/${path}`, type: 'file', mode: 0o444, data }); }
    });
    results.push({ sysrootSha256: digest(archive), entries: files.length - 3, files: files.filter((f) => f.type === 'file' && f.path.startsWith('sysroot/')).length });
  }
  c.fs.mountReadonly('/opt/toolchains/fixture', files);
  c.fs.mkdir('/workspace/a b'); c.fs.mkdir('/workspace/include');
  write('/workspace/include/demo.h', '#define BASE 40\n');
  write('/workspace/a b/helper.c', '#include "demo.h"\nint answer(void){return BASE + EXTRA;}\n');
  write('/workspace/a b/main file.c', 'struct iov { const char *p; unsigned n; };\n__attribute__((import_module("wasi_snapshot_preview1"),import_name("fd_write"))) extern unsigned out(unsigned,struct iov*,unsigned,unsigned*);\nextern int answer(void);\nvoid _start(void){unsigned n; struct iov b={answer()==42?"hello\\n":"bad\\n",6};out(1,&b,1,&n);}\n');
  await run(['--version']);
  const flags = ['--target=wasm32-wasi', `-I${fixturePath('../include')}`, '-DEXTRA=2'];
  await run([...flags, '-c', fixturePath('helper.c'), '-o', fixturePath('helper.o')]);
  const preprocessed = await run([...flags, '-E', fixturePath('helper.c')]); assert.match(text(preprocessed.stdout), /40\s*\+\s*2/);
  await run([...flags, '-S', fixturePath('helper.c'), '-o', fixturePath('helper.s')]);
  assert.ok(c.fs.readFile('/workspace/a b/helper.s').length > 0);
  write('/workspace/a b/compile.rsp', `--target=wasm32-wasi -c "${fixturePath('main file.c')}" -o "${fixturePath('main file.o')}"`);
  await run([`@${fixturePath('compile.rsp')}`]);
  await run(['--container-deliberately-unsupported-option'], 1);
  if (process.env.CONTAINER_CLANG_BRIDGE === '1') {
    await run(['--target=wasm32-wasi', `--ld-path=${linkerPath}`, '-nostdlib', '-Wl,--export=_start,--max-memory=67108864,--export-memory', fixturePath('main file.o'), fixturePath('helper.o'), '-o', fixturePath('hello.wasm')]);
    const result = await c.run('wasm-run', ['/workspace/a b/hello.wasm'], { cwd: '/', timeoutMs: 10000 });
    assert.equal(result.code, 0); assert.equal(text(result.stdout), 'hello\n');
    results.push({ artifact: digest(c.fs.readFile('/workspace/a b/hello.wasm')), code: result.code, stdout: text(result.stdout) });
    if (process.env.CONTAINER_SYSROOT) {
      const sysroot = '/opt/toolchains/fixture/sysroot';
      const defaults = ['--target=wasm32-wasi', `--ld-path=${linkerPath}`, `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/lib/clang/22`, '-Wl,--max-memory=67108864'];
      write('/workspace/a b/stdio.c', '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n');
      await run([...defaults, fixturePath('stdio.c'), '-o', fixturePath('stdio.wasm')]);
      const stdio = await c.run('wasm-run', ['/workspace/a b/stdio.wasm'], { cwd: '/', timeoutMs: 10000 });
      assert.equal(stdio.code, 0); assert.equal(text(stdio.stdout), 'hello\n');
      write('/workspace/a b/templates.cpp', '#include <vector>\n#include <numeric>\n#include <map>\n#include <string>\n#include <cstdio>\nint main(){std::vector<int> v{1,2,3};std::map<std::string,int> m{{"sum",std::accumulate(v.begin(),v.end(),0)}};std::printf("sum=%d\\n",m.at("sum"));}\n');
      await run([...defaults, '--driver-mode=g++', '-std=c++20', fixturePath('templates.cpp'), '-o', fixturePath('cpp.wasm')]);
      const cpp = await c.run('wasm-run', ['/workspace/a b/cpp.wasm'], { cwd: '/', timeoutMs: 10000 });
      assert.equal(cpp.code, 0); assert.equal(text(cpp.stdout), 'sum=6\n');
      results.push({ c: { code: stdio.code, stdout: text(stdio.stdout) }, cpp: { code: cpp.code, stdout: text(cpp.stdout) } });
    }
  }
} catch (error) { failure = error; }
finally {
  await c.dispose();
  const evidence = { schemaVersion: 1, node: process.version, platform: process.platform, rootOnly, bridge: process.env.CONTAINER_CLANG_BRIDGE === '1', clang: { sha256: clang.sha256, deliverySha256: clang.deliverySha256, bytes: clang.bytes.length }, linker: { sha256: linker.sha256, bytes: linker.bytes.length }, results, passed: !failure, error: failure?.message };
  if (process.env.CONTAINER_EVIDENCE) { await mkdir(dirname(process.env.CONTAINER_EVIDENCE), { recursive: true }); await writeFile(process.env.CONTAINER_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify(evidence));
}
if (failure) throw failure;
