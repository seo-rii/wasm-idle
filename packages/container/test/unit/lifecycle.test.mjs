import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessLifecycle, snapshotInvocation } from '../../dist/process/lifecycle.js';

test('PROC-04: one terminal result survives a late completion', async () => {
  const process = new ProcessLifecycle();
  process.transition('resolving');
  process.transition('exiting');
  assert.equal(process.finish({ code: null, reason: 'terminated' }), true);
  assert.equal(process.finish({ code: 0, reason: 'exited' }), false);
  assert.deepEqual(await process.exited, { code: null, reason: 'terminated' });
  assert.throws(() => process.transition('running'));
});
test('invocation snapshots preserve spaces, Unicode, empty args and backslash', () => {
  const args = ['', '한 글', 'a\\b'];
  const env = { KEY: '한 글' };
  const options = { cwd: '/workspace/a b', env, timeoutMs: 10 };
  const snapshot = snapshotInvocation('tool', args, options);
  args[1] = 'changed'; env.KEY = 'changed'; options.cwd = '/tmp';
  assert.deepEqual(snapshot.args, ['', '한 글', 'a\\b']);
  assert.equal(snapshot.env.KEY, '한 글');
  assert.equal(snapshot.cwd, '/workspace/a b');
  assert.ok(Object.isFrozen(snapshot.env));
});
test('invalid API inputs fail before startup', () => {
  for (const invoke of [
    () => snapshotInvocation('x\0', []),
    () => snapshotInvocation('x', ['\0']),
    () => snapshotInvocation('x', [], { env: { 'a=b': 'c' } }),
    () => snapshotInvocation('x', [], { cwd: 'relative' }),
    () => snapshotInvocation('x', [], { timeoutMs: Infinity })
  ]) assert.throws(invoke, { code: 'INVALID_ARGUMENT' });
});

test('invalid trusted-adapter completion still terminates exactly once and releases the lease', async () => {
  const { createContainer } = await import('../../dist/container.js');
  const c = createContainer({
    adapters: [{ id: 'protocol-test', filesystem: 'snapshot', async start({ snapshot }) {
      return { async run() { return { code: -1, stdout: new Uint8Array(), stderr: new Uint8Array(), snapshot }; }, async dispose() {} };
    } }], commands: { invalid: { adapter: 'protocol-test', bytes: new Uint8Array() } }
  });
  try {
    const result = await c.run('invalid');
    assert.equal(result.reason, 'runtime-error');
    assert.equal((await c.inspect()).processes.length, 0);
    c.fs.writeFile('/workspace/recovered', new Uint8Array([1]));
  } finally { await c.dispose(); }
});
