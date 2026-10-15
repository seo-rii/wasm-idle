// SDK protocol tests use an injected implementation. They do not qualify Bash,
// WASIX syscalls or the actual built SDK; those require browser acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createContainer } from '../../dist/container.js';
import { installWasixWorkerGroup, createWasixShellSession } from '../../dist/adapters/wasix/index.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class TestWorker extends EventTarget { constructor(url) { super(); this.url = url; } terminate() { this.terminated = true; } }

function fixture() {
  const scope = { Worker: TestWorker }, workers = installWasixWorkerGroup({ scope, maxWorkers: 4 });
  const state = { loads: [], inputs: [], calls: [], commands: new Map(), directories: [], freed: [] }, exit = deferred();
  const container = createContainer();
  let out, err;
  const stdout = new ReadableStream({ start(controller) { out = controller; }, pull() { state.stdoutPulls = (state.stdoutPulls ?? 0) + 1; } }, { highWaterMark: 0 });
  const stderr = new ReadableStream({ start(controller) { err = controller; } }, { highWaterMark: 0 });
  const stdin = new WritableStream({ write(bytes) { state.inputs.push(bytes.slice()); }, close() { state.inputClosed = true; } });
  const instance = { stdin, stdout, stderr, waitForExit() { assert(stdin.locked && stdout.locked && stderr.locked); state.waited = true; return exit.promise; } };
  const sdk = {
    async init(options) { state.initialization = options; state.worker = new scope.Worker('https://app.test/sdk-worker.mjs'); },
    Runtime: class {
      constructor(options) { assert.deepEqual(options, { registry: null }); }
      registerHostCommand(path, handler) { state.commands.set(path, handler); }
      registerHostCommandDirectory(path, handler) { state.directoryHandler = handler; }
      free() { state.freed.push('runtime'); }
    },
    Directory: { fromHostFileSystem(fs) { state.directories.push(fs); return { free() { state.freed.push('directory'); } }; } },
    Wasmer: { async fromFile(bytes) {
      state.webc = bytes;
      return { free() { state.freed.push('package'); }, entrypoint: { binary: () => wasm, free() { state.freed.push('command'); }, async run(options) { state.run = options; return instance; } } };
    } }
  };
  const options = {
    container, sdk, workers,
    assets: { async load(pkg, asset) { state.loads.push([pkg, asset]); return asset === 'sdk' ? wasm.slice() : new Uint8Array([42]); } },
    sdkAsset: { packageId: 'shell', assetId: 'sdk' }, shellAsset: { packageId: 'shell', assetId: 'webc' }, shellWasmSha256: digest(wasm),
    sdkUrl: 'https://app.test/sdk.mjs', workerUrl: 'https://app.test/sdk-worker.mjs', memory: { initial: 1, maximum: 2 },
    routes: { '/usr/bin/tool': { command: 'tool' } }, moduleDirectories: ['/workspace'], args: ['--noprofile', '--norc'], env: { PATH: '/usr/bin' }
  };
  return { scope, workers, state, exit, out, err, options, container };
}

test('worker group bounds allocation and tracks SDK scheduler-owned descendants', async () => {
  const scope = { Worker: TestWorker }, group = installWasixWorkerGroup({ scope, maxWorkers: 2 });
  const a = new scope.Worker('a'), b = new scope.Worker('b');
  assert.throws(() => new scope.Worker('c'), { code: 'RESOURCE_LIMIT' }); assert(group.failure.aborted);
  a.terminate(); a.terminate(); assert.equal(group.inspect().active, 1);
  await group.dispose(); await group.dispose();
  assert(b.terminated); assert.equal(group.inspect().active, 0); assert.equal(group.inspect().terminated, 2);
  assert.throws(() => new scope.Worker('late'), { code: 'DISPOSED' }, 'late SDK work cannot escape the retired group');
  assert.throws(() => installWasixWorkerGroup({ scope }), { code: 'UNSUPPORTED_PROFILE' });
});

test('SDK streaming protocol preserves raw I/O and does not drain output in waitForExit', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture();
  try {
    assert.equal(f.state.loads.length, 0, 'assets are lazy until shell startup');
    const session = await createWasixShellSession(f.options);
    assert.equal(f.state.stdoutPulls ?? 0, 0, 'startup/exit observer must not pull stdout');
    assert.equal(f.state.run.rawStdin, true);
    assert.deepEqual(f.state.loads, [['shell', 'sdk'], ['shell', 'webc']]);
    assert.equal(f.container.fs.stat('/usr/bin/tool').command, true);
    assert.throws(() => f.container.fs.readFile('/usr/bin/tool'), { code: 'ENOTSUP' });
    const input = session.stdin.getWriter(); await input.write(new Uint8Array([0, 255, 13, 10])); await input.close();
    assert.deepEqual(f.state.inputs, [new Uint8Array([0, 255, 13, 10])]); assert(f.state.inputClosed);
    f.out.enqueue(new Uint8Array([255, 0, 1])); f.out.close(); f.err.close(); f.exit.resolve({ code: 7, ok: false });
    assert.deepEqual(await session.exited, { code: 7, reason: 'exited' });
    assert.equal(f.workers.inspect().active, 0);
    assert.deepEqual(new Uint8Array(await new Response(session.stdout).arrayBuffer()), new Uint8Array([255, 0, 1]), 'buffered bytes remain consumable after exit');
    assert.equal((await new Response(session.stderr).arrayBuffer()).byteLength, 0);
    await session.dispose();
  } finally { await f.workers.dispose(); await f.container.dispose(); }
});

