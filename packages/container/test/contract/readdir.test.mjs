import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';
const bytes = new Uint8Array(readFileSync(new URL('../fixtures/readdir.wasm', import.meta.url)));
for (const live of [false, true]) test(`real ${live ? 'live' : 'batch'} guest retains readdir cookies while deleting entries`, async () => {
  const adapter = live ? createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') }) : createWasiAdapter({ workerFactory });
  const container = createContainer({ adapters: [adapter], commands: { remove: { adapter: adapter.id, bytes } } });
  try {
    container.fs.mkdir('/workspace/tree');
    for (let i = 0; i < 200; i++) container.fs.writeFile(`/workspace/tree/entry-${String(i).padStart(3, '0')}-long-filename.bin`, new Uint8Array([i]));
    const result = await container.run('remove', [], { cwd: '/workspace/tree' });
    assert.equal(result.code, 0);
    assert.equal(new DataView(result.stdout.buffer, result.stdout.byteOffset).getUint32(0, true), 200);
    assert.deepEqual(container.fs.readdir('/workspace/tree'), []);
  } finally { await container.dispose(); }
});
