import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

const bytes = value => new TextEncoder().encode(value);

const { createLiveIo } = await import('../../dist/adapters/wasi-live/io.js');
const { Operation } = await import('../../dist/transport/rpc.js');
const { createCompilerOutputs } = await import('../../dist/adapters/clang-live/outputs.js');
const { createToolStdio } = await import('../../dist/adapters/clang-live/stdio.js');
const { createWasiHost } = await import('../../dist/adapters/wasi/host.js');
const { readFile } = await import('node:fs/promises');
const command = new Uint8Array(await readFile(new URL('../fixtures/command.wasm', import.meta.url)));
const wasiImports = new Set(WebAssembly.Module.imports(new WebAssembly.Module(command)).filter(item => item.module === 'wasi_snapshot_preview1').map(item => item.name));
const limits = { maxMemoryBytes: 2 ** 32, maxInputBytes: 65536, maxOutputBytes: 65536, maxWorkspaceBytes: 2 ** 20, maxWorkspaceInodes: 256 };
function outputFixture() {
  const fs = new MemoryFileSystem(), outputs = createCompilerOutputs(fs);
  const io = createLiveIo(fs, limits, 65536, error => { throw error; }, undefined, outputs.record);
  const call = (op, args, data = new Uint8Array()) => io.dispatch(op, args, data);
  const write = async (path, data = command) => {
    const fd = (await call(Operation.Open, [path, { create: true, write: true, truncate: true }])).value;
    await call(Operation.Write, [fd], data); await call(Operation.Close, [fd]);
  };
  return { fs, outputs, io, call, write, qualify: (code = 0) => outputs.qualify(code, wasiImports, 2 ** 32, new AbortController().signal) };
}

test('qualification follows this process writes and temp-file rename, never unrelated data', async () => {
  const f = outputFixture();
  try {
    f.fs.writeFile('/workspace/untouched', command);
    await f.write('/workspace/temp');
    await f.call(Operation.Rename, ['/workspace/temp', '/workspace/out', {}]);
    await f.write('/tmp/private');
    await f.write('/workspace/object.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    await f.qualify();
    assert.equal(f.fs.stat('/workspace/out').mode, 0o755);
    for (const path of ['/workspace/untouched', '/tmp/private', '/workspace/object.wasm']) assert.equal(f.fs.stat(path).mode, 0o644);
  } finally { f.io.dispose(); f.outputs.dispose(); }
});

test('interleaved foreign writes taint a compiler output even if a later own write restores bytes', async () => {
  const f = outputFixture();
  try {
    await f.write('/workspace/out');
    f.fs.writeFile('/workspace/out', command);
    const fd = (await f.call(Operation.Open, ['/workspace/out', { write: true }])).value;
    await f.call(Operation.Pwrite, [fd, 0], command); await f.call(Operation.Close, [fd]);
    await f.qualify(); assert.equal(f.fs.stat('/workspace/out').mode, 0o644);
    await f.call(Operation.Rename, ['/workspace/out', '/workspace/renamed', {}]);
    await f.qualify(); assert.equal(f.fs.stat('/workspace/renamed').mode, 0o644);
  } finally { f.io.dispose(); f.outputs.dispose(); }
});

test('edits while asynchronous module qualification is pending cannot gain execute permission', async () => {
  const f = outputFixture();
  try {
    await f.write('/workspace/out');
    const pending = f.qualify();
    f.fs.writeFile('/workspace/out', command);
    await pending; assert.equal(f.fs.stat('/workspace/out').mode, 0o644);
  } finally { f.io.dispose(); f.outputs.dispose(); }
});

test('nonzero exit, abort and disposal retain live files without granting new executable rights', async () => {
  for (const scenario of ['nonzero', 'abort', 'dispose']) {
    const f = outputFixture();
    try {
      await f.write('/workspace/out');
      const abort = new AbortController();
      if (scenario === 'abort') abort.abort();
      if (scenario === 'dispose') f.outputs.dispose();
      await f.outputs.qualify(scenario === 'nonzero' ? 1 : 0, wasiImports, 2 ** 32, abort.signal);
      assert.deepEqual(f.fs.readFile('/workspace/out'), command);
      assert.equal(f.fs.stat('/workspace/out').mode, 0o644);
    } finally { f.io.dispose(); f.outputs.dispose(); }
  }
});

test('unlinked output churn cannot grow the qualification journal beyond its inode budget', async () => {
  const fs = new MemoryFileSystem(), outputs = createCompilerOutputs(fs, 2);
  try {
    for (let i = 0; i < 3; i++) {
      fs.writeFile('/workspace/out', command);
      outputs.record('write', fs.captureFileVersion('/workspace/out'));
      if (i < 2) fs.unlink('/workspace/out');
    }
    await outputs.qualify(0, wasiImports, 2 ** 32, new AbortController().signal);
    assert.equal(fs.stat('/workspace/out').mode, 0o644);
  } finally { outputs.dispose(); }
});

test('nested LLVM bindings preserve parent stdio and inherited closed descriptors', () => {
  const closes = [], output = [];
  const stack = createToolStdio({ read: size => new Uint8Array(size), write: (fd, data) => { output.push([fd, [...data]]); return data.length; }, close: fd => closes.push(fd), capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() }) });
  const parent = stack.bind(1), child = stack.bind(2);
  child.stdio.close(1);
  assert.deepEqual(closes, []);
  assert.throws(() => child.stdio.write(1, bytes('no')), { code: 'EBADF' });
  parent.stdio.write(1, bytes('yes')); child.dispose(); child.dispose();
  parent.stdio.close(0); assert.deepEqual(closes, [0]);
  const next = stack.bind(2);
  assert.throws(() => next.stdio.read(1), { code: 'EBADF' });
  next.stdio.write(2, bytes('err')); next.dispose(); parent.dispose(); parent.dispose();
  assert.deepEqual(closes, [0], 'cleanup does not close caller-owned delegated endpoints');
  assert.deepEqual(output, [[1, [...bytes('yes')]], [2, [...bytes('err')]]]);
});

test('a nested WASI host reports inherited closed stdio consistently for metadata and I/O', () => {
  const fs = new MemoryFileSystem(), closed = [];
  const stack = createToolStdio({ read: () => new Uint8Array(), write: (_fd, data) => data.length,
    close: fd => closed.push(fd), capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() }) });
  const parent = stack.bind(1);
  parent.stdio.close(0); parent.stdio.close(2);
  const child = stack.bind(2);
  const host = createWasiHost({ fs, args: [], env: {}, cwd: '/workspace', stdin: new Uint8Array(), maxOutputBytes: 1024, stdio: child.stdio });
  try {
    host.run({ exports: { memory: new WebAssembly.Memory({ initial: 1 }), _start() {} } });
    for (const fd of [0, 2]) {
      assert.equal(host.imports.fd_fdstat_get(fd, 128), 8);
      assert.equal(host.imports.fd_filestat_get(fd, 128), 8);
      assert.equal(host.imports.fd_close(fd), 8);
    }
    assert.equal(host.imports.fd_read(0, 0, 0, 100), 8);
    assert.equal(host.imports.fd_write(2, 0, 0, 100), 8);
    assert.equal(host.imports.fd_fdstat_get(1, 128), 0);
    assert.equal(host.imports.fd_close(1), 0);
    assert.equal(parent.stdio.write(1, bytes('still open')), 10);
    assert.deepEqual(closed, [0, 2]);
  } finally { host.dispose(); child.dispose(); parent.dispose(); }
});
