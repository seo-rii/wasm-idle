import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { workerFactory } from './node-worker.mjs';
const bytes = new Uint8Array(readFileSync(new URL('../fixtures/live.wasm', import.meta.url)));
const liveWorker = () => workerFactory('../../dist/adapters/wasi-live/worker.js');
const make = (options = {}, adapterOptions = {}) => createContainer({
  adapters: [createLiveWasiAdapter({ workerFactory: liveWorker, ...adapterOptions }), createWasiAdapter({ workerFactory })],
  artifactAdapter: 'wasi-preview1-live',
  commands: { tool: { adapter: 'wasi-preview1-live', bytes }, batch: { adapter: 'wasi-preview1', bytes } }, ...options
});
const encode = (value) => new TextEncoder().encode(value), decode = (value) => new TextDecoder().decode(value);
async function drain(stream) { return new Uint8Array(await new Response(stream).arrayBuffer()); }

test('owner-only process token attributes real live Worker writes without hiding editor changes', { timeout: 30000 }, async () => {
  const c = make(), observer = c.fs.observeMutations();
  let reader;
  try {
    const process = await c.spawn('tool', ['visible']);
    assert.equal(typeof process.mutationSource, 'object');
    reader = process.stdout.getReader();
    assert.equal(decode((await reader.read()).value), 'ready');
    assert.equal(observer.hasChangesOutside(new Set()), true);
    assert.equal(observer.hasChangesOutside(new Set([process.mutationSource])), false);
    c.fs.writeFile('/workspace/header.h', encode('editor'));
    assert.equal(observer.hasChangesOutside(new Set([process.mutationSource])), true);
    await process.terminate();
  } finally { reader?.releaseLock(); observer.dispose(); await c.dispose(); }
});

