// Shared by Node and Chromium; every command executes the checked-in real Wasm guest.
export async function verifyWorkspaceBindings({ createContainer, liveAdapter, snapshotAdapter, bytes, openWorkspaceEditor }) {
  const c = createContainer({ adapters: [liveAdapter, snapshotAdapter], commands: {
    live: { adapter: liveAdapter.id, bytes }, batch: { adapter: snapshotAdapter.id, bytes }
  } });
  const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
  const checks = [], check = (id, pass) => { if (!pass) throw new Error(`Workspace contract failed: ${id}`); checks.push(id); };
  const captureError = operation => { try { operation(); } catch (error) { return error.code; } };
  c.fs.writeFile('visible', encode('initial'));
  const watcher = c.fs.watch({ maxQueuedEvents: 1 }).getReader(), editor = openWorkspaceEditor(c.fs, 'visible');
  try {
    editor.edit(encode('unsaved'));
    const p = await c.spawn('live', ['visible']), output = p.stdout.getReader(), input = p.stdin.getWriter();
    check('guest-ready-without-input-eof', decode((await output.read()).value) === 'ready');
    check('staged-editor-conflict', captureError(() => editor.publish()) === 'ECONFLICT' && decode(editor.read()) === 'unsaved' && decode(c.fs.readFile('visible')) === 'before');
    const event = (await watcher.read()).value;
    check('bounded-guest-watch', event.kind === 'rescan' && event.generation === c.fs.generation && event.path === '/workspace');
    check('explicit-discard', captureError(() => editor.reload()) === 'ECONFLICT');
    editor.reload({ discardChanges: true }); editor.edit(encode('editor 한글\n'));
    const revision = editor.publish();
    check('published-revision', revision.generation === c.fs.generation && editor.inspect().state === 'clean');
    const update = (await watcher.read()).value;
    check('published-watch', update.kind === 'modify' && update.inode === revision.inode && update.generation === revision.generation);
    check('second-live-guest-sees-editor', decode((await c.run('live', ['read'])).stdout) === 'editor 한글\n');
    await input.write(new Uint8Array([1]));
    check('first-live-guest-sees-editor', decode((await output.read()).value) === 'editor 한글\n');
    check('live-completion', (await output.read()).done && (await p.exited).code === 0);
    await input.close(); input.releaseLock(); output.releaseLock();
    editor.edit(encode('next local edit'));
    const batch = await c.spawn('batch', ['visible']);
    check('snapshot-lease-protects-editor', captureError(() => editor.publish()) === 'EBUSY' && decode(editor.read()) === 'next local edit');
    const batchOutput = new Response(batch.stdout).text(), batchError = new Response(batch.stderr).text();
    await batch.stdin.getWriter().close();
    check('real-snapshot-guest', (await batch.exited).code === 0 && await batchOutput === 'readybefore' && await batchError === '');
    check('snapshot-publish-conflict', captureError(() => editor.publish()) === 'ECONFLICT' && decode(editor.read()) === 'next local edit');
    const snapshotEvent = (await watcher.read()).value;
    check('snapshot-rescan', snapshotEvent.kind === 'rescan' && snapshotEvent.generation === c.fs.generation);
    check('process-cleanup', (await c.inspect()).processes.length === 0);
    return { checks, revision, finalGeneration: c.fs.generation };
  } finally {
    await c.dispose(); await watcher.cancel(); editor.dispose();
    if (c.fs.watcherCount !== 0) throw new Error('Watcher ownership was not released');
  }
}
