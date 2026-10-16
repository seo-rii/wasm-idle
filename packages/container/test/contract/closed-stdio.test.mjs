import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { workerFactory } from './node-worker.mjs';
import { createRemoteStdio } from '../../dist/adapters/wasi-live/io.js';

const bytes = new Uint8Array(readFileSync(new URL('../fixtures/closed-stdio.wasm', import.meta.url)));
test('remote initial stdio state is validated, copied and tracks explicit close', () => {
  const calls = [], initial = [0, 1, 2];
  const stdio = createRemoteStdio((...args) => { calls.push(args); return {}; }, initial);
  initial.pop(); assert.equal(stdio.isOpen(2), true);
  stdio.close(1); assert.equal(stdio.isOpen(1), false); assert.equal(calls.length, 1);
  assert.throws(() => stdio.close(1), { code: 'EBADF' }); assert.equal(calls.length, 1);
  for (const invalid of [[-1], [3], [0, 0], [NaN], [0.5], '0']) {
    assert.throws(() => createRemoteStdio(() => {}, invalid), { code: 'EINVAL' });
  }
});
test('real guest sees initially closed stdio consistently across metadata, zero I/O and close', { timeout: 15000 }, async () => {
  const live = createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') });
  const batch = createWasiAdapter({ workerFactory });
  const container = createContainer({ adapters: [live, batch], commands: {
    closed: { adapter: live.id, bytes }, batch: { adapter: batch.id, bytes }
  } });
  try {
    for (let mask = 0; mask < 8; mask++) {
      const stdio = Object.fromEntries(['stdin', 'stdout', 'stderr'].flatMap((name, fd) => mask & (1 << fd) ? [] : [[name, null]]));
      const p = await container.spawn('closed', [String(mask)], { stdio });
      const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).arrayBuffer(), new Response(p.stderr).arrayBuffer()]);
      assert.deepEqual(exit, { code: 0, reason: 'exited' }, `initial mask ${mask}`);
      assert.equal(stdout.byteLength + stderr.byteLength, 0);
    }
    assert.equal((await container.run('batch', ['7'])).code, 0, 'batch default still opens fd 0/1/2');
    assert.equal((await container.inspect()).processes.length, 0);
  } finally { await container.dispose(); }
});
