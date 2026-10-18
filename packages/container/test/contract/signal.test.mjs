import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory, command } from './node-worker.mjs';

const make = () => createContainer({
  maxProcesses: 1,
  adapters: [createWasiAdapter({ workerFactory })],
  commands: { tool: { adapter: 'wasi-preview1', bytes: command } }
});
async function dispose(container) {
  let timer;
  try {
    await Promise.race([container.dispose(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('dispose did not reclaim the process')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

test('invalid host signals do not consume process admission or block dispose', { timeout: 10000 }, async () => {
  const c = make();
  try {
    for (const signal of [null, {}, { aborted: false }, { aborted: false, addEventListener() {} }]) {
      await assert.rejects(c.spawn('tool', [], { signal }), { code: 'INVALID_ARGUMENT' });
      assert.equal((await c.inspect()).processes.length, 0);
    }
    assert.equal((await c.run('tool', ['exit'])).code, 23);
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await dispose(c); }
});

test('throwing signal listener registration still performs startup cleanup', { timeout: 10000 }, async () => {
  const c = make(), controller = new AbortController();
  const add = controller.signal.addEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { add(...args); throw new Error('listener registration failed'); };
  try {
    await assert.rejects(c.spawn('tool', [], { signal: controller.signal }), { code: 'STARTUP_FAILED' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal((await c.inspect()).processes.length, 0);
    assert.equal((await c.run('tool', ['exit'])).code, 23);
  } finally { await dispose(c); }
});

test('throwing signal listener removal cannot abandon a returned runtime', { timeout: 10000 }, async () => {
  const c = make(), controller = new AbortController();
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { remove(...args); throw new Error('listener removal failed'); };
  try {
    const result = await c.run('tool', ['exit'], { signal: controller.signal });
    assert.equal(result.reason, 'runtime-error');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal((await c.inspect()).processes.length, 0);
    assert.equal((await c.run('tool', ['exit'])).code, 23);
  } finally { await dispose(c); }
});

test('invalid pipeline signals leave all reservations available to a real pipeline', { timeout: 10000 }, async () => {
  const c = createContainer({
    maxProcesses: 2,
    adapters: [createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') })],
    commands: { tool: { adapter: 'wasi-preview1-live', bytes: command } }
  });
  const commands = [{ command: 'tool' }, { command: 'tool' }];
  try {
    await assert.rejects(c.spawnPipeline(commands, { signal: { aborted: false } }), { code: 'INVALID_ARGUMENT' });
    assert.equal((await c.inspect()).processes.length, 0);
    const pipeline = await c.spawnPipeline(commands);
    const output = new Response(pipeline.stdout).arrayBuffer();
    const errors = Promise.all(pipeline.stderr.map(stream => new Response(stream).arrayBuffer()));
    const writer = pipeline.stdin.getWriter();
    await writer.write(new Uint8Array([0, 255, 9])); await writer.close(); writer.releaseLock();
    assert.deepEqual(new Uint8Array(await output), new Uint8Array([0, 255, 9]));
    assert.deepEqual((await pipeline.exited).map(result => result.code), [0, 0]);
    assert.ok((await errors).every(bytes => bytes.byteLength === 0));
  } finally { await dispose(c); }
});
