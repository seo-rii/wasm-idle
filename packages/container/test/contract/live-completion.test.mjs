import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createLiveWorkerAdapter } from '../../dist/adapters/live-worker.js';
import { workerFactory } from './node-worker.mjs';

const bytes = new Uint8Array(readFileSync(new URL('../fixtures/live.wasm', import.meta.url)));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const drain = stream => new Response(stream).arrayBuffer();

test('termination revokes asynchronous owner completion and retires the real worker exactly once', { timeout: 15000 }, async () => {
  const entered = deferred(), resume = deferred(); let completionSignal, disposed = 0, invocations = 0;
  const adapter = createLiveWorkerAdapter({ id: 'test-owner-completion',
    workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js'),
    configure: () => {
      const ordinal = ++invocations;
      return {
        async complete(_code, signal) {
          if (ordinal === 1) { completionSignal = signal; entered.resolve(); await resume.promise; }
        },
        dispose() { disposed++; }
      };
    }
  });
  const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } } });
  try {
    const p = await c.spawn('tool', ['non-tty']);
    const output = Promise.all([drain(p.stdout), drain(p.stderr)]);
    await p.stdin.getWriter().close(); await entered.promise;
    assert.equal(completionSignal.aborted, false);
    await p.terminate(); await p.terminate();
    assert.equal(completionSignal.aborted, true);
    assert.deepEqual(await p.exited, { code: null, reason: 'terminated' });
    resume.resolve(); await output;
    assert.equal(disposed, 1);
    assert.equal((await c.run('tool', ['non-tty'])).code, 0);
    assert.equal(disposed, 2);
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { resume.resolve(); await c.dispose(); }
});

test('owner completion failure returns runtime-error and a subsequent real command succeeds', { timeout: 15000 }, async () => {
  let first = true, disposed = 0;
  const adapter = createLiveWorkerAdapter({ id: 'test-failed-completion',
    workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js'),
    configure: () => ({ complete() { if (first) { first = false; throw new Error('Owner qualification failed'); } }, dispose() { disposed++; } })
  });
  const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } } });
  try {
    assert.equal((await c.run('tool', ['non-tty'])).reason, 'runtime-error');
    assert.equal((await c.run('tool', ['non-tty'])).code, 0);
    assert.equal(disposed, 2);
    assert.equal((await c.inspect()).processes.length, 0);
  } finally { await c.dispose(); }
});
