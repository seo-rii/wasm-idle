// Real pinned compiler evidence. Small Wasm unit fixtures do not replace this gate.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { createContainer, extractTarPackage } from '../../../dist/index.js';
import { createClangAdapter } from '../../../dist/adapters/clang/index.js';
import { createWasiAdapter } from '../../../dist/adapters/wasi/index.js';
import { readPinnedProbeInputs, CLANG_PROFILE } from '../../../../../scripts/probe-container-shell-acceptance-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--config' && args[2] === '--output' && isAbsolute(args[1]) && isAbsolute(args[3]),
  'Use --config PINNED_CONFIGURATION --output FRESH_ABSOLUTE_DIRECTORY');
const output = args[3], hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = await readPinnedProbeInputs(JSON.parse(await readFile(args[1], 'utf8')));
await mkdir(output, { mode: 0o700 });
const sources = {};
for (const [name, entry] of [['clang', 'adapters/clang/worker.ts'], ['wasi', 'adapters/wasi/worker.ts']]) {
  await build({ entryPoints: [resolve(root, 'packages/container/src', entry)], outfile: resolve(output, `${name}.mjs`),
    bundle: true, platform: 'node', format: 'esm', target: 'es2022',
    alias: { '@wasm-idle/core': resolve(root, 'packages/core/src/index.ts'), '@wasm-idle/llvm-core/tool-host': resolve(root, 'packages/llvm-core/runtime/clang/src/tool-host.ts') },
    plugins: [{ name: 'record-consumed-source', setup(builder) {
      builder.onLoad({ filter: /\.(?:ts|mjs|js)$/ }, async ({ path }) => {
        const bytes = await readFile(path); sources[path.slice(root.length + 1)] = hash(bytes);
        return { contents: bytes.toString('utf8'), loader: path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }]
  });
}
let activeWorkers = 0;
const workerFactory = name => () => {
  const worker = new Worker(pathToFileURL(resolve(root, 'packages/container/test/contract/node-worker-entry.mjs')),
    { workerData: { module: pathToFileURL(resolve(output, `${name}.mjs`)).href } });
  activeWorkers++;
  worker.once('exit', () => { activeWorkers--; });
  const wrapper = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
  worker.on('message', data => wrapper.onmessage?.({ data }));
  worker.on('error', error => wrapper.onerror?.({ error }));
  return wrapper;
};
const executable = '/opt/toolchains/llvm/bin/llvm';
const clang = gunzipSync(inputs.clang.assets.clang.delivery), linker = gunzipSync(inputs.clang.assets.lld.delivery);
const adapter = createClangAdapter({ clangSha256: inputs.clang.assets.clang.metadata.logical.sha256,
  linkerSha256: inputs.clang.assets.lld.metadata.logical.sha256, linkerPath: '/opt/toolchains/llvm/bin/wasm-ld',
  compilerPaths: [executable], executableOutputProfile: 'wasi-preview1-process', workerFactory: workerFactory('clang') });
const container = createContainer({ adapters: [adapter, createWasiAdapter({ workerFactory: workerFactory('wasi') })],
  commands: { clang: { adapter: adapter.id, bytes: clang, argv0: executable } }, maxBytes: 256 * 1024 * 1024, maxMemoryBytes: 2 ** 32 });
const result = { schemaVersion: 1, qualified: false, scope: 'Node Worker actual Clang multicall self path, compile/link and generated command execution',
  node: process.version, platform: process.platform, arch: process.arch, sourceHashes: sources,
  producerReceiptSha256: inputs.clang.producerSha256,
  assets: Object.fromEntries(Object.entries(inputs.clang.assets).map(([name, asset]) => [name, asset.metadata])) };
const capture = value => ({ ...value, stdout: [...value.stdout], stderr: [...value.stderr] });
try {
  container.fs.mountReadonly('/opt/toolchains/llvm', [{ path: 'bin', type: 'directory', mode: 0o555 },
    { path: 'bin/llvm', type: 'file', mode: 0o555, data: clang }, { path: 'bin/wasm-ld', type: 'file', mode: 0o555, data: linker }]);
  container.fs.mountReadonly('/usr/share/wasm-sysroot', extractTarPackage(inputs.clang.assets.sysroot.delivery));
  container.fs.mountCommands('/usr/local/bin', ['clang']);
  container.fs.mkdir('/workspace/demo');
  container.fs.writeFile('/workspace/demo/main.c', new TextEncoder().encode('#include <stdio.h>\nint main(void){puts("hello");return 0;}\n'));
  result.argv = [executable, 'clang', ...CLANG_PROFILE, 'main.c', '-o', 'hello.wasm'];
  const compiled = await container.run('clang', result.argv.slice(1), { cwd: '/workspace/demo',
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/workspace', LANG: 'C' }, timeoutMs: 90000 });
  result.compiler = capture(compiled);
  assert.equal(compiled.reason, 'exited'); assert.equal(compiled.code, 0);
  const artifact = container.fs.readFile('/workspace/demo/hello.wasm');
  result.artifact = { bytes: artifact.length, sha256: hash(artifact), mode: container.fs.stat('/workspace/demo/hello.wasm').mode };
  assert.equal(result.artifact.mode & 0o111, 0o111);
  const executed = await container.run('wasm-run', ['hello.wasm'], { cwd: '/workspace/demo', timeoutMs: 30000 });
  result.execution = capture(executed);
  assert.equal(executed.reason, 'exited'); assert.equal(executed.code, 0);
  assert.equal(new TextDecoder().decode(executed.stdout), 'hello\n'); assert.equal(executed.stderr.length, 0);
  result.qualified = true;
} finally {
  await container.dispose();
  result.activeWorkersAfterDispose = activeWorkers;
  result.qualified &&= activeWorkers === 0;
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  assert.equal(activeWorkers, 0, 'Every actual compiler/artifact Worker must retire');
}
