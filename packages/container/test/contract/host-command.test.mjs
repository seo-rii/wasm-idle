import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createHostCommandHandler, HOST_COMMAND_STATUS } from '../../dist/index.js';
import { createPipe } from '../../dist/fd/pipe.js';
import { workerFactory, command } from './node-worker.mjs';
const live = new Uint8Array(readFileSync(new URL('../fixtures/live.wasm', import.meta.url)));
const liveWorker = () => workerFactory('../../dist/adapters/wasi-live/worker.js');
const make = () => createContainer({
  adapters: [createLiveWasiAdapter({ workerFactory: liveWorker }), createWasiAdapter({ workerFactory })],
  maxProcesses: 8,
  commands: {
    tool: { adapter: 'wasi-preview1-live', bytes: live },
    probe: { adapter: 'wasi-preview1-live', bytes: command },
    batch: { adapter: 'wasi-preview1', bytes: live }
  }
});
const encode = (value) => new TextEncoder().encode(value), decode = (value) => new TextDecoder().decode(value);
const concat = (chunks) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
};
// Caller-owned endpoints that record every request, like a shell child's descriptors.
function reader(data) {
  let offset = 0;
  const endpoint = {
    requests: [], closed: 0,
    async read(max) { endpoint.requests.push(max); const end = Math.min(data.length, offset + max); const out = data.slice(offset, end); offset = end; return out; },
    close() { endpoint.closed++; },
    get remaining() { return data.length - offset; }
  };
  return endpoint;
}
function writer({ limit = Infinity, failure } = {}) {
  const endpoint = {
    chunks: [], requests: [], closed: 0,
    async write(bytes) {
      endpoint.requests.push(bytes.length);
      if (failure) throw failure;
      const n = Math.min(bytes.length, limit); endpoint.chunks.push(bytes.slice(0, n)); return n;
    },
    close() { endpoint.closed++; },
    get bytes() { return concat(endpoint.chunks); }
  };
  return endpoint;
}

test('delegated stdin is read on demand, never past the guest request', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const input = reader(encode('xyz')), output = writer();
    const p = await c.spawn('tool', ['one'], { stdio: { stdin: input, stdout: output, stderr: writer() } });
    assert.equal((await p.exited).code, 0);
    assert.deepEqual(input.requests, [1]);
    assert.equal(input.remaining, 2);
    assert.equal(decode(output.bytes), 'x');
    assert.equal(input.closed + output.closed, 0, 'the caller keeps ownership after exit');
  } finally { await c.dispose(); }
});

test('delegated binary copy follows partial writes and exact end of file', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const data = Uint8Array.from({ length: 200003 }, (_, i) => (i * 7) % 256);
    const input = reader(data), output = writer({ limit: 4093 });
    const p = await c.spawn('tool', [], { stdio: { stdin: input, stdout: output } });
    assert.equal((await p.exited).code, 0);
    assert.deepEqual(output.bytes, data);
    assert(input.requests.every(n => n > 0 && n <= 65536));
    assert(output.requests.every(n => n > 0 && n <= 65536));
    // Delegated channels are no longer container streams; stderr stays container-owned.
    assert.equal((await p.stdout.getReader().read()).done, true);
    await assert.rejects(p.stdin.getWriter().write(new Uint8Array([1])));
    assert.equal((await new Response(p.stderr).arrayBuffer()).byteLength, 0);
  } finally { await c.dispose(); }
});

test('delegated EPIPE reaches the guest as its own errno', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const output = writer({ failure: Object.assign(new Error('closed reader'), { code: 'EPIPE' }) });
    const p = await c.spawn('tool', ['yes'], { stdio: { stdout: output } });
    assert.deepEqual(await p.exited, { code: 64, reason: 'exited' });
    const unknown = writer({ failure: new Error('opaque') });
    const q = await c.spawn('tool', ['yes'], { stdio: { stdout: unknown } });
    assert.deepEqual(await q.exited, { code: 29, reason: 'exited' }, 'unknown endpoint failures become EIO');
  } finally { await c.dispose(); }
});

