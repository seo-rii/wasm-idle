import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalSizeModule, resizeWasixTty } from '../../dist/adapters/wasix/tty-size.js';

test('actual geometry Wasm changes only cols/rows and reports the accepted values', async () => {
  const tty = Uint8Array.from({ length: 24 }, (_, index) => index);
  const original = tty.slice(); let memory, output;
  const { instance } = await WebAssembly.instantiate(terminalSizeModule(109, 31), {
    wasix_32v1: {
      tty_get(ptr) { new Uint8Array(memory.buffer, ptr, 24).set(tty); return 0; },
      tty_set(ptr) { tty.set(new Uint8Array(memory.buffer, ptr, 24)); return 0; }
    },
    wasi_snapshot_preview1: {
      fd_write(fd, iov, count) {
        assert.equal(fd, 1); assert.equal(count, 1);
        const view = new DataView(memory.buffer), ptr = view.getUint32(iov, true), size = view.getUint32(iov + 4, true);
        output = new Uint8Array(memory.buffer, ptr, size).slice(); return 0;
      }
    }
  });
  memory = instance.exports.memory; instance.exports._start();
  assert.equal(new DataView(tty.buffer).getUint32(0, true), 109);
  assert.equal(new DataView(tty.buffer).getUint32(4, true), 31);
  assert.deepEqual(tty.slice(8), original.slice(8), 'pixel size and tty/echo flags are preserved');
  assert.deepEqual(output, tty.slice(0, 8));
});

test('geometry is bounded before allocating or invoking a guest', () => {
  for (const pair of [[0, 1], [1, 0], [65536, 1], [1, Infinity], [1.5, 1], [NaN, 1], ['80', 25]])
    assert.throws(() => terminalSizeModule(...pair), { code: 'INVALID_ARGUMENT' });
  assert(WebAssembly.validate(terminalSizeModule(1, 65535)));
});

test('geometry runner shares the supplied runtime, verifies readback, and frees its package', async () => {
  const runtime = {}, freed = [], dimensions = new Uint8Array(8);
  new DataView(dimensions.buffer).setUint32(0, 80, true); new DataView(dimensions.buffer).setUint32(4, 25, true);
  const stream = (bytes) => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const sdk = { Wasmer: { fromWasm(bytes, suppliedRuntime) {
    assert.equal(suppliedRuntime, runtime); assert(WebAssembly.validate(bytes));
    return { free() { freed.push('package'); }, entrypoint: {
      free() { freed.push('command'); }, async run(options) {
        assert.equal(options.rawStdin, true);
        const streams = { stdin: new WritableStream(), stdout: stream(dimensions.slice()), stderr: stream(new Uint8Array()) };
        let consumed = false;
        return {
          get stdin() { assert(!consumed, 'SDK stream getters require a live Instance'); return streams.stdin; },
          get stdout() { assert(!consumed, 'SDK stream getters require a live Instance'); return streams.stdout; },
          get stderr() { assert(!consumed, 'SDK stream getters require a live Instance'); return streams.stderr; },
          async waitForExit() { consumed = true; return { code: 0 }; }
        };
      }
    } };
  } } };
  await resizeWasixTty(sdk, runtime, 80, 25);
  await assert.rejects(resizeWasixTty(sdk, runtime, 90, 30), { code: 'STARTUP_FAILED' });
  assert.deepEqual(freed, ['command', 'package', 'command', 'package']);
});

test('a failing tty syscall traps instead of pretending the resize succeeded', async () => {
  const { instance } = await WebAssembly.instantiate(terminalSizeModule(80, 25), {
    wasix_32v1: { tty_get() { return 58; }, tty_set() { assert.fail('set follows successful get only'); } },
    wasi_snapshot_preview1: { fd_write() { assert.fail('failed get cannot report geometry'); } }
  });
  assert.throws(() => instance.exports._start(), WebAssembly.RuntimeError);
});

test('aborting an exited worker releases helper streams and wrappers without awaiting its exit', async () => {
  const abort = new AbortController(), freed = [], cancelled = [];
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const stream = name => new ReadableStream({ cancel() { cancelled.push(name); } }, { highWaterMark: 0 });
  const sdk = { Wasmer: { fromWasm() { return {
    free() { freed.push('package'); }, entrypoint: {
      free() { freed.push('command'); }, async run() { return {
        stdin: new WritableStream(), stdout: stream('stdout'), stderr: stream('stderr'),
        waitForExit() { entered(); return new Promise(() => {}); }
      }; }
    }
  }; } } };
  const pending = resizeWasixTty(sdk, {}, 80, 25, abort.signal);
  await waiting;
  const reason = new Error('worker group ended'); abort.abort(reason);
  let timer;
  try {
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('helper did not cancel')), 100);
    })]), error => error === reason);
    assert.deepEqual(freed, ['command', 'package']);
    assert.deepEqual(cancelled.sort(), ['stderr', 'stdout']);
  } finally { clearTimeout(timer); }
});

test('a helper run arriving after cancellation is discarded without retaining streams', async () => {
  const abort = new AbortController(), cleaned = [];
  let releaseRun;
  const running = new Promise(resolve => { releaseRun = resolve; });
  const sdk = { Wasmer: { fromWasm() { return {
    free() { cleaned.push('package'); }, entrypoint: {
      free() { cleaned.push('command'); }, run() { return running; }
    }
  }; } } };
  const pending = resizeWasixTty(sdk, {}, 80, 25, abort.signal);
  const reason = new Error('owner retired'); abort.abort(reason);
  await assert.rejects(pending, error => error === reason);
  const stream = name => new ReadableStream({ cancel() { cleaned.push(name); } }, { highWaterMark: 0 });
  releaseRun({
    stdin: new WritableStream({ abort() { cleaned.push('stdin'); } }),
    stdout: stream('stdout'), stderr: stream('stderr'),
    waitForExit() { cleaned.push('exit'); return Promise.reject(reason); }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cleaned.sort(), ['command', 'exit', 'package', 'stderr', 'stdin', 'stdout']);
});
