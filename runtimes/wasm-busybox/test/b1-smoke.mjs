// Trusted producer fixtures only. Node WASI is not the container sandbox.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WASI } from 'node:wasi';
import { b1Cases } from './b1-cases.mjs';

const [artifact, nativeBinary, directory, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node test/b1-smoke.mjs BUSYBOX_WASM NATIVE_BUSYBOX NEW_WORK_DIR RECEIPT_JSON');
const work = resolve(directory);
mkdirSync(work, { mode: 0o700 });
const binary = readFileSync(artifact);
const module = await WebAssembly.compile(binary);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const stable = (tree) => Object.fromEntries(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b, 'en')));
const treeDigest = (tree) => digest(JSON.stringify(stable(tree)));
const matrix = { schemaVersion: 1, profile: 'busybox-b1-subset', cases: b1Cases };
const matrixPath = join(work, 'b1-cases.json');
writeFileSync(matrixPath, JSON.stringify(matrix, null, 2) + '\n', { mode: 0o600 });

function prepare(root, tree) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const [path, entry] of Object.entries(tree).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0'));
    const target = join(root, path);
    if (entry.type === 'directory') mkdirSync(target, { mode: 0o755 });
    else if (entry.type === 'file') writeFileSync(target, Buffer.from(entry.hex, 'hex'), { mode: 0o644 });
    else if (entry.type === 'symlink') symlinkSync(entry.target, target);
    else throw new Error('Unknown fixture entry type');
  }
}

function snapshot(root, prefix = '') {
  const tree = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const target = join(root, path), info = lstatSync(target);
    if (info.isDirectory()) { tree[path] = { type: 'directory' }; Object.assign(tree, snapshot(root, path)); }
    else if (info.isSymbolicLink()) tree[path] = { type: 'symlink', target: readlinkSync(target) };
    else { assert.ok(info.isFile()); tree[path] = { type: 'file', hex: readFileSync(target).toString('hex') }; }
  }
  return stable(tree);
}

function summarize(result, test) {
  const stdout = result.stdout.toString('hex'), stderr = result.stderr.toString('hex');
  const filesPassed = treeDigest(result.tree) === treeDigest(test.after);
  const stderrPassed = test.stderrMode === 'exact' ? stderr === test.stderrHex : stderr.length > 0;
  return { code: result.code, stdoutHex: stdout, stderrHex: stderr, treeSha256: treeDigest(result.tree),
    passed: result.code === test.code && stdout === test.stdoutHex && stderrPassed && filesPassed,
    ...(!filesPassed ? { actualTree: result.tree, expectedTree: test.after } : {}) };
}

const cases = [];
for (const test of b1Cases) {
  for (const alias of [false, true]) {
    const id = `${test.id}-${alias ? 'alias' : 'multicall'}`;
    const base = join(work, id);
    const nativeCwd = join(base, 'native', 'workspace', 'a b');
    const guestRoot = join(base, 'wasi');
    const wasiCwd = join(guestRoot, 'workspace', 'a b');
    const args = alias ? test.args : [test.applet, ...test.args];
    let native;
    if (!test.wasiOnly || test.nativeBaseline) {
      prepare(nativeCwd, test.before);
      const run = spawnSync(resolve(nativeBinary), args, { cwd: nativeCwd,
        argv0: alias ? test.applet : 'busybox', env: {}, input: Buffer.from(test.stdinHex, 'hex'), timeout: 10000, maxBuffer: 1024 * 1024 });
      assert.ifError(run.error);
      native = summarize({ code: run.status, stdout: run.stdout, stderr: run.stderr, tree: snapshot(nativeCwd) },
        { ...test, ...test.nativeBaseline });
    }
    prepare(wasiCwd, test.before);
    const inputPath = join(base, 'stdin'), outputPath = join(base, 'stdout'), errorPath = join(base, 'stderr');
    writeFileSync(inputPath, Buffer.from(test.stdinHex, 'hex'), { mode: 0o600 });
    const fds = [openSync(inputPath, 'r'), openSync(outputPath, 'wx', 0o600), openSync(errorPath, 'wx', 0o600)];
    let code;
    try {
      const wasi = new WASI({ version: 'preview1', args: alias ? [test.applet, ...test.args] : ['busybox', test.applet, ...test.args],
        env: {}, preopens: { '/': guestRoot }, stdin: fds[0], stdout: fds[1], stderr: fds[2], returnOnExit: true });
      let instance;
      instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), wasm_idle_process_v1: {
        initial_cwd(pointer, capacity) {
          const value = Buffer.from('/workspace/a b\0');
          const bytes = new Uint8Array(instance.exports.memory.buffer);
          const start = pointer >>> 0, length = capacity >>> 0;
          if (length < value.length || start > bytes.length || length > bytes.length - start) return -1;
          bytes.set(value, start); return value.length;
        },
      } });
      code = wasi.start(instance);
    } finally { fds.forEach(closeSync); }
    const wasm = summarize({ code, stdout: readFileSync(outputPath), stderr: readFileSync(errorPath), tree: snapshot(wasiCwd) }, test);
    const equal = test.wasiOnly || !native || native.code === wasm.code && native.stdoutHex === wasm.stdoutHex
      && native.treeSha256 === wasm.treeSha256 && (test.stderrMode !== 'exact' || native.stderrHex === wasm.stderrHex);
    cases.push({ id: test.id, invocation: alias ? 'argv0' : 'multicall', comparison: test.wasiOnly ? 'explicit-profile-rejection' : 'native-differential',
      stderrMode: test.stderrMode, native, wasm, passed: wasm.passed && (!native || native.passed) && equal });
  }
}
const receipt = { schemaVersion: 1, profile: matrix.profile, runtime: process.version,
  artifact: { sha256: digest(binary), size: binary.length }, nativeSha256: digest(readFileSync(nativeBinary)),
  matrix: { path: 'b1-cases.json', sha256: digest(readFileSync(matrixPath)), cases: b1Cases.length },
  imports: WebAssembly.Module.imports(module), cases, passed: cases.every((test) => test.passed) };
assert.ok(!existsSync(output), 'Use a new receipt path');
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: receipt.passed, cases: cases.length,
  failed: cases.filter((test) => !test.passed).map((test) => test.id), output }, null, 2));
if (!receipt.passed) process.exitCode = 1;
