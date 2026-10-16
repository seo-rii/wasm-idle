// Shared by Node and Chromium; every command executes the pinned BusyBox Wasm.
export async function exerciseLiveBusybox(config) {
  const { createContainer, validateDistribution, createContainerPackageManager } = await import(config.containerModule);
  const { createLiveWasiAdapter } = await import(config.adapterModule);
  const distribution = await validateDistribution({ bytes: new TextEncoder().encode(config.distribution),
    expectedSha256: config.distributionSha256, adapterIds: ['wasi-preview1-live'], allowedAssetURLs: [config.assetURL] });
  const manager = createContainerPackageManager({ distribution, capabilities: ['wasi-preview1'], persistentCache: false });
  let workers = 0;
  const adapter = createLiveWasiAdapter({ pipeBytes: 4093, maxBlockedIoMs: 60000, workerFactory() {
    const worker = config.workerFactory ? config.workerFactory() : new Worker(config.workerModule, { type: 'module' });
    workers++; const stop = worker.terminate.bind(worker); let stopped;
    worker.terminate = () => stopped ??= Promise.resolve(stop()).finally(() => { workers--; });
    return worker;
  } });
  const container = createContainer({ adapters: [adapter], packages: manager, maxProcesses: 2 });
  const fs = container.fs, encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
  const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const hash = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const drain = async stream => {
    const reader = stream.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 2 * 1024 * 1024) throw new Error('Fixture output exceeds capture bound');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  };
  const checks = [];
  const check = (id, passed, details = {}) => {
    checks.push({ id, passed, ...details });
    if (!passed) throw new Error(`Live BusyBox fixture failed: ${id}`);
  };
  const cwd = '/workspace/a b';
  const options = { cwd, env: {}, timeoutMs: 60000 };
  const run = (command, args = [], extra = {}) => container.run(command, args, { ...options, ...extra });
  try {
    fs.mkdir(cwd);
    check('metadata-before-fetch', ['busybox', 'cat', 'grep', 'mkdir', 'cp', 'mv', 'rm', 'pwd', 'true']
      .every(name => manager.resolveCommand(name)?.name === name) && manager.inspect().assets.cachedEntries === 0);
    const pwd = await run('pwd');
    check('actual-cwd', pwd.code === 0 && pwd.reason === 'exited' && decode(pwd.stdout) === cwd + '\n');

    const binary = Uint8Array.from({ length: 262147 }, (_, index) => index % 256);
    const copied = await run('cat', [], { stdin: binary });
    check('binary-stdin-partial-io', copied.code === 0 && copied.reason === 'exited' && same(copied.stdout, binary) && !copied.stderr.length,
      { bytes: copied.stdout.length, sha256: await hash(copied.stdout), pipeBytes: 4093 });

    const text = encode('no match\nhello world\nother\nhello again\n');
    fs.writeFile(`${cwd}/lines.txt`, text);
    const pipe = await container.spawnPipeline([{ command: 'cat', args: ['lines.txt'] }, { command: 'grep', args: ['hello'] }], options);
    const output = drain(pipe.stdout), errors = Promise.all(pipe.stderr.map(drain));
    await pipe.stdin.getWriter().close();
    const exits = await pipe.exited, found = await output;
    check('real-cat-grep-pipeline', exits.every(exit => exit.code === 0 && exit.reason === 'exited')
      && decode(found) === 'hello world\nhello again\n' && (await errors).every(bytes => !bytes.length),
      { exits, stdoutHex: hex(found) });
    fs.writeFile(`${cwd}/result.txt`, found);
    check('workspace-pipeline-result', same(fs.readFile(`${cwd}/result.txt`), found));

    const largeText = encode('hello\n'.repeat(100000)); fs.writeFile(`${cwd}/many.txt`, largeText);
    const early = await container.spawnPipeline([{ command: 'cat', args: ['many.txt'] }, { command: 'grep', args: ['-m', '1', 'hello'] }], options);
    const earlyOutput = drain(early.stdout), earlyErrors = Promise.all(early.stderr.map(drain));
    await early.stdin.getWriter().close();
    const earlyExits = await early.exited, earlyBytes = await earlyOutput, earlyStderr = await earlyErrors;
    check('early-pipe-reader-close', earlyExits[1].code === 0 && earlyExits.every(exit => exit.reason === 'exited')
      && earlyExits[0].code === 1 && decode(earlyBytes) === 'hello\n' && earlyStderr[0].length > 0 && !earlyStderr[1].length,
      { exits: earlyExits, stderrHex: earlyStderr.map(hex) });

    fs.writeFile(`${cwd}/source.bin`, binary.subarray(0, 8193));
    const pending = await container.spawn('cat', ['-', 'from-cp.bin'], options);
    const pendingInput = pending.stdin.getWriter(), pendingOutput = pending.stdout.getReader(), pendingErrors = drain(pending.stderr);
    await pendingInput.write(encode('ready:'));
    check('stdout-before-input-eof', decode((await pendingOutput.read()).value ?? new Uint8Array()) === 'ready:');
    const copyResult = await run('cp', ['source.bin', 'from-cp.bin']);
    check('live-child-file-write', copyResult.code === 0 && same(fs.readFile(`${cwd}/from-cp.bin`), binary.subarray(0, 8193)));
    pendingOutput.releaseLock(); const remaining = drain(pending.stdout);
    await pendingInput.close(); pendingInput.releaseLock();
    const sharedExit = await pending.exited, sharedBytes = await remaining;
    check('live-file-visible-to-waiting-guest', sharedExit.code === 0 && sharedExit.reason === 'exited'
      && same(sharedBytes, binary.subarray(0, 8193)) && !(await pendingErrors).length,
      { bytes: sharedBytes.length, sha256: await hash(sharedBytes) });

    check('mkdir-live', (await run('mkdir', ['-p', 'tree/child'])).code === 0);
    for (let index = 0; index < 200; index++) fs.writeFile(`${cwd}/tree/child/file-${String(index).padStart(3, '0')}-${'x'.repeat(50)}`, Uint8Array.of(index));
    check('rename-live', (await run('mv', ['tree', 'renamed'])).code === 0 && fs.readdir(`${cwd}/renamed/child`).length === 200);
    const removed = await run('rm', ['-r', 'renamed']);
    check('recursive-rm-live', removed.code === 0 && removed.reason === 'exited' && !removed.stderr.length && !fs.readdir(cwd).includes('renamed'));

    const blocked = await container.spawn('cat', [], options), blockedInput = blocked.stdin.getWriter();
    const blockedReader = blocked.stdout.getReader(), blockedErrors = drain(blocked.stderr);
    await blockedInput.write(Uint8Array.of(65));
    check('cat-running-with-open-stdin', same((await blockedReader.read()).value ?? new Uint8Array(), Uint8Array.of(65)));
    blockedReader.releaseLock(); const blockedOutput = drain(blocked.stdout);
    await blocked.terminate(); await blocked.terminate();
    check('blocked-cat-cancel', (await blocked.exited).reason === 'terminated'
      && !(await blockedOutput).length && !(await blockedErrors).length);
    blockedInput.releaseLock();
    check('restart-after-cancel', (await run('true')).code === 0);
    let admission;
    try { await container.spawnPipeline([{ command: 'cat' }, { command: 'cat' }, { command: 'cat' }], options); }
    catch (error) { admission = error.code; }
    check('pipeline-reservation', admission === 'RESOURCE_LIMIT' && !(await container.inspect()).processes.length);
    check('cleanup', workers === 0 && !(await container.inspect()).processes.length);
    return { passed: true, checks, liveWorkers: workers, inspection: await container.inspect(),
      isolated: globalThis.crossOriginIsolated ?? false, cachedAssets: manager.inspect().assets.cachedEntries };
  } catch (error) {
    return { passed: false, checks, error: { name: error.name, code: error.code, message: error.message },
      liveWorkers: workers, inspection: await container.inspect() };
  } finally { await container.dispose(); await manager.dispose(); }
}
