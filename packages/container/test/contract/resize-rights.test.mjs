import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';

const bytes = Uint8Array.from(readFileSync(new URL('../fixtures/resize-rights.wasm', import.meta.url)));
const encode = value => new TextEncoder().encode(value);

for (const live of [false, true]) {
  test(`file-size rights resize without granting byte I/O (${live ? 'live' : 'snapshot'})`, { timeout: 30000 }, async () => {
    const adapter = live
      ? createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') })
      : createWasiAdapter({ workerFactory });
    const c = createContainer({ adapters: [adapter], commands: { tool: { adapter: adapter.id, bytes } } });
    try {
      c.fs.writeFile('size-only', encode('ABCD'));
      c.fs.writeFile('size-read', encode('ABCD'));
      c.fs.mountReadonly('/usr/share/resize', [{ path: 'file', type: 'file', mode: 0o444, data: encode('fixed') }]);
      const result = await c.run('tool');
      assert.equal(result.reason, 'exited');
      assert.equal(result.code, 0);
      assert.deepEqual(c.fs.readFile('size-only'), encode('AB'));
      assert.deepEqual(c.fs.readFile('size-read'), new Uint8Array([65, 66, 67, 68, 0, 0]));
      assert.deepEqual(c.fs.readFile('/usr/share/resize/file'), encode('fixed'));
      assert.equal((await c.inspect()).processes.length, 0);
    } finally { await c.dispose(); }
  });
}