test('live reads and writes preserve partial binary data larger than RPC and pipe buffers', { timeout: 30000 }, async () => {
  const c = make({}, { pipeBytes: 4093 });
  try {
    const input = Uint8Array.from({ length: 262147 }, (_, i) => i % 256);
    const result = await c.run('tool', [], { stdin: input });
    assert.equal(result.code, 0); assert.deepEqual(result.stdout, input);
    const flood = await c.run('tool', ['flood']);
    assert.equal(flood.code, 0); assert.equal(flood.stdout.length, 131073); assert.deepEqual(flood.stdout, flood.stderr);
    assert.equal((await c.run('tool', ['non-tty'])).code, 0);
    assert.equal((await c.run('batch', ['non-tty'])).code, 0);
    c.fs.writeFile('/workspace/app', bytes);
    assert.equal((await c.run('wasm-run', ['./app', 'non-tty'])).code, 0);
  } finally { await c.dispose(); }
});
test('FS-07: two real live guests and editor see updates while first process is still running', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const p = await c.spawn('tool', ['visible']), out = p.stdout.getReader(), input = p.stdin.getWriter();
    assert.equal(decode((await out.read()).value), 'ready');
    assert.equal((await c.inspect()).processes.length, 1);
    assert.equal(decode(c.fs.readFile('/workspace/visible')), 'before');
    assert.equal(decode((await c.run('tool', ['read'])).stdout), 'before');
    c.fs.writeFile('/workspace/visible', encode('edited'));
    await assert.rejects(c.run('batch'), (error) => error.code === 'STARTUP_FAILED' && error.cause.code === 'EBUSY');
    await input.write(new Uint8Array([1]));
    assert.equal(decode((await out.read()).value), 'edited');
    assert.equal((await out.read()).done, true); assert.equal((await p.exited).code, 0);
    await input.close(); input.releaseLock(); out.releaseLock();
    assert.equal((await c.run('batch')).code, 0);
  } finally { await c.dispose(); }
});
test('live crash keeps visible writes, and another container cannot read them', { timeout: 30000 }, async () => {
  const a = make(), b = make();
  try {
    assert.equal((await a.run('tool', ['crash'])).reason, 'runtime-error');
    assert.equal(decode(a.fs.readFile('/workspace/visible')), 'before');
    assert.throws(() => b.fs.stat('/workspace/visible'), { code: 'ENOENT' });
    assert.equal((await a.run('tool')).code, 0);
  } finally { await a.dispose(); await b.dispose(); }
});
test('FD-04: guest close delivers buffered output and EOF before process exit', { timeout: 30000 }, async () => {
  const c = make();
  try {
    const p = await c.spawn('tool', ['close-output']);
    assert.equal(decode(await drain(p.stdout)), 'eof');
    assert.equal((await c.inspect()).processes.length, 1);
    await p.stdin.getWriter().close(); assert.equal((await p.exited).code, 0);
  } finally { await c.dispose(); }
});
test('cancel wakes blocked input, blocked output and CPU loop; each permits another run', { timeout: 30000 }, async () => {
  const c = make({}, { pipeBytes: 32 });
  try {
    for (const mode of ['copy', 'flood', 'loop']) {
      const p = await c.spawn('tool', [mode]);
      await new Promise(resolve => setTimeout(resolve, 30));
      await p.terminate(); await p.terminate();
      assert.deepEqual(await p.exited, { code: null, reason: 'terminated' });
      await drain(p.stdout); await drain(p.stderr);
      assert.equal((await c.run('tool')).code, 0);
    }
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});
test('bounded capture, output and idle-I/O deadlines clean up the live owner', { timeout: 30000 }, async () => {
  const c = make(), limited = make({ maxOutputBytes: 32 }), idle = make({}, { maxBlockedIoMs: 100 });
  try {
    await assert.rejects(c.run('tool', ['flood'], { maxCaptureBytes: 64 }), { code: 'CAPTURE_LIMIT' });
    assert.equal((await limited.run('tool', ['flood'])).reason, 'runtime-error');
    const p = await idle.spawn('tool'); assert.equal((await p.exited).reason, 'runtime-error');
    assert.equal((await c.run('tool')).code, 0); assert.equal((await idle.inspect()).processes.length, 0);
  } finally { await c.dispose(); await limited.dispose(); await idle.dispose(); }
});
test('FD-05/06: real yes/one pipeline breaks upstream pipe and reserves all consumers', { timeout: 30000 }, async () => {
  const c = make({ maxProcesses: 2 });
  try {
    await assert.rejects(c.spawnPipeline([{ command: 'tool' }, { command: 'tool' }, { command: 'tool' }]), { code: 'RESOURCE_LIMIT' });
    assert.equal((await c.inspect()).processes.length, 0);
    const pipeline = await c.spawnPipeline([{ command: 'tool', args: ['yes'] }, { command: 'tool', args: ['one'] }]);
    const output = drain(pipeline.stdout), errors = Promise.all(pipeline.stderr.map(drain));
    await pipeline.stdin.getWriter().close();
    assert.equal(decode(await output), 'y');
    assert.deepEqual((await pipeline.exited).map(result => result.code), [64, 0]);
    assert.deepEqual((await errors).map(bytes => bytes.length), [0, 0]);
    assert.equal((await c.inspect()).processes.length, 0);
    assert.equal((await c.run('tool', ['one'], { stdin: new Uint8Array(131073) })).code, 0);
  } finally { await c.dispose(); }
});
test('pipeline preparation failure releases every reservation and already started consumer', { timeout: 30000 }, async () => {
  const c = make({ maxProcesses: 2, commands: { tool: { adapter: 'wasi-preview1-live', bytes }, bad: { adapter: 'wasi-preview1-live', bytes: new Uint8Array([1]) } } });
  try {
    await assert.rejects(c.spawnPipeline([{ command: 'bad' }, { command: 'tool' }]), { code: 'UNSUPPORTED_PROFILE' });
    assert.equal((await c.inspect()).processes.length, 0);
    assert.equal((await c.run('tool')).code, 0);
  } finally { await c.dispose(); }
});

test('one fd_read scatters a partial stream read without waiting on another iovec', { timeout: 30000 }, async () => {
  const c = make();
  let timer;
  try {
    const p = await c.spawn('tool', ['readv']), writer = p.stdin.getWriter();
    const output = drain(p.stdout);
    await writer.write(new Uint8Array([65]));
    const observed = await Promise.race([output, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fd_read waited for EOF after already reading one byte')), 5000);
    })]);
    assert.deepEqual(observed, new Uint8Array([65]));
    assert.equal((await p.exited).code, 0);
    await writer.close(); writer.releaseLock();
  } finally { clearTimeout(timer); await c.dispose(); }
});
