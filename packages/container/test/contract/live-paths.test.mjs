import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { workerFactory } from './node-worker.mjs';
import { pathCases, runPathCase } from './live-path-cases.mjs';
const bytes = new Uint8Array(readFileSync(new URL('../fixtures/path.wasm', import.meta.url)));
for (const mode of pathCases) {
  test(`live ${mode} stays anchored to directory descriptors during replacement`, { timeout: 30000 }, async () => {
    assert.deepEqual(await runPathCase(mode, bytes, () => workerFactory('../../dist/adapters/wasi-live/worker.js')), { mode, code: 0, interleaved: true });
  });
}
