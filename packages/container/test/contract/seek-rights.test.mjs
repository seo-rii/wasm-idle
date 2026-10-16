import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/container.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';

const bytes = new Uint8Array(readFileSync(new URL('../fixtures/seek-rights.wasm', import.meta.url)));
const cases = [
  ['pread requires seek in addition to read, including empty I/O', 'ABCD'],
  ['pwrite requires seek in addition to write, including empty I/O', 'ZBCD'],
  ['seek implies tell without granting read or write', 'ABCD'],
  ['tell permits only zero-offset CUR seek', 'ABCD'],
  ['positioned I/O preserves the offset and sequential I/O advances it', 'ABCY'],
  ['removing seek revokes implied tell and positioned I/O', 'ABCD'],
  ['removing seek retains explicit tell until tell is also removed', 'ABZD'],
  ['seek-only rights can be reduced to tell-only rights', 'ABCD'],
  ['inherited seek permits delegating and retaining only tell', 'ABCD']
];

for (const [profile, makeAdapter] of [
  ['snapshot', () => createWasiAdapter({ workerFactory })],
  ['live', () => createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') })]
]) {
  for (const [mode, [name, expectedFile]] of cases.entries()) {
    test(`${profile}: ${name}`, { timeout: 10000 }, async () => {
      const adapter = makeAdapter();
      const container = createContainer({ adapters: [adapter], commands: { rights: { adapter: adapter.id, bytes } } });
      try {
        container.fs.writeFile('file', new TextEncoder().encode('ABCD'));
        const result = await container.run('rights', [String(mode)]);
        assert.equal(result.reason, 'exited');
        assert.equal(result.code, 0, `seek-rights.c assertion failed on line ${result.code}`);
        assert.equal(result.stdout.byteLength, 0);
        assert.equal(result.stderr.byteLength, 0);
        assert.equal(new TextDecoder().decode(container.fs.readFile('file')), expectedFile);
      } finally { await container.dispose(); }
    });
  }
}
