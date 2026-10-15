import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem, FsError } from '../../dist/fs/index.js';
import { createRpcBuffer, createRpcServer, Operation, RPC_BYTES } from '../../dist/transport/rpc.js';
import { createLiveIo, createRemoteFileSystem } from '../../dist/adapters/wasi-live/io.js';
const limits = { maxInputBytes: 1024, maxOutputBytes: 1024 };
function request(buffer, generation, id, op, args = [], payload = new Uint8Array()) {
  const header = new Int32Array(buffer, 0, 16), encoded = new TextEncoder().encode(JSON.stringify(args));
  new Uint8Array(buffer, 64, RPC_BYTES).set(encoded); new Uint8Array(buffer, 64 + RPC_BYTES, RPC_BYTES).set(payload);
  header[4] = id; header[5] = op; header[6] = encoded.length; header[7] = payload.length; header[8] = 0;
  Atomics.store(header, 0, 1);
  return { type: 'io', version: 1, generation, id };
}
test('RPC rejects wrong generation, duplicate requests, invalid lengths and operations before dispatch', async () => {
  for (const corrupt of [
    (header, notice) => { notice.generation++; },
    (header) => { header[6] = RPC_BYTES + 1; },
    (header) => { header[7] = -1; },
    (header) => { header[5] = 255; },
    (header) => { header[1] = 2; },
    (header, notice) => { notice.id = 2; header[4] = 2; }
  ]) {
    const buffer = createRpcBuffer(2 ** 32 + 17); let dispatched = false;
    const server = createRpcServer(buffer, 2 ** 32 + 17, async () => { dispatched = true; return {}; });
    const notice = request(buffer, 2 ** 32 + 17, 1, Operation.Stdin, [1]); corrupt(new Int32Array(buffer), notice);
    await assert.rejects(server.accept(notice)); assert.equal(dispatched, false); server.stop();
  }
});
test('I/O namespace never accepts another process descriptor or unrecognized options', async () => {
  const fs = new MemoryFileSystem(); fs.writeFile('/workspace/file', new Uint8Array([42]));
  const a = createLiveIo(fs, limits, 4, assert.fail), b = createLiveIo(fs, limits, 4, assert.fail);
  try {
    const opened = await a.dispatch(Operation.Open, ['/workspace/file', { read: true }], new Uint8Array());
    await assert.rejects(b.dispatch(Operation.Read, [opened.value, 1], new Uint8Array()), { code: 'EBADF' });
    await assert.rejects(a.dispatch(Operation.Open, ['/workspace/file', { execute: true }], new Uint8Array()), { code: 'EINVAL' });
    await assert.rejects(a.dispatch(Operation.Read, [opened.value, RPC_BYTES + 1], new Uint8Array()), { code: 'EINVAL' });
    assert.deepEqual((await a.dispatch(Operation.Read, [opened.value, 1], new Uint8Array())).bytes, new Uint8Array([42]));
  } finally { a.dispose(); b.dispose(); }
  fs.acquireSnapshot().discard();
});
test('stop wakes a pending stdin RPC and prevents its late response being published', async () => {
  const fs = new MemoryFileSystem(), io = createLiveIo(fs, limits, 4, assert.fail), buffer = createRpcBuffer(7);
  const server = createRpcServer(buffer, 7, io.dispatch);
  const pending = server.accept(request(buffer, 7, 1, Operation.Stdin, [4]));
  server.stop(); io.dispose(); await pending;
  assert.equal(Atomics.load(new Int32Array(buffer), 0), 3);
});
test('large directory metadata returns an explicit bounded-profile error', async () => {
  const fs = new MemoryFileSystem(), io = createLiveIo(fs, limits, 4, assert.fail);
  try {
    for (let i = 0; i < 300; i++) fs.writeFile(`/workspace/${'a'.repeat(250)}${i}`, new Uint8Array());
    await assert.rejects(io.dispatch(Operation.Readdir, ['/workspace', {}], new Uint8Array()), { code: 'ENOSPC' });
    const directory = (await io.dispatch(Operation.Open, ['/workspace', { directory: true }], new Uint8Array())).value;
    await assert.rejects(io.dispatch(Operation.DirectoryEntries, [directory], new Uint8Array()), { code: 'ENOSPC' });
  } finally { io.dispose(); }
});
test('atomic path references retain their descriptor root and reject malformed or widened capabilities', async () => {
  const fs = new MemoryFileSystem(), io = createLiveIo(fs, limits, 4, assert.fail), empty = new Uint8Array();
  fs.writeFile('/workspace/file', new Uint8Array([42])); fs.symlink('file', '/workspace/link');
  try {
    const directory = (await io.dispatch(Operation.Open, ['.', { directory: true, root: '/workspace' }], empty)).value;
    const ref = { directory, path: 'file', root: '/workspace' };
    for (const [value, code] of [
      [{ ...ref, directory: 91 }, 'EBADF'],
      [{ ...ref, root: '/' }, 'EACCES'],
      [{ ...ref, path: '/workspace/file' }, 'EACCES'],
      [{ ...ref, extra: true }, 'EINVAL'],
      [{ ...ref, path: 'bad\0path' }, 'EINVAL'],
      [null, 'EINVAL']
    ]) await assert.rejects(io.dispatch(Operation.PathStat, [value, true], empty), { code });
    await assert.rejects(io.dispatch(Operation.PathOpen, [ref, { root: '/' }, true], empty), { code: 'EINVAL' });
    await assert.rejects(io.dispatch(Operation.PathStat, [ref, 1], empty), { code: 'EINVAL' });
    await assert.rejects(io.dispatch(Operation.PathOpen, [{ ...ref, path: 'link' }, { read: true }, false], empty), { code: 'ELOOP' });
    await assert.rejects(io.dispatch(Operation.PathOpen, [{ ...ref, path: '../tmp/file' }, { create: true }, true], empty), { code: 'EACCES' });
    const opened = (await io.dispatch(Operation.PathOpen, [ref, { read: true }, false], empty)).value;
    assert.deepEqual((await io.dispatch(Operation.Read, [opened, 1], empty)).bytes, new Uint8Array([42]));
    assert.equal((await io.dispatch(Operation.DirectoryEntries, [directory], empty)).value.find(entry => entry.name === 'link').stat.type, 'symlink');
  } finally { io.dispose(); }
  fs.acquireSnapshot().discard();
});
test('a backpressured stdin write owns Buffer bytes before its first asynchronous wait', async () => {
  const io = createLiveIo(new MemoryFileSystem(), limits, 2, assert.fail), writer = io.stdin.getWriter();
  try {
    const chunk = Buffer.from([1, 2, 3, 4]); let completed = false;
    const pending = writer.write(chunk).then(() => { completed = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(completed, false, 'the second part must still be waiting for capacity');
    chunk.fill(99);
    const first = (await io.dispatch(Operation.Stdin, [2], new Uint8Array())).bytes;
    const second = (await io.dispatch(Operation.Stdin, [2], new Uint8Array())).bytes;
    await pending;
    assert.deepEqual([...first, ...second], [1, 2, 3, 4]);
    await writer.close();
  } finally { io.dispose(); writer.releaseLock(); }
});
test('live regular-file transfers repeat bounded RPC chunks until complete, like batch I/O', () => {
  const fs = new MemoryFileSystem(), operations = [];
  const remote = createRemoteFileSystem((op, args, bytes = new Uint8Array()) => {
    operations.push(op); assert.ok(bytes.length <= RPC_BYTES);
    if (op === Operation.Write) return { value: fs.write(args[0], bytes) };
    if (op === Operation.Pwrite) return { value: fs.pwrite(args[0], bytes, args[1]) };
    assert.ok(args[1] <= RPC_BYTES);
    if (op === Operation.Read) return { bytes: fs.read(args[0], args[1]) };
    if (op === Operation.Pread) return { bytes: fs.pread(args[0], args[1], args[2]) };
    throw new Error('unexpected operation');
  });
  const input = Uint8Array.from({ length: 3 * RPC_BYTES + 17 }, (_, i) => i * 7);
  const fd = fs.open('/workspace/big', { read: true, write: true, create: true });
  try {
    assert.equal(remote.write(fd, input), input.length); assert.equal(operations.length, 4);
    fs.seek(fd, 0); assert.deepEqual(remote.read(fd, input.length + 9), input);
    assert.deepEqual(remote.pread(fd, 2 * RPC_BYTES, 5), input.subarray(5, 5 + 2 * RPC_BYTES));
    assert.equal(remote.pwrite(fd, input.subarray(1), 2 * RPC_BYTES), input.length - 1);
    assert.equal(fs.fstat(fd).size, 2 * RPC_BYTES + input.length - 1);
  } finally { fs.close(fd); }
  const failing = errors => createRemoteFileSystem((op, args, bytes) => {
    const error = errors.shift(); if (error) throw error; return { value: bytes.length };
  });
  assert.equal(failing([undefined, new FsError('ENOSPC', 'full')]).write(9, new Uint8Array(RPC_BYTES + 1)), RPC_BYTES, 'errno after progress reports the transferred bytes');
  assert.throws(() => failing([undefined, new Error('RPC stopped or corrupt response')]).write(9, new Uint8Array(RPC_BYTES + 1)), /RPC stopped/);
  assert.throws(() => failing([new FsError('ENOSPC', 'full')]).write(9, new Uint8Array(1)), { code: 'ENOSPC' });
});
