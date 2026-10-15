import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { qualifyExecutableOutputs } from '../../dist/adapters/clang/artifacts.js';

const command = new Uint8Array(await readFile(new URL('../fixtures/command.wasm', import.meta.url)));
const imports = new Set(WebAssembly.Module.imports(new WebAssembly.Module(command))
  .filter(entry => entry.module === 'wasi_snapshot_preview1').map(entry => entry.name));
const mode = (snapshot, path) => snapshot.entries.find(entry => entry.path === path).mode;

test('command qualification uses the actual ABI and preserves output read policy', () => {
  const fs = new MemoryFileSystem(), before = fs.exportSnapshot();
  fs.writeFile('/workspace/no-extension', command, { mode: 0o640 });
  fs.writeFile('/workspace/not-command.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  const result = fs.exportSnapshot();
  const qualified = qualifyExecutableOutputs(before, result, 0, imports, 2 ** 32);
  assert.equal(mode(qualified, '/workspace/no-extension'), 0o750);
  assert.equal(mode(qualified, '/workspace/not-command.wasm'), 0o644);
  assert.equal(mode(result, '/workspace/no-extension'), 0o640, 'input snapshot is not mutated');
});

test('failed jobs and unchanged files do not gain execute permission', () => {
  const fs = new MemoryFileSystem();
  fs.writeFile('/workspace/existing', command);
  const before = fs.exportSnapshot();
  fs.writeFile('/workspace/new', command);
  const result = fs.exportSnapshot();
  assert.equal(qualifyExecutableOutputs(before, result, 1, imports, 2 ** 32), result);
  assert.equal(mode(qualifyExecutableOutputs(before, result, 0, imports, 2 ** 32), '/workspace/existing'), 0o644);
});

test('import and memory admission failures leave outputs as data', () => {
  const fs = new MemoryFileSystem(), before = fs.exportSnapshot();
  fs.writeFile('/workspace/output', command);
  const result = fs.exportSnapshot();
  assert.equal(mode(qualifyExecutableOutputs(before, result, 0, new Set(), 2 ** 32), '/workspace/output'), 0o644);
  assert.equal(mode(qualifyExecutableOutputs(before, result, 0, imports, 65536), '/workspace/output'), 0o644);
});

test('qualification is limited to changed workspace outputs', () => {
  const fs = new MemoryFileSystem(), before = fs.exportSnapshot();
  fs.writeFile('/tmp/private', command);
  fs.writeFile('/workspace/replaced', new Uint8Array([1]));
  const earlier = fs.exportSnapshot();
  fs.writeFile('/workspace/replaced', command);
  const result = qualifyExecutableOutputs(earlier, fs.exportSnapshot(), 0, imports, 2 ** 32);
  assert.equal(mode(result, '/workspace/replaced'), 0o755);
  assert.equal(mode(qualifyExecutableOutputs(before, result, 0, imports, 2 ** 32), '/tmp/private'), 0o644);
});
