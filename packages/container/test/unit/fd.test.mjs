import assert from 'node:assert/strict';
import test from 'node:test';
import { createPipe, pipeReadable, pipeWritable } from '../../dist/fd/pipe.js';
import { DescriptorTable } from '../../dist/fd/table.js';

test('FD-01/02 partial and zero byte operations preserve binary data', async () => {
  const p = createPipe(3);
  assert.equal(await p.writer.write(new Uint8Array()), 0);
  assert.deepEqual(await p.reader.read(0), new Uint8Array());
  assert.equal(await p.writer.write(new Uint8Array([0, 255, 128, 9])), 3);
  assert.equal(p.bufferedBytes, 3);
  assert.deepEqual(await p.reader.read(2), new Uint8Array([0, 255]));
  assert.equal(await p.writer.write(new Uint8Array([9, 10])), 2);
  assert.deepEqual(await p.reader.read(10), new Uint8Array([128, 9, 10]));
  p.writer.close();
  assert.equal((await p.reader.read(1)).length, 0);
});
test('FD-04 duplicated writer delays EOF until all writers close', async () => {
  const p = createPipe(4), duplicate = p.writer.dup();
  p.writer.close();
  const pending = p.reader.read(2);
  await duplicate.write(new Uint8Array([42]));
  assert.deepEqual(await pending, new Uint8Array([42]));
  duplicate.close();
  assert.equal((await p.reader.read(2)).length, 0);
  assert.throws(() => duplicate.close(), { code: 'EBADF' });
});
test('FD-05 closing last reader wakes a blocked writer with EPIPE', async () => {
  const p = createPipe(1);
  await p.writer.write(new Uint8Array([1]));
  const pending = p.writer.write(new Uint8Array([2]));
  p.reader.close();
  await assert.rejects(pending, { code: 'EPIPE' });
});
test('FD-03 independent stdout/stderr streams drain simultaneously with bounded buffers', async () => {
  const channels = [createPipe(7), createPipe(11)];
  const input = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 256);
  await Promise.all(channels.map(async (p) => {
    const writer = pipeWritable(p.writer).getWriter();
    const reader = pipeReadable(p.reader).getReader();
    const consume = (async () => {
      let offset = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        assert.deepEqual(value, input.slice(offset, offset + value.length));
        offset += value.length;
        assert.ok(p.bufferedBytes <= p.capacity);
      }
      assert.equal(offset, input.length);
    })();
    await writer.write(input); await writer.close(); await consume;
  }));
});
test('abort wakes pending readers and descriptor cleanup is idempotent', async () => {
  const p = createPipe(); const table = new DescriptorTable();
  table.add(p.reader, 0); table.add(p.writer, 1); table.dup(1);
  const pending = p.reader.read(1);
  p.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
  table.dispose(); table.dispose();
  assert.equal(table.size, 0);
  assert.throws(() => table.close(0), { code: 'EBADF' });
});

test('writable abort wakes an in-flight write before the sink abort callback', async () => {
  const p = createPipe(1), writer = pipeWritable(p.writer).getWriter();
  const pending = writer.write(new Uint8Array([1, 2]));
  const rejected = assert.rejects(pending, { code: 'EBADF' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await writer.abort(); await rejected;
});

test('a failed stream write releases its pipe writer so the reader observes EOF', async () => {
  const p = createPipe(4), writer = pipeWritable(p.writer).getWriter();
  await writer.write(new Uint8Array([7]));
  await assert.rejects(writer.write('not bytes'), { code: 'EINVAL' });
  await writer.abort();
  assert.deepEqual(await p.reader.read(4), new Uint8Array([7]));
  assert.equal((await p.reader.read(4)).length, 0);
});
