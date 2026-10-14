import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryFileSystem } from '../../dist/fs/index.js';
import { PersistentWorkspaceError } from '../../dist/fs/persistence/index.js';
import { createWorkspaceSaveController } from '../../dist/workspace/index.js';
const bytes = text => new TextEncoder().encode(text), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
// Protocol-only scheduling double. Browser tests qualify the real OPFS/IDB owner.
function makeOwner(hook = async () => {}) {
  const fs = new MemoryFileSystem(); let committed = null, sequence = 0, saving = false, lastError, disposed = false, calls = 0;
  const inspect = () => ({ id: 'fixture', state: disposed ? 'disposed' : saving ? 'saving' : lastError ? 'error' : committed === null ? 'new' : fs.generation !== committed ? 'dirty' : 'saved', generation: fs.generation, committedGeneration: committed, committedSequence: sequence || null, dirty: fs.generation !== committed, recovered: false, lastError });
  return { fs, inspect, exportSnapshot: () => fs.exportSnapshot(), get calls() { return calls; },
    async flush() {
      if (disposed) throw new PersistentWorkspaceError('DISPOSED', 'disposed');
      if (saving) throw new PersistentWorkspaceError('BUSY', 'busy');
      calls++; const generation = fs.generation; saving = true; lastError = undefined;
      try { await hook(calls); committed = generation; sequence++; }
      catch (error) { lastError = 'STORAGE'; throw error; }
      finally { saving = false; }
      return inspect();
    },
    async dispose() { disposed = true; }
  };
}
async function until(reader, predicate) { for (;;) { const { value, done } = await reader.read(); assert.equal(done, false); if (predicate(value)) return value; } }

test('manual save is default and a slow UI receives only the latest bounded status', { timeout: 60000 }, async () => {
  const owner = makeOwner(), controller = createWorkspaceSaveController(owner), reader = controller.updates.getReader();
  for (let i = 0; i < 1000; i++) owner.fs.writeFile('a', bytes(String(i)));
  await wait(20); assert.equal(owner.calls, 0);
  const latest = (await reader.read()).value; assert.equal(latest.workspace.generation, owner.fs.generation); assert.equal(latest.autosave, false);
  const saved = await controller.save(); assert.equal(saved.state, 'saved'); assert.equal(owner.calls, 1);
  assert.equal((await reader.read()).value.workspace.state, 'saved');
  await controller.dispose(); assert.equal((await reader.read()).done, true); assert.equal(owner.fs.watcherCount, 0);
  assert.notEqual(owner.inspect().state, 'disposed'); await owner.flush();
});
test('autosave bursts serialize and a manual request during flush commits its own newer revision', { timeout: 60000 }, async () => {
  const started = deferred(), finish = deferred();
  const owner = makeOwner(async call => { if (call === 1) { started.resolve(); await finish.promise; } });
  const controller = createWorkspaceSaveController(owner, { autosave: true, delayMs: 10, maxWaitMs: 30 });
  owner.fs.writeFile('a', bytes('first')); await started.promise;
  owner.fs.writeFile('a', bytes('second')); const target = owner.fs.generation, saving = controller.save();
  finish.resolve(); const result = await saving;
  assert.ok(result.committedGeneration >= target); assert.equal(result.dirty, false); assert.equal(owner.calls, 2);
  await controller.dispose(); assert.equal(owner.fs.watcherCount, 0);
});
test('autosave storage failures stay visible and pause retries until an explicit action', { timeout: 60000 }, async () => {
  let failure = true;
  const owner = makeOwner(async () => { if (failure) throw new PersistentWorkspaceError('STORAGE', 'quota'); });
  const controller = createWorkspaceSaveController(owner, { autosave: true, delayMs: 10 }), reader = controller.updates.getReader();
  owner.fs.writeFile('a', bytes('unsaved'));
  const failed = await until(reader, value => value.pausedAfterError);
  assert.equal(failed.workspace.state, 'error'); assert.equal(failed.workspace.dirty, true); assert.equal(owner.calls, 1);
  owner.fs.writeFile('b', bytes('more')); await wait(40); assert.equal(owner.calls, 1);
  failure = false; assert.equal((await controller.save()).state, 'saved'); assert.equal(controller.inspect().pausedAfterError, false);
  await controller.dispose(); assert.equal(owner.calls, 2);
});
test('dispose cancels scheduling, preserves owner lifetime and releases exclusive binding ownership', { timeout: 60000 }, async () => {
  const owner = makeOwner(), controller = createWorkspaceSaveController(owner, { autosave: true });
  assert.throws(() => createWorkspaceSaveController(owner), { code: 'BUSY' });
  owner.fs.writeFile('a', bytes('unsaved')); const first = controller.dispose(); assert.equal(controller.dispose(), first); await first;
  assert.equal(owner.calls, 0); assert.equal(owner.fs.watcherCount, 0); assert.equal(owner.inspect().dirty, true);
  assert.throws(() => controller.save(), { code: 'DISPOSED' });
  const next = createWorkspaceSaveController(owner); await next.dispose(); await owner.dispose();
  assert.throws(() => createWorkspaceSaveController(owner), { code: 'DISPOSED' });
});
test('dispose waits for in-flight work but rejects a newer requested revision instead of claiming it saved', { timeout: 60000 }, async () => {
  const finish = deferred(), owner = makeOwner(async () => finish.promise), controller = createWorkspaceSaveController(owner);
  const first = controller.save(); owner.fs.writeFile('a', bytes('newer')); const second = controller.save(); assert.equal(first, second);
  const rejected = assert.rejects(second, { code: 'DISPOSED' }), disposing = controller.dispose(); finish.resolve(); await rejected; await disposing;
  assert.equal(owner.calls, 1); assert.equal(owner.inspect().dirty, true); assert.equal(owner.fs.watcherCount, 0);
});
test('autosave delay and wait limits reject before allocating a watch', () => {
  const owner = makeOwner();
  for (const options of [{ delayMs: 0 }, { delayMs: 20, maxWaitMs: 10 }, { autosave: 'true' }]) assert.throws(() => createWorkspaceSaveController(owner, options), { code: 'INVALID_ARGUMENT' });
  assert.equal(owner.fs.watcherCount, 0);
});
