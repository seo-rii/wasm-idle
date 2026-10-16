import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';

const bytes = Uint8Array.from(readFileSync(new URL('../fixtures/writev-progress.wasm', import.meta.url)));
const encode = value => new TextEncoder().encode(value);

for (const [profile, makeAdapter] of [
  ['snapshot', () => createWasiAdapter({ workerFactory })],
  ['live', () => createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') })]
]) {
  for (const [mode, syscall] of ['fd_write', 'fd_pwrite'].entries()) {
    test(`${profile}: ${syscall} reports accepted iovecs before quota failure and preserves retry offsets`, { timeout: 10000 }, async () => {
      const adapter = makeAdapter();
      const container = createContainer({ maxBytes: 4, adapters: [adapter], commands: { writev: { adapter: adapter.id, bytes } } });
      try {
        container.fs.writeFile('file', encode('_'));
        const result = await container.run('writev', [String(mode)]);
        assert.equal(result.reason, 'exited');
        assert.equal(result.code, 0, `writev-progress.c assertion failed on line ${result.code}`);
        assert.equal(result.stdout.byteLength, 0);
        assert.equal(result.stderr.byteLength, 0);
        assert.deepEqual(container.fs.readFile('file'), encode('_ABC'));
        assert.equal((await container.inspect()).processes.length, 0);
      } finally { await container.dispose(); }
    });
  }
}