test('SDK startup integrity failure releases worker group before shell execution', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(); f.options.shellWasmSha256 = '0'.repeat(64);
  try {
    await assert.rejects(createWasixShellSession(f.options), { code: 'INTEGRITY' });
    assert.equal(f.state.run, undefined); assert.equal(f.workers.inspect().active, 0);
    assert.deepEqual(f.container.fs.readdir('/usr/bin'), []);
  } finally { await f.workers.dispose(); await f.container.dispose(); }
});

test('startup abort stops a pending asset request and leaves no SDK workers', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), abort = new AbortController(), blocked = deferred(); let signal;
  f.options.signal = abort.signal;
  f.options.assets.load = async (pkg, id, options) => { signal = options.signal; return blocked.promise; };
  const pending = createWasixShellSession(f.options); abort.abort(new Error('cancel'));
  await assert.rejects(pending, { code: 'ABORTED' });
  assert(signal.aborted); assert.equal(f.workers.inspect().active, 0); assert.equal(f.state.initialization, undefined);
  await f.container.dispose();
});

test('routed preparation can be interrupted and direct artifacts require executable metadata', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), entered = deferred();
  f.options.prepareCommand = (invocation, signal) => { entered.resolve(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  const session = await createWasixShellSession(f.options);
  try {
    const invocation = { path: '/usr/bin/tool', argv: ['tool'], cwd: '/workspace', env: [], stdin: null, stdout: null, stderr: null };
    const pending = f.state.commands.get(invocation.path)(invocation); await entered.promise;
    assert.equal(session.interrupt(), 1); assert.equal(await pending, 130); assert.equal(session.interrupt(), 0);
    f.container.fs.writeFile('/workspace/data.wasm', wasm);
    assert.equal(await f.state.directoryHandler({ ...invocation, path: '/workspace/data.wasm' }), 126);
    const output = session.stdout.getReader(), blocked = output.read();
    await session.terminate(); assert.deepEqual(await session.exited, { code: null, reason: 'terminated' });
    assert.equal((await blocked).done, true); assert.equal(f.workers.inspect().active, 0);
  } finally { await session.dispose(); await f.container.dispose(); }
});

test('worker failure becomes a runtime error and initial failures retain startup classification', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), session = await createWasixShellSession(f.options);
  f.state.worker.dispatchEvent(new Event('error'));
  assert.deepEqual(await session.exited, { code: null, reason: 'runtime-error' });
  await session.dispose(); await f.container.dispose();
  const bad = fixture(); bad.options.sdk.init = async () => { throw new Error('SDK init failed'); };
  await assert.rejects(createWasixShellSession(bad.options), { code: 'STARTUP_FAILED' });
  await bad.container.dispose();
});

test('cancelled SDK initialization cannot create an untracked late Worker', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), entered = deferred(), resume = deferred(), abort = new AbortController();
  f.options.signal = abort.signal;
  let lateFailure;
  f.options.sdk.init = async () => {
    entered.resolve(); await resume.promise;
    try { new f.scope.Worker('late-sdk-thread'); } catch (error) { lateFailure = error; throw error; }
  };
  const pending = createWasixShellSession(f.options); await entered.promise; abort.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  resume.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateFailure.code, 'DISPOSED'); assert.equal(f.workers.inspect().created, 0);
  await f.container.dispose();
});

test('a late SDK run result is cancelled without draining or leaking its streams', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), entered = deferred(), resume = deferred(), abort = new AbortController();
  f.options.signal = abort.signal;
  const closed = [];
  const instance = {
    stdin: new WritableStream({ abort() { closed.push('stdin'); } }),
    stdout: new ReadableStream({ cancel() { closed.push('stdout'); } }, { highWaterMark: 0 }),
    stderr: new ReadableStream({ cancel() { closed.push('stderr'); } }, { highWaterMark: 0 }),
    waitForExit() { closed.push('exit'); return Promise.reject(new Error('guest group is gone')); }
  };
  f.options.sdk.Wasmer.fromFile = async () => ({ entrypoint: { binary: () => wasm, run() { entered.resolve(); return resume.promise; } } });
  const pending = createWasixShellSession(f.options); await entered.promise; abort.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  resume.resolve(instance); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(closed.sort(), ['exit', 'stderr', 'stdin', 'stdout']);
  assert.equal(f.workers.inspect().active, 0); await f.container.dispose();
});

test('invalid output chunks terminate the SDK group instead of retaining an oversized queue', async () => {
  globalThis.crossOriginIsolated = true;
  const f = fixture(), session = await createWasixShellSession(f.options);
  const pending = session.stdout.getReader().read(); f.out.enqueue(new Uint8Array(65537));
  await assert.rejects(pending, { code: 'RESOURCE_LIMIT' });
  assert.deepEqual(await session.exited, { code: null, reason: 'runtime-error' });
  assert.equal(f.workers.inspect().active, 0); await f.container.dispose();
});
