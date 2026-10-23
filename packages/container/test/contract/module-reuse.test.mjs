import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createContainer } from '../../dist/container.js';
import { createLiveClangAdapter } from '../../dist/adapters/clang-live/index.js';
import { workerFactory as nodeWorker } from './node-worker.mjs';

const u32 = value => { const out = []; do { const byte = value & 127; value >>>= 7; out.push(byte | (value ? 128 : 0)); } while (value); return out; };
const name = value => [...u32(value.length), ...new TextEncoder().encode(value)];
const section = (id, body) => [id, ...u32(body.length), ...body];
// A real Wasm command traps if its own memory is ever reused across invocations.
function commandBytes(marker = 1, badImport = false) {
  const body = [0, 0x41, 0, 0x2d, 0, 0, 0x04, 0x40, 0x00, 0x0b, 0x41, 0, 0x41, marker, 0x3a, 0, 0, 0x0b];
  return Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...(badImport ? section(2, [1, ...name('untrusted'), ...name('call'), 0, 0]) : []),
    ...section(3, [1, 0]), ...section(5, [1, 1, 1, 2]),
    ...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, badImport ? 1 : 0]),
    ...section(10, [1, ...u32(body.length), ...body])]);
}
const clang = commandBytes(), linker = commandBytes(2);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isTool = bytes => bytes instanceof Uint8Array && bytes.length === clang.length && [sha256(clang), sha256(linker)].includes(sha256(bytes));
// Count only the pinned tools, excluding unrelated runtime Wasm initialization.
const toolCompiles = mock => mock.mock.calls.filter(call => isTool(call.arguments[0])).length;
const toolchain = '/opt/toolchains/module-test';
const limits = { maxMemoryBytes: 2 ** 32, maxInputBytes: 65536, maxOutputBytes: 65536, maxWorkspaceBytes: 2 ** 20, maxWorkspaceInodes: 256 };
let generation = 1000;
function fixture(overrides = {}) {
  const workers = [], frames = [];
  const adapter = overrides.adapter ?? createLiveClangAdapter({
    clangSha256: sha256(overrides.clang ?? clang), linkerSha256: sha256(linker), linkerPath: `${toolchain}/bin/wasm-ld`, compilerPaths: [`${toolchain}/bin/clang`],
    workerFactory() {
      const worker = nodeWorker('../../dist/adapters/clang-live/worker.js'), post = worker.postMessage;
      workers.push(worker);
      worker.postMessage = (data, transfer) => { if (data.type === 'prepare') frames.push(data); post(data, transfer); };
      return worker;
    }, ...overrides.options
  });
  const container = createContainer({ adapters: [adapter], commands: { clang: { adapter: adapter.id, bytes: overrides.clang ?? clang } }, maxBytes: limits.maxWorkspaceBytes, maxMemoryBytes: limits.maxMemoryBytes });
  container.fs.mountReadonly(toolchain, [
    { path: 'bin', type: 'directory', mode: 0o555 },
    { path: 'bin/clang', type: 'file', mode: 0o555, data: overrides.clang ?? clang },
    { path: 'bin/wasm-ld', type: 'file', mode: 0o555, data: linker }
  ]);
  return { adapter, container, workers, frames, run: () => container.run('clang', [], { cwd: '/' }),
    start: (bytes = clang, settings = {}) => adapter.start({ command: { adapter: adapter.id, bytes }, invocation: { command: 'clang', args: [], cwd: '/', env: {} },
      limits, generation: ++generation, signal: new AbortController().signal, fs: container.fs, ...settings }) };
}

