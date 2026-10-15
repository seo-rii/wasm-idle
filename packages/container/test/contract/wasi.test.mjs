import assert from 'node:assert/strict';
import test from 'node:test';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { workerFactory, command } from './node-worker.mjs';
const make = (options = {}) => createContainer({ adapters: [createWasiAdapter({ workerFactory })], commands: { tool: { adapter: 'wasi-preview1', bytes: command } }, ...options });
const decode = (bytes) => new TextDecoder().decode(bytes);

test('PROC-01/02: real Wasm argv/env/cwd, binary stdin, and nonzero files', async () => {
  const c = make();
  try {
    c.fs.mkdir('/workspace/a b');
    const result = await c.run('tool', ['roundtrip', '', '한 글', 'a\\b'], { cwd: '/workspace/a b', env: { TEST: '한 글' } });
    assert.equal(result.code, 0);
    assert.equal(decode(result.stdout), 'tool\0roundtrip\0\0한 글\0a\\b\0');
    assert.equal(decode(result.stderr), 'TEST=한 글\0');
    assert.equal(decode(c.fs.readFile('/workspace/a b/out.bin')), 'saved');
    assert.throws(() => c.fs.stat('/workspace/out.bin'));
    const bytes = Uint8Array.from({ length: 8193 }, (_, i) => i % 256);
    assert.deepEqual((await c.run('tool', [], { stdin: bytes })).stdout, bytes);
    assert.equal((await c.run('tool', ['exit'])).code, 23);
    assert.equal(decode(c.fs.readFile('/workspace/partial')), 'saved');
  } finally { await c.dispose(); }
});
test('FS-05/06: crash discards changes and lease rejects editor write', async () => {
  const c = make();
  try {
    assert.equal((await c.run('tool', ['crash'])).reason, 'runtime-error');
    assert.throws(() => c.fs.stat('/workspace/crash'));
    const p = await c.spawn('tool');
    assert.throws(() => c.fs.writeFile('/workspace/editor', new Uint8Array([1])), { code: 'EBUSY' });
    await p.terminate(); await p.terminate();
    assert.equal((await p.exited).reason, 'terminated');
    c.fs.writeFile('/workspace/editor', new Uint8Array([1]));
  } finally { await c.dispose(); }
});
test('PROC-03/04: terminate CPU loop and run again, timeout and aborted startup', async () => {
  const c = make();
  try {
    const p = await c.spawn('tool', ['loop']); await p.stdin.getWriter().close();
    await new Promise((r) => setTimeout(r, 30)); await p.terminate();
    assert.deepEqual(await p.exited, { code: null, reason: 'terminated' });
    assert.equal((await c.run('tool')).code, 0);
    // Includes Worker startup. Allow loaded CI machines to reach the actual loop.
    const result = await c.run('tool', ['loop'], { timeoutMs: 5000 });
    assert.equal(result.reason, 'timeout');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(c.spawn('tool', [], { signal: abort.signal }), { code: 'ABORTED' });
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});
test('PROC-05: containers isolate files and disposal keeps memory data', async () => {
  const a = make(), b = make();
  try {
    await a.run('tool', ['exit']); assert.throws(() => b.fs.stat('/workspace/partial'));
    await a.dispose(); await a.dispose();
    assert.equal(decode(a.fs.readFile('/workspace/partial')), 'saved');
    await assert.rejects(a.run('tool'), { code: 'DISPOSED' });
    await assert.rejects(b.flush(), { code: 'UNSUPPORTED_PROFILE' });
  } finally { await a.dispose(); await b.dispose(); }
});
test('FD-03: real stdout/stderr floods, capture cap, output budget, invalid guest pointer', async () => {
  const c = make(); const bounded = make({ maxOutputBytes: 32 });
  try {
    const r = await c.run('tool', ['flood']); assert.equal(r.code, 0);
    assert.equal(r.stdout.length, 65536); assert.deepEqual(r.stdout, r.stderr);
    await assert.rejects(c.run('tool', ['flood'], { maxCaptureBytes: 64 }), { code: 'CAPTURE_LIMIT' });
    assert.equal((await bounded.run('tool', ['flood'])).reason, 'runtime-error');
    assert.equal((await c.run('tool', ['bad'])).code, 0);
    assert.equal((await c.run('tool')).code, 0);
  } finally { await c.dispose(); await bounded.dispose(); }
});
test('unsupported executable memory profile fails before a handle and frees lease', async () => {
  const c = make({ maxMemoryBytes: 65536 });
  try { await assert.rejects(c.run('tool'), { code: 'UNSUPPORTED_PROFILE' }); c.fs.writeFile('/workspace/ok', new Uint8Array()); assert.equal((await c.inspect()).processes.length, 0); }
  finally { await c.dispose(); }
});

test('guest receives configured filesystem quotas at its syscall boundary', async () => {
  const c = make({ maxBytes: 4 });
  try {
    const result = await c.run('tool', ['exit']);
    assert.equal(result.reason, 'exited'); assert.equal(result.code, 91);
    assert.equal(c.fs.stat('/workspace/partial').size, 0);
  } finally { await c.dispose(); }
});
