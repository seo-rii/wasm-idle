import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { terminalCases, runTerminalCase } from './terminal-cases.mjs';
import { workerFactory } from './node-worker.mjs';
const bytes = new Uint8Array(readFileSync(new URL('../fixtures/terminal.wasm', import.meta.url)));
for (const name of terminalCases) test(`terminal binding: real guest ${name}`, { timeout: 15000 }, async () => {
  const result = await runTerminalCase(name, bytes, () => workerFactory('../../dist/adapters/wasi-live/worker.js'));
  assert.equal(result.name, name); assert.equal(result.processes, 0);
});
