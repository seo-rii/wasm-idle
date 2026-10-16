// Trusted local producer fixtures only; node:wasi is not the container sandbox.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WASI } from 'node:wasi';

const [artifact, directory, output] = process.argv.slice(2);
if (!artifact || !directory || !output) throw new Error('Usage: node test/smoke.mjs busybox.wasm NEW_WORK_DIR receipt.json');
const workspace = resolve(directory);
mkdirSync(workspace, { mode: 0o700 });
const binary = readFileSync(artifact);
let offset = 8;
const leb = () => {
  let value = 0, scale = 1;
  for (let i = 0; i < 5; i++) {
    const byte = binary[offset++];
    assert.notEqual(byte, undefined);
    value += (byte & 127) * scale;
    if (byte < 128) return value;
    scale *= 128;
  }
  throw new Error('Invalid u32 LEB128');
};
let memory;
while (offset < binary.length) {
  const id = binary[offset++], size = leb(), end = offset + size;
  assert.ok(end <= binary.length);
  assert.notEqual(id, 8, 'Batch command cannot have an implicit start section');
  if (id === 5) {
    assert.equal(leb(), 1, 'One defined memory is required');
    assert.equal(leb(), 1, 'Memory must be wasm32, unshared, with an explicit maximum');
    memory = { initialPages: leb(), maximumPages: leb() };
    assert.ok(memory.initialPages <= memory.maximumPages && memory.maximumPages <= 1024);
  }
  offset = end;
}
assert.ok(memory);
const module = await WebAssembly.compile(binary);
const imports = WebAssembly.Module.imports(module);
const processAbi = 'wasm_idle_process_v1';
assert.ok(imports.every(entry => entry.kind === 'function' && (entry.module === 'wasi_snapshot_preview1'
  || (entry.module === processAbi && entry.name === 'initial_cwd'))));
assert.equal(imports.filter(entry => entry.module === processAbi).length, 1);
const exports = WebAssembly.Module.exports(module);
assert.ok(exports.some(entry => entry.name === '_start' && entry.kind === 'function'));
assert.ok(exports.some(entry => entry.name === 'memory' && entry.kind === 'memory'));
const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
const cwd = '/workspace/a b';
const cwdBytes = Buffer.from(`${cwd}\0`);
mkdirSync(join(workspace, 'workspace', 'a b'), { recursive: true, mode: 0o700 });
writeFileSync(join(workspace, 'workspace', 'a b', 'binary file.bin'), allBytes, { mode: 0o600 });
const cases = [
  ['printf-binary', ['printf', 'A\\000B\\377\\n'], Buffer.alloc(0), Buffer.from([65, 0, 66, 255, 10]), 0],
  ['printf-numeric', ['printf', '%s:%04d:%x\n', '한글', '7', '255'], Buffer.alloc(0), Buffer.from('한글:0007:ff\n'), 0],
  ['cat-binary', ['cat'], allBytes, allBytes, 0],
  ['cat-file', ['cat', 'binary file.bin'], Buffer.alloc(0), allBytes, 0],
  ['cat-absolute', ['cat', '/workspace/a b/binary file.bin'], Buffer.alloc(0), allBytes, 0],
  ['cat-missing', ['cat', 'missing.bin'], Buffer.alloc(0), Buffer.alloc(0), 1,
    Buffer.from("cat: can't open 'missing.bin': No such file or directory\n")],
  ['echo-utf8', ['echo', '한글 space'], Buffer.alloc(0), Buffer.from('한글 space\n'), 0],
  ['true', ['true'], Buffer.alloc(0), Buffer.alloc(0), 0],
  ['false', ['false'], Buffer.alloc(0), Buffer.alloc(0), 1],
  ['pwd', ['pwd'], Buffer.alloc(0), Buffer.from(`${cwd}\n`), 0],
];
const results = [];
for (const [id, args, input, expected, code, expectedError = Buffer.alloc(0)] of cases) {
  for (const alias of [false, true]) {
    const stem = `${id}-${alias ? 'alias' : 'multicall'}`;
    const inputPath = join(workspace, `${stem}.in`);
    const outputPath = join(workspace, `${stem}.out`);
    const errorPath = join(workspace, `${stem}.err`);
    writeFileSync(inputPath, input, { mode: 0o600 });
    const fds = [openSync(inputPath, 'r'), openSync(outputPath, 'wx', 0o600), openSync(errorPath, 'wx', 0o600)];
    let exitCode;
    try {
      const wasi = new WASI({ version: 'preview1', args: alias ? args : ['busybox', ...args],
        env: {}, preopens: { '/': workspace }, stdin: fds[0], stdout: fds[1], stderr: fds[2], returnOnExit: true });
      let instance;
      instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(),
        [processAbi]: { initial_cwd(pointer, capacity) {
          const bytes = new Uint8Array(instance.exports.memory.buffer);
          const start = pointer >>> 0, length = capacity >>> 0;
          if (length < cwdBytes.length || start > bytes.length || length > bytes.length - start) return -1;
          bytes.set(cwdBytes, start);
          return cwdBytes.length;
        } } });
      exitCode = wasi.start(instance);
    } finally { fds.forEach(closeSync); }
    const stdout = readFileSync(outputPath), stderr = readFileSync(errorPath);
    results.push({ id, invocation: alias ? 'argv0' : 'multicall', exitCode,
      stdoutHex: stdout.toString('hex'), stderrHex: stderr.toString('hex'),
      passed: exitCode === code && stdout.equals(expected) && stderr.equals(expectedError) });
  }
}
const startupCases = [];
for (const fault of ['negative-count', 'oversize-count', 'missing-nul', 'missing-directory']) {
  const stem = `startup-${fault}`;
  const outputPath = join(workspace, `${stem}.out`), errorPath = join(workspace, `${stem}.err`);
  const fds = [openSync(outputPath, 'wx', 0o600), openSync(errorPath, 'wx', 0o600)];
  let exitCode;
  try {
    const wasi = new WASI({ version: 'preview1', args: ['busybox', 'true'], env: {},
      preopens: { '/': workspace }, stdout: fds[0], stderr: fds[1], returnOnExit: true });
    let instance;
    instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(),
      [processAbi]: { initial_cwd(pointer, capacity) {
        if (fault === 'negative-count') return -1;
        if (fault === 'oversize-count') return capacity + 1;
        const value = Buffer.from(fault === 'missing-nul' ? '/x' : '/missing-directory\0');
        new Uint8Array(instance.exports.memory.buffer).set(value, pointer >>> 0);
        return value.length;
      } } });
    exitCode = wasi.start(instance);
  } finally { fds.forEach(closeSync); }
  const stdout = readFileSync(outputPath), stderr = readFileSync(errorPath);
  startupCases.push({ id: fault, exitCode, passed: exitCode === 125 && stdout.length === 0 && stderr.length === 0 });
}
const receipt = { schemaVersion: 1, runtime: process.version, profile: 'wasi_snapshot_preview1',
  artifact: { sha256: createHash('sha256').update(binary).digest('hex'), size: binary.length },
  processAbi, cwd, env: {}, memory, imports, exports, cases: results, startupCases,
  passed: [...results, ...startupCases].every(result => result.passed) };
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: receipt.passed, tests: results.length + startupCases.length, output }, null, 2));
if (!receipt.passed) process.exitCode = 1;
