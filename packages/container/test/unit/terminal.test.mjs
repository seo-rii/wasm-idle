import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTerminal } from '../../dist/terminal/index.js';
const bytes = text => new TextEncoder().encode(text);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(input = {}) {
  const exit = deferred(); let stdout, stderr, stops = 0;
  const process = {
    pid: 1, stdin: new WritableStream(input),
    stdout: new ReadableStream({ start(controller) { stdout = controller; } }),
    stderr: new ReadableStream({ start(controller) { stderr = controller; } }), exited: exit.promise,
    async terminate() { stops++; input.stop?.(); finish({ code: null, reason: 'terminated' }); }
  };
  function finish(result = { code: 0, reason: 'exited' }) {
    for (const stream of [stdout, stderr]) { try { stream.close(); } catch {} }
    exit.resolve(result);
  }
  return { process, stdout: data => stdout.enqueue(data), stderr: data => stderr.enqueue(data), finish, stops: () => stops };
}
const unlocked = p => assert.deepEqual([p.stdin.locked, p.stdout.locked, p.stderr.locked], [false, false, false]);
test('failed stream acquisition releases only the locks acquired by the binding', () => {
  const f = fixture(), existing = f.process.stderr.getReader();
  assert.throws(() => attachTerminal(f.process, { render() {} }), TypeError);
  assert.equal(f.process.stdin.locked, false); assert.equal(f.process.stdout.locked, false);
  assert.equal(f.process.stderr.locked, true); assert.equal(f.stops(), 0); existing.releaseLock();
});
test('rendering is serialized, bounded and snapshots the supplied options', async () => {
  const f = fixture(), first = deferred(), entered = deferred(), seen = []; let active = 0;
  const options = { maxRenderBytes: 3, async render(frame) {
    assert.equal(active++, 0); seen.push(frame); if (seen.length === 1) { entered.resolve(); await first.promise; } active--;
  } };
  const binding = attachTerminal(f.process, options); options.render = assert.fail; options.maxRenderBytes = 100;
  f.stdout(bytes('abcdefgh')); f.stderr(bytes('123456')); f.finish(); await entered.promise;
  assert.equal(seen.length, 1); first.resolve(); assert.deepEqual(await binding.completed, { code: 0, reason: 'exited' });
  assert.ok(seen.every(frame => frame.text.length <= 3));
  assert.equal(seen.filter(f => f.channel === 'stdout').map(f => f.text).join(''), 'abcdefgh');
  assert.equal(seen.filter(f => f.channel === 'stderr').map(f => f.text).join(''), '123456'); unlocked(f.process);
});
test('input owns Buffer bytes, bounds queued writes and treats empty input without waiting', async () => {
  const consumed = deferred(), entered = deferred(); let supplied;
  const f = fixture({ write(chunk) { supplied = chunk; entered.resolve(); return consumed.promise; }, stop: consumed.resolve });
  const binding = attachTerminal(f.process, { render() {}, maxPendingInputBytes: 4 });
  const buffer = Buffer.from([1, 2, 3]), pending = binding.write(buffer); await entered.promise; buffer.fill(99);
  await binding.write(new Uint8Array());
  await assert.rejects(binding.write(new Uint8Array([4, 5])), { code: 'RESOURCE_LIMIT' });
  assert.deepEqual([...supplied], [1, 2, 3]); assert.equal(supplied.constructor, Uint8Array);
  consumed.resolve(); await pending; await binding.closeInput(); await binding.closeInput();
  await assert.rejects(binding.write(bytes('x')), { code: 'INVALID_ARGUMENT' });
  f.finish(); await binding.completed; unlocked(f.process);
});
test('disposal aborts a pending renderer without waiting for it and releases stream locks', async () => {
  const f = fixture(), entered = deferred(); let signal, binding;
  binding = attachTerminal(f.process, { render(frame) {
    signal = frame.signal; signal.addEventListener('abort', () => { void binding.dispose(); });
    entered.resolve(); return new Promise(() => {});
  } });
  f.stdout(bytes('pending')); await entered.promise;
  await binding.dispose(); await binding.dispose();
  assert.equal(signal.aborted, true); assert.equal(f.stops(), 1);
  assert.equal((await binding.completed).reason, 'terminated'); unlocked(f.process);
});
test('a renderer failure terminates the process and preserves its original error', async () => {
  const f = fixture(), error = new Error('renderer failed'); let calls = 0;
  const binding = attachTerminal(f.process, { render() { calls++; throw error; } });
  f.stdout(bytes('out')); f.stderr(bytes('err'));
  await assert.rejects(binding.completed, caught => caught === error);
  assert.equal(calls, 1); assert.equal(f.stops(), 1); unlocked(f.process);
});
test('invalid rendering limits fail before locking streams', () => {
  const f = fixture();
  for (const options of [{ maxRenderBytes: 0 }, { maxRenderBytes: 65537 }, { maxPendingInputBytes: 0 }, { maxPendingInputBytes: Infinity }]) {
    assert.throws(() => attachTerminal(f.process, { render() {}, ...options }), { code: 'INVALID_ARGUMENT' }); unlocked(f.process);
  }
});