test('guest fd_close closes the delegated endpoint once and null starts closed', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const output = writer(), input = reader(new Uint8Array());
    const p = await c.spawn('tool', ['close-output'], { stdio: { stdin: input, stdout: output } });
    assert.equal((await p.exited).code, 0);
    assert.equal(decode(output.bytes), 'eof');
    assert.equal(output.closed, 1); assert.equal(input.closed, 0);
    const q = await c.spawn('tool', ['flood'], { stdio: { stdout: null } });
    assert.deepEqual(await q.exited, { code: 8, reason: 'exited' }, 'EBADF from a closed stdout');
  } finally { await c.dispose(); }
});

test('delegated stdio is limited to live spawn', { timeout: 30000 }, async () => {
  const c = make();
  try {
    await assert.rejects(c.spawn('batch', [], { stdio: { stdout: writer() } }), { code: 'UNSUPPORTED_PROFILE' });
    await assert.rejects(c.run('tool', [], { stdio: {} }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(c.spawnPipeline([{ command: 'tool' }, { command: 'tool' }], { stdio: {} }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(c.spawn('tool', [], { stdio: { stdout: { write() {} } } }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(c.spawn('tool', [], { stdio: { other: null } }), { code: 'INVALID_ARGUMENT' });
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});

test('host command handler runs the routed command with shell argv, environment and stdio', { timeout: 30000 }, async () => {
  const c = make(), records = [];
  try {
    const handler = createHostCommandHandler(c, {
      routes: { '/opt/host/bin/probe': { command: 'probe' }, '/opt/host/bin/tool': { command: 'tool' } },
      onRecord: (record) => records.push(record)
    });
    const stdout = writer(), stderr = writer();
    const status = await handler({
      path: '/opt/host/bin/probe', argv: ['probe', 'roundtrip', 'space arg', '한글', ''], cwd: '/workspace',
      env: [encode('A=1'), encode('EMPTY='), encode('KO=값')], stdin: reader(new Uint8Array()), stdout, stderr
    });
    assert.equal(status, 0);
    assert.deepEqual(decode(stdout.bytes).split('\0'), ['probe', 'roundtrip', 'space arg', '한글', '', '']);
    assert.deepEqual(decode(stderr.bytes).split('\0').filter(Boolean).sort(), ['A=1', 'EMPTY=', 'KO=값']);
    assert.equal(decode(c.fs.readFile('/workspace/out.bin')), 'saved');
    const exit = await handler({ path: '/opt/host/bin/probe', argv: ['probe', 'exit'], cwd: '/workspace', env: [], stdin: null, stdout: writer(), stderr: writer() });
    assert.equal(exit, 23);
    const crash = await handler({ path: '/opt/host/bin/tool', argv: ['tool', 'crash'], cwd: '/workspace', env: [], stdin: null, stdout: writer(), stderr: writer() });
    assert.equal(crash, HOST_COMMAND_STATUS.runtimeError);
    assert.deepEqual(records.map(r => [r.status, r.result?.reason]), [[0, 'exited'], [23, 'exited'], [134, 'runtime-error']]);
  } finally { await c.dispose(); }
});

test('host command start failures keep the shell alive with a status and diagnostic', { timeout: 30000 }, async () => {
  const c = make(), records = [];
  try {
    const handler = createHostCommandHandler(c, { routes: { '/opt/host/bin/tool': { command: 'tool' }, '/opt/host/bin/gone': { command: 'missing' } }, onRecord: (record) => records.push(record) });
    const base = { cwd: '/workspace', env: [], stdin: null, stdout: writer() };
    const unrouted = writer();
    assert.equal(await handler({ ...base, path: '/opt/host/bin/other', argv: ['other'], stderr: unrouted }), 127);
    assert.match(decode(unrouted.bytes), /^other: /);
    assert.equal(await handler({ ...base, path: '/opt/host/bin/gone', argv: ['gone'], stderr: writer() }), 127);
    assert.equal(await handler({ ...base, path: '/opt/host/bin/tool', argv: ['tool'], env: [new Uint8Array([0x41, 0x3d, 0xff])], stderr: writer() }), 126);
    assert.equal(await handler({ ...base, path: '/opt/host/bin/tool', argv: ['tool'], env: [encode('A=1'), encode('A=2')], stderr: writer() }), 126);
    const missing = writer();
    assert.equal(await handler({ ...base, path: '/opt/host/bin/tool', argv: ['tool'], cwd: '/workspace/absent', stderr: missing }), 126);
    assert.match(decode(missing.bytes), /^tool: /);
    assert.deepEqual(records.map(r => r.startError), ['COMMAND_NOT_FOUND', 'COMMAND_NOT_FOUND', 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'ENOENT']);
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});

test('forwarded routes run snapshot commands with empty stdin and copied output', { timeout: 30000 }, async () => {
  const c = createContainer({
    adapters: [createWasiAdapter({ workerFactory })], maxProcesses: 4,
    commands: { snap: { adapter: 'wasi-preview1', bytes: command } }
  });
  try {
    const handler = createHostCommandHandler(c, { routes: { '/usr/bin/snap': { command: 'snap', stdio: 'forwarded' } } });
    const base = { path: '/usr/bin/snap', cwd: '/workspace', env: [encode('A=1')] };
    const stdin = reader(encode('shell input')), stdout = writer(), stderr = writer();
    assert.equal(await handler({ ...base, argv: ['snap', 'roundtrip'], stdin, stdout, stderr }), 0);
    assert.deepEqual(decode(stdout.bytes).split('\0'), ['snap', 'roundtrip', '']);
    assert.equal(decode(stderr.bytes), 'A=1\0');
    assert.equal(decode(c.fs.readFile('/workspace/out.bin')), 'saved', 'the snapshot commits into the workspace');
    const echo = writer();
    assert.equal(await handler({ ...base, argv: ['snap'], stdin, stdout: echo, stderr: writer() }), 0);
    assert.equal(echo.bytes.length, 0, 'stdin is empty');
    assert.deepEqual(stdin.requests, [], "the shell's stdin is never read");
    const partial = writer({ limit: 1000 }), partialErr = writer({ limit: 999 });
    assert.equal(await handler({ ...base, argv: ['snap', 'flood'], stdin: null, stdout: partial, stderr: partialErr }), 0);
    assert.equal(partial.bytes.length, 65536); assert.equal(partialErr.bytes.length, 65536);
    const closed = writer({ failure: Object.assign(new Error('closed reader'), { code: 'EPIPE' }) });
    assert.equal(await handler({ ...base, argv: ['snap', 'flood'], stdin: null, stdout: closed, stderr: null }), 0, 'output is drained after the descriptor fails');
    assert.equal(closed.requests.length, 1);
    assert.equal(await handler({ ...base, argv: ['snap', 'exit'], stdin: null, stdout: writer(), stderr: writer() }), 23);
    assert.equal(decode(c.fs.readFile('/workspace/partial')), 'saved');
    assert.throws(() => createHostCommandHandler(c, { routes: { '/usr/bin/snap': { command: 'snap', stdio: 'pty' } } }), { code: 'INVALID_ARGUMENT' });
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});

test('modules below a registered directory run with wasm-run on the live artifact adapter', { timeout: 30000 }, async () => {
  const c = createContainer({
    adapters: [createLiveWasiAdapter({ workerFactory: liveWorker })], artifactAdapter: 'wasi-preview1-live', maxProcesses: 4,
    commands: { tool: { adapter: 'wasi-preview1-live', bytes: live } }
  });
  const records = [];
  try {
    c.fs.mkdir('/workspace/demo/bin', { recursive: true });
    c.fs.writeFile('/workspace/demo/bin/probe.wasm', command);
    const handler = createHostCommandHandler(c, {
      routes: { '/workspace/demo/bin/exact.wasm': { command: 'tool', args: ['one'] } },
      moduleDirectories: ['/workspace'], onRecord: (record) => records.push(record)
    });
    const base = { cwd: '/workspace/demo', env: [], stdin: null };
    const stdout = writer();
    assert.equal(await handler({ ...base, path: '/workspace/demo/bin/probe.wasm', argv: ['./bin/probe.wasm', 'roundtrip', 'x'], stdout, stderr: writer() }), 0);
    assert.deepEqual(decode(stdout.bytes).split('\0'), ['/workspace/demo/bin/probe.wasm', 'roundtrip', 'x', '']);
    assert.equal(decode(c.fs.readFile('/workspace/demo/out.bin')), 'saved', 'the module runs in the shell cwd');
    const exact = writer();
    assert.equal(await handler({ ...base, path: '/workspace/demo/bin/exact.wasm', argv: ['exact'], stdin: reader(encode('ab')), stdout: exact, stderr: writer() }), 0);
    assert.equal(decode(exact.bytes), 'a', 'an exact route wins over the directory');
    for (const path of ['/workspace/demo/./bin/probe.wasm', '/workspacex/probe.wasm', '/workspace'])
      assert.equal(await handler({ ...base, path, argv: ['x'], stdout: writer(), stderr: writer() }), 127, path);
    const absent = writer();
    assert.equal(await handler({ ...base, path: '/workspace/demo/bin/absent.wasm', argv: ['absent'], stdout: writer(), stderr: absent }), 126);
    assert.match(decode(absent.bytes), /^absent: /);
    assert.deepEqual(records.map((record) => [record.status, record.startError ?? record.result?.reason]),
      [[0, 'exited'], [0, 'exited'], [127, 'COMMAND_NOT_FOUND'], [127, 'COMMAND_NOT_FOUND'], [127, 'COMMAND_NOT_FOUND'], [126, 'ENOENT']]);
    for (const moduleDirectories of [['/'], ['relative'], ['/workspace/'], ['/a/../b'], [42]])
      assert.throws(() => createHostCommandHandler(c, { routes: {}, moduleDirectories }), { code: 'INVALID_ARGUMENT' });
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});

test('interrupt stops running and starting commands with status 130 and keeps the handler usable', { timeout: 30000 }, async () => {
  const c = createContainer({
    adapters: [createLiveWasiAdapter({ workerFactory: liveWorker }), createWasiAdapter({ workerFactory })], maxProcesses: 4,
    commands: { probe: { adapter: 'wasi-preview1-live', bytes: command }, snap: { adapter: 'wasi-preview1', bytes: command } }
  });
  const records = [];
  try {
    const handler = createHostCommandHandler(c, {
      routes: { '/bin/probe': { command: 'probe' }, '/bin/snap': { command: 'snap', stdio: 'forwarded' } },
      onRecord: (record) => records.push(record)
    });
    assert.equal(handler.interrupt(), 0, 'nothing to interrupt');
    const base = { cwd: '/workspace', env: [], stdin: null };
    const started = async () => {
      while (!(await c.inspect()).processes.some((process) => process.state === 'running')) await new Promise((done) => setTimeout(done, 10));
    };
    // A live CPU loop with delegated stdio, and a snapshot loop on a forwarded route.
    for (const path of ['/bin/probe', '/bin/snap']) {
      const stdout = writer(), stderr = writer();
      const pending = handler({ ...base, path, argv: [path, 'loop'], stdout, stderr });
      await started();
      assert.equal(handler.interrupt(), 1);
      assert.equal(await pending, HOST_COMMAND_STATUS.interrupted);
      assert.equal(stderr.bytes.length, 0, 'no diagnostic for an interrupt');
      assert.equal((await c.inspect()).processes.length, 0);
    }
    // Interrupted while starting, before the guest runs.
    const early = handler({ ...base, path: '/bin/probe', argv: ['probe', 'loop'], stdout: writer(), stderr: writer() });
    assert.equal(handler.interrupt(), 1);
    assert.equal(await early, HOST_COMMAND_STATUS.interrupted);
    // An interrupted snapshot never commits, and the handler keeps running later commands.
    assert.throws(() => c.fs.readFile('/workspace/out.bin'), { code: 'ENOENT' });
    const after = writer();
    assert.equal(await handler({ ...base, path: '/bin/snap', argv: ['snap', 'roundtrip'], stdout: after, stderr: writer() }), 0);
    assert.equal(decode(c.fs.readFile('/workspace/out.bin')), 'saved');
    assert.deepEqual(records.slice(0, 2).map((record) => [record.status, record.result?.reason]), [[130, 'terminated'], [130, 'terminated']]);
    assert.equal(records[2].status, 130);
    assert(['ABORTED', undefined].includes(records[2].startError) && (records[2].startError || records[2].result?.reason === 'terminated'));
    assert.deepEqual([records[3].status, records[3].result?.reason], [0, 'exited']);
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});

for (const action of ['interrupt', 'dispose']) {
  test(`${action} releases forwarded output after the snapshot process has exited`, { timeout: 30000 }, async () => {
    const c = createContainer({ adapters: [createWasiAdapter({ workerFactory })], commands: { snap: { adapter: 'wasi-preview1', bytes: command } } });
    const pipe = createPipe(1), records = [];
    let writes = 0, closes = 0, rejected = 0, reached;
    const blocked = new Promise(resolve => { reached = resolve; });
    const output = {
      write(bytes) {
        if (++writes === 2) reached();
        return pipe.writer.write(bytes).catch(error => { rejected++; throw error; });
      },
      close() { closes++; pipe.writer.close(); }
    };
    const input = reader(encode('unread'));
    try {
      const handler = createHostCommandHandler(c, {
        routes: { '/bin/snap': { command: 'snap', stdio: 'forwarded' } }, onRecord: record => records.push(record)
      });
      const invocation = { path: '/bin/snap', argv: ['snap', 'roundtrip'], env: [], cwd: '/workspace', stdin: input, stdout: output, stderr: output };
      const pending = handler(invocation);
      await blocked;
      assert.equal((await c.inspect()).processes.length, 0, 'the snapshot is committed before output forwarding');
      if (action === 'interrupt') assert.equal(handler.interrupt(), 1);
      else {
        const disposal = c.dispose();
        assert(c.disposalSignal.aborted, 'disposal is observable immediately');
        assert.equal(c.dispose(), disposal, 'disposal remains idempotent');
        await disposal;
      }
      assert.equal(await pending, action === 'interrupt' ? 130 : 143);
      assert.equal(closes, 1, 'the same child stdout/stderr endpoint is closed once');
      assert.equal(rejected, 1, 'closing the writer releases its blocked write');
      assert.equal(writes, 2, 'no output is issued after cancellation');
      assert.equal(input.closed, 0, 'the shell input remains owned and unconsumed');
      assert.deepEqual(input.requests, []);
      assert.equal(decode(c.fs.readFile('/workspace/out.bin')), 'saved', 'interrupt after commit does not roll back committed files');
      assert.equal((await pipe.reader.read(1)).length, 1, 'already written bytes stay readable');
      assert.equal((await pipe.reader.read(1)).length, 0, 'writer cancellation delivers EOF');
      assert.equal(handler.interrupt(), 0);
      assert.equal(records.length, 1, 'exactly one terminal record');
      assert.equal(records[0].result.reason, 'exited', 'guest result remains distinguishable from forwarding cancellation');
      if (action === 'interrupt') {
        assert.equal(await handler({ ...invocation, stdout: writer(), stderr: writer() }), 0);
      }
    } finally { pipe.abort(); await c.dispose(); }
  });
}

test('interrupt observes a late forwarded endpoint rejection without waiting for it', { timeout: 30000 }, async () => {
  const c = createContainer({ adapters: [createWasiAdapter({ workerFactory })], commands: { snap: { adapter: 'wasi-preview1', bytes: command } } });
  let entered, rejectWrite, closes = 0;
  const blocked = new Promise(resolve => { entered = resolve; });
  const output = {
    write() { entered(); return new Promise((resolve, reject) => { rejectWrite = reject; }); },
    close() { closes++; /* An external runtime may acknowledge close asynchronously. */ }
  };
  try {
    const handler = createHostCommandHandler(c, { routes: { '/bin/snap': { command: 'snap', stdio: 'forwarded' } } });
    const pending = handler({ path: '/bin/snap', argv: ['snap', 'roundtrip'], env: [], cwd: '/workspace', stdin: null, stdout: output, stderr: null });
    await blocked;
    handler.interrupt();
    assert.equal(await pending, 130);
    assert.equal(closes, 1);
    rejectWrite(new Error('late child close acknowledgement'));
    await new Promise(resolve => setImmediate(resolve));
  } finally { await c.dispose(); }
});
