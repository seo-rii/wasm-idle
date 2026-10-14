import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';
const bytes = new Uint8Array(readFileSync(new URL('../fixtures/fdflags.wasm', import.meta.url)));
for (const live of [false, true]) test(`real ${live ? 'live' : 'batch'} guest preserves NONBLOCK file and directory flags`, async () => {
  const adapter = live ? createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') }) : createWasiAdapter({ workerFactory });
  const container = createContainer({ adapters: [adapter], commands: { flags: { adapter: adapter.id, bytes } } });
  try {
    const result = await container.run('flags');
    assert.equal(result.code, 0);
    assert.equal(new TextDecoder().decode(container.fs.readFile('/workspace/flags-file')), 'ok');
    assert.equal((await container.inspect()).processes.length, 0);
  } finally { await container.dispose(); }
});
