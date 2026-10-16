import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { command, workerFactory } from './node-worker.mjs';

const make = (bytes = command) => createContainer({
  adapters: [createWasiAdapter({ workerFactory })],
  commands: { tool: { adapter: 'wasi-preview1', bytes } }
});
const input = () => Buffer.from(Uint8Array.from({ length: 8193 }, (_, index) => index % 256));

test('registered Wasm bytes own Buffer input before its caller changes the module', async () => {
  const bytes = Buffer.from(command), container = make(bytes);
  bytes.fill(0);
  try {
    const result = await container.run('tool', ['exit']);
    assert.equal(result.code, 23);
    assert.equal(result.reason, 'exited');
    assert.equal(new TextDecoder().decode(container.fs.readFile('/workspace/partial')), 'saved');
  } finally { await container.dispose(); }
});

test('accepted batch stdin owns Buffer bytes until input EOF starts the real guest', async () => {
  const container = make();
  try {
    const process = await container.spawn('tool'), writer = process.stdin.getWriter();
    const bytes = input(), expected = Uint8Array.from(bytes);
    try {
      await writer.write(bytes);
      bytes.fill(120);
      await writer.close();
    } finally { writer.releaseLock(); }
    const [stdout, stderr, result] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).arrayBuffer(),
      process.exited
    ]);
    assert.deepEqual(new Uint8Array(stdout), expected);
    assert.equal(stderr.byteLength, 0);
    assert.deepEqual(result, { code: 0, reason: 'exited' });
  } finally { await container.dispose(); }
});

test('run snapshots Buffer stdin before asynchronous Worker startup completes', async () => {
  const container = make(), bytes = input(), expected = Uint8Array.from(bytes);
  try {
    const running = container.run('tool', [], { stdin: bytes });
    bytes.fill(120);
    const result = await running;
    assert.deepEqual(result.stdout, expected);
    assert.equal(result.stderr.byteLength, 0);
    assert.equal(result.code, 0);
    assert.equal(result.reason, 'exited');
  } finally { await container.dispose(); }
});
