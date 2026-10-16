// Same trusted profile as the product owner. The builder pins this static SDK
// import to readPinnedProbeInputs.packageRoot; no runtime-selected JavaScript.
import * as sdk from '@wasm-idle/pinned-wasix-sdk';
import { createBashProfile, BASH_APPLETS } from '../../../../examples/container/bash-profile.mjs';

let running = false, backendCompleted = false, sequence = 0, heartbeat, profile, preparing, session;
const timeline = [], records = [], invocations = [], occurrences = new Map();
const lifetime = new AbortController();
const mark = entry => {
  const value = { seq: sequence++, atMs: Math.round(performance.now()), ...entry };
  timeline.push(value); postMessage({ type: 'mark', ...value });
};
const cleanup = async () => {
  lifetime.abort(); clearInterval(heartbeat);
  await preparing?.catch(() => {});
  const requestedWorkerTerminations = profile?.workers.inspect().active ?? 0;
  await profile?.dispose();
  return { backendCompleted, requestedWorkerTerminations, remainingTrackedChildren: profile?.workers.inspect().active ?? 0 };
};

globalThis.onmessage = async ({ data }) => {
  if (data.type === 'cleanup') {
    try { postMessage({ type: 'ownerCleanup', ...await cleanup() }); }
    catch (error) { postMessage({ type: 'ownerCleanup', backendCompleted, cleanupError: String(error), remainingTrackedChildren: profile?.workers.inspect().active ?? null }); }
    // This dedicated fixture realm has no further work after the complete
    // cleanup acknowledgement. Retire it explicitly as well as letting the
    // parent request native termination; child counters and CDP must reach 0.
    globalThis.close();
    return;
  }
  if (data.type !== 'run' || running) return;
  running = true;
  heartbeat = setInterval(() => postMessage({ type: 'heartbeat', atMs: Math.round(performance.now()) }), 5000);
  try {
    const interruptWhenRunning = async plan => {
      const deadline = performance.now() + 120000;
      while (!(await profile.container.inspect()).processes.some(process => process.state === 'running')) {
        if (lifetime.signal.aborted || performance.now() > deadline) return mark({ type: 'interruptSkipped', path: plan.path });
        await new Promise(done => setTimeout(done, 20));
      }
      await new Promise(done => setTimeout(done, plan.delayMs));
      mark({ type: 'interrupt', path: plan.path, interrupted: session.interrupt() });
    };
    let diagnosticMount = 0, diagnosticCalls = 0;
    const selectedSdk = data.sdkDiagnostics ? {
      ...sdk, init: options => sdk.init({ ...options, log: 'debug' }),
      Directory: { fromHostFileSystem(delegate) {
        const mount = diagnosticMount++;
        return sdk.Directory.fromHostFileSystem(Object.fromEntries(Object.entries(delegate).map(([name, operation]) => [name, (...args) => {
          try {
            const value = operation(...args);
            if (diagnosticCalls++ < 1000) console.debug('host-filesystem', JSON.stringify({ mount, name, path: typeof args[0] === 'string' ? args[0] : undefined,
              result: name === 'stat' || name === 'lstat' ? value : name === 'readdir' ? value.map(entry => entry.name) : undefined }));
            return value;
          } catch (error) {
            if (diagnosticCalls++ < 1000) console.debug('host-filesystem', JSON.stringify({ mount, name, path: typeof args[0] === 'string' ? args[0] : undefined, error: String(error), code: error?.code }));
            throw error;
          }
        }])));
      } },
      // A failed SDK /tmp collision can be isolated without changing the public
      // session's defaults. Such diagnostic runs never qualify the full profile.
      ...(data.sdkDiagnosticsOmitTmp ? { Wasmer: { async fromFile(...args) {
        const pkg = await sdk.Wasmer.fromFile(...args), command = pkg.entrypoint;
        return { free: () => pkg.free(), entrypoint: command && {
          free: () => command.free(), binary: () => command.binary(),
          run(options) {
            const { ['/tmp']: omitted, ...mount } = options.mount;
            console.debug('diagnostic-omitted-mount', '/tmp');
            return command.run({ ...options, mount });
          }
        } };
      } } } : {})
    } : sdk;
    preparing = createBashProfile({
      config: data, sdk: selectedSdk,
      fetch(input, init) { mark({ type: 'fetch', url: String(input instanceof Request ? input.url : input) }); return globalThis.fetch(input, init); },
      onInvocation(invocation) {
        const occurrence = (occurrences.get(invocation.path) ?? 0) + 1; occurrences.set(invocation.path, occurrence);
        const plan = (data.interrupts ?? []).find(entry => entry.path === invocation.path && entry.occurrence === occurrence);
        if (plan) void interruptWhenRunning(plan).catch(error => mark({ type: 'interruptError', error: String(error) }));
        // Test fixture provenance only; production does not collect these fields.
				// This fixed allowlist records only SH-02's explicit fixture value.
				// It is not a general environment/credential diagnostic facility.
				const fixtureEnvironment = data.recordSyntaxEnvironment ? Object.fromEntries(invocation.env
					.map(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes))
					.filter(entry => entry.startsWith('CONTAINER_SYNTAX_VALUE='))
					.map(entry => ['CONTAINER_SYNTAX_VALUE', entry.slice('CONTAINER_SYNTAX_VALUE='.length)])) : undefined;
        invocations.push({ path: invocation.path, argv: [...invocation.argv], cwd: invocation.cwd,
					descriptors: [invocation.stdin, invocation.stdout, invocation.stderr].map(endpoint => endpoint?.fd ?? null),
					...(fixtureEnvironment ? { fixtureEnvironment } : {}) });
        mark({ type: 'dispatch', path: invocation.path });
      },
      onRecord(record) {
        records.push(JSON.parse(JSON.stringify(record)));
        mark({ type: 'dispatchEnd', path: record.path, status: record.status });
      }
    }).then(value => { profile = value; return value; });
    await preparing; lifetime.signal.throwIfAborted();
    const { container, manager, shellAssets, workers } = profile;
    const lookups = Object.fromEntries([...BASH_APPLETS, 'clang'].map(name => [name, manager.resolveCommand(name)?.package ?? null]));
    const clangCommand = manager.resolveCommand('clang');
    const assetsBeforeShell = manager.inspect().assets, shellAssetsBefore = shellAssets.inspect();
    mark({ type: 'shellStart' });
    session = await profile.startShell({ args: ['--noprofile', '--norc', '-c', data.script], cwd: data.cwd }, lifetime.signal);
    postMessage({ type: 'started', trackedChildren: workers.inspect().active });
    // Capture exists only in this test owner and has one shared 8 MiB budget.
    // Both outputs drain concurrently; no SDK wait() helper consumes either.
    let captured = 0;
    const drain = async stream => {
      const reader = stream.getReader(), chunks = []; let length = 0;
      try {
        for (;;) {
          const result = await reader.read(); if (result.done) break;
          captured += result.value.length;
          if (captured > 8 * 1024 * 1024) { await session.terminate(); throw new Error('Acceptance capture exceeded 8 MiB'); }
          chunks.push(result.value); length += result.value.length;
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return Array.from(bytes);
    };
    const outputs = Promise.all([drain(session.stdout), drain(session.stderr)]); void outputs.catch(() => {});
    let liveIo;
    if (data.liveIo) {
      const deadline = performance.now() + 120000;
      let compiler;
      for (;;) {
        lifetime.signal.throwIfAborted();
        compiler = (await container.inspect()).processes.find(process => process.command === 'clang' && process.state === 'running');
        if (compiler) break;
        if (records.some(record => record.path.endsWith('/clang')) || performance.now() >= deadline) throw new Error('Live Clang did not remain running for the shared-header fixture');
        await new Promise(done => setTimeout(done, 20));
      }
      const path = '/workspace/live/live.h', headerBefore = Array.from(container.fs.readFile(path));
      container.fs.writeFile(path, new TextEncoder().encode('after_editor\n'));
      const headerAfter = Array.from(container.fs.readFile(path));
      const utility = await container.run('cat', [path], { cwd: '/workspace/live', timeoutMs: 30000 });
      liveIo = {
        compilerPid: compiler.pid, compilerRunningBeforeEdit: true, headerBefore, headerAfter,
        utility: { ...utility, stdout: Array.from(utility.stdout), stderr: Array.from(utility.stderr) },
        compilerRunningAfterUtility: (await container.inspect()).processes.some(process => process.pid === compiler.pid && process.state === 'running')
      };
      mark({ type: 'liveHeaderEdited', compilerPid: compiler.pid, compilerStillRunning: liveIo.compilerRunningAfterUtility });
      const writer = session.stdin.getWriter();
      try { await writer.write(new TextEncoder().encode('release\n')); await writer.close(); }
      finally { writer.releaseLock(); }
    } else await session.stdin.close();
    const [result, [stdout, stderr]] = await Promise.all([session.exited, outputs]);
    backendCompleted = true;
    mark({ type: 'shellEnd', code: result.code, reason: result.reason });
    const files = {};
    for (const path of data.readFiles) {
      try { files[path] = Array.from(container.fs.readFile(path)); }
      catch (error) { files[path] = { error: String(error.code ?? error) }; }
    }
    const artifact = (() => {
      try { const path = data.artifactPath ?? '/workspace/demo/hello.wasm', bytes = container.fs.readFile(path); return { bytes: bytes.length, magic: Array.from(bytes.subarray(0, 8)), mode: container.fs.stat(path).mode }; }
      catch (error) { return { error: String(error.code ?? error) }; }
    })();
    const containerProcesses = (await container.inspect()).processes;
    const assetsAfterShell = manager.inspect().assets, shellAssetsAfter = shellAssets.inspect();
    const virtualCommands = Object.fromEntries([...BASH_APPLETS, 'clang'].map(name => [name, container.fs.stat(`/usr/local/bin/${name}`)]));
    let dataArtifactMode; try { dataArtifactMode = container.fs.stat('/workspace/data.wasm').mode; } catch {}
    const sysroot = profile.inspectSysroot();
    await profile.dispose();
    postMessage({
      type: 'result', backendCompleted, result: { ...result, stdout, stderr },
      files, artifact, invocations, records, timeline, lookups, clangCommand, assetsBeforeShell, assetsAfterShell, shellAssetsBefore, shellAssetsAfter,
      sysroot, containerProcesses, bashWasmSha256: data.bashWasmSha256, virtualCommands, dataArtifactMode, liveIo,
      cacheNames: await caches.keys(), trackedWorkersAtBackendCompletion: workers.inspect().active, workerGroup: workers.inspect(),
      publicApi: { session: 'createWasixShellSession', runtime: Object.getOwnPropertyNames(sdk.Runtime.prototype), directory: Object.getOwnPropertyNames(sdk.Directory) }
    });
  } catch (error) {
    let cleanupError;
    try { await cleanup(); } catch (failure) { cleanupError = String(failure); }
    postMessage({ type: 'failure', backendCompleted, error: String(error), cause: error?.cause ? String(error.cause) : undefined, stack: error?.stack, cleanupError, timeline, trackedChildren: profile?.workers.inspect().active ?? 0 });
  }
};