test('live Clang reuses verified modules across fresh Workers without command/linker byte payloads', { timeout: 30000 }, async t => {
  const compile = t.mock.method(WebAssembly, 'compile'), f = fixture();
  try {
    assert.equal((await f.run()).code, 0); assert.equal((await f.run()).code, 0);
    assert.equal(f.workers.length, 2); assert.equal(toolCompiles(compile), 2);
    for (const frame of f.frames) {
      assert.equal(Object.hasOwn(frame.command, 'bytes'), false);
      assert.equal(Object.hasOwn(frame.configuration, 'linker'), false);
      for (const service of Object.values(frame.configuration.services)) assert.equal(typeof service.bytes, 'number');
    }
    f.adapter.clearModuleCache();
    assert.equal((await f.run()).code, 0); assert.equal(toolCompiles(compile), 4);
  } finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('owner cache is bounded and a disabled cache retains no compiler modules', { timeout: 30000 }, async t => {
  const compile = t.mock.method(WebAssembly, 'compile'), f = fixture({ options: { moduleCacheBytes: 0 } });
  try { assert.equal((await f.run()).code, 0); assert.equal((await f.run()).code, 0); assert.equal(toolCompiles(compile), 4); }
  finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('older Worker proxies without transfer support keep the original byte preparation behavior', { timeout: 30000 }, async () => {
  const frames = [], f = fixture({ options: { workerFactory() {
    const worker = nodeWorker('../../dist/adapters/clang-live/worker.js'), post = worker.postMessage;
    worker.postMessage = data => { if (data.type === 'prepare') frames.push(data); post(data); };
    return worker;
  } } });
  try {
    assert.equal((await f.run()).code, 0);
    assert.equal(frames.length, 2);
    assert.equal(Object.hasOwn(frames[0].command, 'bytes'), false);
    assert.ok(frames[1].command.bytes instanceof Uint8Array);
    assert.ok(frames[1].configuration.linker instanceof Uint8Array);
  } finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('cache hits still reject altered source bytes, tighter memory policy and unsupported cwd imports', { timeout: 30000 }, async () => {
  const f = fixture();
  try {
    assert.equal((await f.run()).code, 0);
    await assert.rejects(f.start(commandBytes(3)), /integrity mismatch/);
    await assert.rejects(f.start(clang, { limits: { ...limits, maxMemoryBytes: 65536 } }), /memory exceeds/);
    await assert.rejects(f.start(clang, { invocation: { command: 'clang', args: [], cwd: '/workspace', env: {} } }), /not a supported Wasm module/);
    assert.equal((await f.run()).code, 0);
  } finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('live Worker admission rejects forbidden imports from a correctly pinned owner module', { timeout: 30000 }, async () => {
  const f = fixture({ clang: commandBytes(1, true) });
  try { await assert.rejects(f.run(), /not a supported Wasm module/); }
  finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('a miswired module service cannot change the application-pinned compiler identity', { timeout: 30000 }, async () => {
  const f = fixture({ options: { workerFactory() {
    const worker = nodeWorker('../../dist/adapters/clang-live/worker.js'), post = worker.postMessage;
    worker.postMessage = (data, transfer) => {
      if (data.type === 'prepare') data.configuration.services.clang.sha256 = '0'.repeat(64);
      post(data, transfer);
    };
    return worker;
  } } });
  try { await assert.rejects(f.run(), /pinned invocation profile/); }
  finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('source buffers are captured before asynchronous preparation and command disposal permits another fresh Worker', { timeout: 30000 }, async () => {
  const f = fixture(), source = Buffer.from(clang);
  try {
    const pending = f.start(source); source.fill(255);
    const runtime = await pending;
    try { assert.equal((await runtime.run()).code, 0); }
    finally { await runtime.dispose(); }
    const unused = await f.start(); await unused.dispose();
    assert.equal((await f.run()).code, 0);
  } finally { await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('disposing one Container leaves a shared adapter cache and another Container usable', { timeout: 30000 }, async t => {
  const compile = t.mock.method(WebAssembly, 'compile'), first = fixture(), second = fixture({ adapter: first.adapter });
  try {
    assert.equal((await first.run()).code, 0); await first.container.dispose();
    assert.equal((await second.run()).code, 0); assert.equal(toolCompiles(compile), 2);
  } finally { await first.container.dispose(); await second.container.dispose(); first.adapter.clearModuleCache(); }
});

test('cancelling native preparation closes command endpoints and never retains late modules', { timeout: 30000 }, async t => {
  const native = WebAssembly.compile.bind(WebAssembly), f = fixture(), controller = new AbortController();
  let entered, resume;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const compile = t.mock.method(WebAssembly, 'compile', async bytes => { if (isTool(bytes)) { entered(); await gate; } return native(bytes); });
  try {
    const pending = f.start(clang, { signal: controller.signal });
    const rejected = assert.rejects(pending, /cancelled|stopped/);
    await started; controller.abort(); await rejected; resume();
    await new Promise(resolve => setImmediate(resolve));
    compile.mock.restore();
    const retry = t.mock.method(WebAssembly, 'compile');
    assert.equal((await f.run()).code, 0); assert.equal(toolCompiles(retry), 2);
  } finally { resume(); await f.container.dispose(); f.adapter.clearModuleCache(); }
});

test('clearing a shared cache during native work preserves its bound and does not repopulate the replacement cache', { timeout: 30000 }, async t => {
  const first = fixture(), second = fixture({ adapter: first.adapter }), controller = new AbortController();
  const native = WebAssembly.compile.bind(WebAssembly), digest = crypto.subtle.digest.bind(crypto.subtle);
  let entered, resume, started = 0, active = 0, maximum = 0;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const begin = () => { active++; maximum = Math.max(maximum, active); };
  const compile = t.mock.method(WebAssembly, 'compile', async bytes => {
    if (!isTool(bytes)) return native(bytes);
    begin(); const index = ++started; if (index === 2) entered();
    try { if (index <= 2) await gate; return await native(bytes); }
    finally { active--; }
  });
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    begin(); try { return await digest(...args); } finally { active--; }
  });
  try {
    const preparing = first.start(clang, { signal: controller.signal }), rejected = assert.rejects(preparing, /cancelled|stopped/);
    await ready; first.adapter.clearModuleCache(); controller.abort(); await rejected;
    const retry = second.run();
    await new Promise(resolve => setTimeout(resolve, 200)); resume();
    assert.equal((await retry).code, 0); assert.equal((await second.run()).code, 0);
    assert.equal(toolCompiles(compile), 4); assert.ok(maximum <= 2, `native preparation concurrency: ${maximum}`);
  } finally { resume(); await first.container.dispose(); await second.container.dispose(); first.adapter.clearModuleCache(); }
});
