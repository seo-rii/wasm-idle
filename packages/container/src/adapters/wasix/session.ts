import { ContainerError } from '../../errors.js';
import { snapshotInvocation } from '../../process/lifecycle.js';
import { createHostCommandHandler, HOST_COMMAND_STATUS, type HostCommandInvocation } from '../../shell/host-command.js';
import { createShellFilesystem, type ShellFilesystemBinding } from '../../shell/filesystem.js';
import type { ProcessResult } from '../../types.js';
import type { WasixShellOptions, WasixShellSession, WasixRuntime, WasixDirectory, WasixCommand, WasixInstance, WasixAssetReference } from './types.js';

const owners = new WeakSet<object>();
const canonical = (path: string) => typeof path === 'string' && path.startsWith('/') && path.length > 1 && path.length <= 4096 &&
  !path.includes('\0') && path.slice(1).split('/').every(part => part && part !== '.' && part !== '..');
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), n => n.toString(16).padStart(2, '0')).join('');

/** Observe each outstanding operation independently, removing its abort listener on settlement. */
function abortable<T>(work: PromiseLike<T>, signal: AbortSignal, discard?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const stop = () => { abandoned = true; signal.removeEventListener('abort', stop); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    void Promise.resolve(work).then(value => {
      signal.removeEventListener('abort', stop);
      if (abandoned) discard?.(value); else resolve(value);
    }, error => { signal.removeEventListener('abort', stop); reject(error); }).catch(() => { /* Late resources are best-effort; the SDK realm is already retired. */ });
    if (signal.aborted) stop();
  });
}

function discardInstance(instance: WasixInstance): void {
  // run() has no SDK cancellation argument. Observe its late result without
  // retaining input/output or trying to drain a terminated guest.
  const { stdin, stdout, stderr } = instance;
  if (stdin) void stdin.abort().catch(() => {});
  for (const stream of [stdout, stderr]) void stream.cancel().catch(() => {});
  if (typeof instance.waitForExit === 'function') void instance.waitForExit().catch(() => {});
}

/** One real Bash/WASIX execution in a dedicated owner realm, with raw byte streams. */
export async function createWasixShellSession(options: WasixShellOptions): Promise<WasixShellSession> {
  options = { ...options, sdkAsset: { ...options.sdkAsset }, shellAsset: { ...options.shellAsset }, memory: { ...options.memory },
    routes: Object.fromEntries(Object.entries(options.routes).map(([path, route]) => [path, { ...route, args: route.args && [...route.args] }])),
    moduleDirectories: options.moduleDirectories && [...options.moduleDirectories], mounts: options.mounts && [...options.mounts],
    args: options.args && [...options.args], env: options.env && { ...options.env } };
  if (globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer !== 'function' || options.workers.inspect().disposed || owners.has(options.workers)) {
    throw new ContainerError('UNSUPPORTED_PROFILE', 'WASIX requires isolation and a fresh dedicated SDK Worker group');
  }
  const { initial, maximum } = options.memory;
  if (!Number.isSafeInteger(initial) || !Number.isSafeInteger(maximum) || initial < 1 || maximum < initial || maximum > 65536 || !/^[a-f0-9]{64}$/.test(options.shellWasmSha256)) {
    throw new ContainerError('INVALID_ARGUMENT', 'Pinned Bash identity and bounded shared SDK memory are required');
  }
  for (const url of [options.sdkUrl, options.workerUrl]) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new ContainerError('INVALID_ARGUMENT', 'SDK bootstrap URLs must be explicit static application URLs');
  }
  const invocation = snapshotInvocation('bash', options.args ?? ['--noprofile', '--norc'], { cwd: options.cwd, env: options.env });
  const mounts = [...(options.mounts ?? ['/workspace', '/tmp', '/home/user'])];
  const commandDirectories = new Map<string, string[]>();
  for (const path of Object.keys(options.routes)) {
    if (!canonical(path)) throw new ContainerError('INVALID_ARGUMENT', 'Shell command routes require canonical absolute paths');
    const split = path.lastIndexOf('/'), directory = path.slice(0, split);
    if (!directory || mounts.some(root => path === root || path.startsWith(root + '/'))) throw new ContainerError('INVALID_ARGUMENT', 'Command namespace must be separate from writable shell mounts');
    const names = commandDirectories.get(directory) ?? []; names.push(path.slice(split + 1)); commandDirectories.set(directory, names);
  }
  const allMounts = [...mounts, ...commandDirectories.keys()];
  if (allMounts.length > 32 || !allMounts.every(canonical) || allMounts.some((path, i) => allMounts.some((other, j) => j !== i && (path === other || path.startsWith(other + '/'))))) {
    throw new ContainerError('INVALID_ARGUMENT', 'Shell mounts require distinct non-overlapping canonical directories');
  }
  for (const path of mounts) if (options.container.fs.stat(path).type !== 'directory') throw new ContainerError('INVALID_ARGUMENT', 'Shell mount is not a directory');
  const handler = createHostCommandHandler(options.container, { routes: options.routes, moduleDirectories: options.moduleDirectories, timeoutMs: options.timeoutMs, onRecord: options.onRecord });
  owners.add(options.workers);
  const stop = new AbortController(), sources = [options.signal, options.container.disposalSignal, options.workers.failure].filter((s): s is AbortSignal => Boolean(s));
  let terminationReason: ProcessResult['reason'] = 'terminated';
  const stops = sources.map(signal => {
    const listener = () => { if (signal === options.workers.failure) terminationReason = 'runtime-error'; stop.abort(signal.reason); };
    signal.addEventListener('abort', listener, { once: true }); if (signal.aborted) listener();
    return () => signal.removeEventListener('abort', listener);
  });
  const calls = new Map<AbortController, Promise<number>>();
  const interrupt = () => {
    const count = calls.size;
    for (const controller of calls.keys()) controller.abort(new ContainerError('ABORTED', 'Interrupted by the shell owner'));
    handler.interrupt(); return count;
  };
  const dispatch = (request: HostCommandInvocation) => {
    const controller = new AbortController();
    const abort = () => controller.abort(stop.signal.reason);
    stop.signal.addEventListener('abort', abort, { once: true }); if (stop.signal.aborted) abort();
    const call = Promise.resolve().then(async () => {
      try {
        // Registered virtual commands are trusted. Artifact routes additionally
        // require VFS executable metadata before the adapter validates the bytes.
        if (!Object.hasOwn(options.routes, request.path)) {
          const info = options.container.fs.stat(request.path);
          if (info.type !== 'file' || !(info.mode & 0o111) || info.command) throw new ContainerError('UNSUPPORTED_PROFILE', 'Artifact is not marked executable; use an explicit wasm-run command');
        }
        if (options.prepareCommand) await abortable(options.prepareCommand(request, controller.signal), controller.signal);
        controller.signal.throwIfAborted();
        return await handler(request);
      } catch (error) {
        const status = controller.signal.aborted ? HOST_COMMAND_STATUS.interrupted : HOST_COMMAND_STATUS.cannotExecute;
        options.onRecord?.(Object.freeze({ path: request.path, status, startError: error instanceof ContainerError ? error.code : 'STARTUP_FAILED' }));
        return status;
      } finally { stop.signal.removeEventListener('abort', abort); calls.delete(controller); }
    });
    calls.set(controller, call); return call;
  };
  let runtime: WasixRuntime | undefined, pkg: { free?(): void } | undefined, command: WasixCommand | undefined;
  const directories: WasixDirectory[] = [];
  const filesystems: ShellFilesystemBinding[] = [];
  let startupAssets: Promise<unknown>[] = [];
  let resources: Promise<void> | undefined;
  const release = () => resources ??= (async () => {
    interrupt();
    // Terminating a Worker releases CPU/blocked guest work before awaiting any
    // host callback. The pinned SDK routes all thread creation to this owner.
    const errors: unknown[] = [];
    try { await options.workers.dispose(); } catch (error) { errors.push(error); }
    await Promise.allSettled([...calls.values()]);
    for (const resource of [...directories, command, pkg, runtime]) {
      try { resource?.free?.(); } catch (error) { errors.push(error); }
    }
    for (const filesystem of filesystems) { try { filesystem.dispose(); } catch (error) { errors.push(error); } }
    for (const remove of stops) remove();
    if (errors.length) throw new AggregateError(errors, 'WASIX session cleanup failed');
  })();
  try {
    stop.signal.throwIfAborted();
    const capacity = options.assets.inspect?.();
    const parallel = !capacity || Math.min((capacity.maxPendingAssets ?? Infinity) - capacity.pendingRequests, (capacity.maxConsumers ?? Infinity) - capacity.consumers) >= 2;
    const loadAsset = (asset: WasixAssetReference) => abortable(new Promise<Uint8Array>(resolve => {
      stop.signal.throwIfAborted();
      resolve(options.assets.load(asset.packageId, asset.assetId, { signal: stop.signal }));
    }), stop.signal);
    const sdkAsset = loadAsset(options.sdkAsset);
    const shellAsset = parallel ? loadAsset(options.shellAsset) : sdkAsset.then(() => loadAsset(options.shellAsset));
    const initialized = sdkAsset.then(async sdkBytes => {
      stop.signal.throwIfAborted();
      const module = await abortable(WebAssembly.compile(Uint8Array.from(sdkBytes)), stop.signal);
      await abortable(options.sdk.init({ module, memory: new WebAssembly.Memory({ initial, maximum, shared: true }), sdkUrl: options.sdkUrl, workerUrl: options.workerUrl }), stop.signal);
    });
    startupAssets = [sdkAsset, shellAsset, initialized];
    const [, shellBytes] = await Promise.all([initialized, shellAsset]);
    stop.signal.throwIfAborted();
    runtime = new options.sdk.Runtime({ registry: null });
    for (const path of Object.keys(options.routes)) runtime.registerHostCommand(path, dispatch);
    for (const path of options.moduleDirectories ?? []) runtime.registerHostCommandDirectory(path, dispatch);
    const loaded = await abortable(options.sdk.Wasmer.fromFile(shellBytes, runtime), stop.signal, value => { try { value.entrypoint?.free?.(); } finally { value.free?.(); } }); pkg = loaded;
    command = loaded.entrypoint;
    if (!command || await sha256(command.binary()) !== options.shellWasmSha256) throw new ContainerError('INTEGRITY', 'Bash executable identity does not match the trusted pin');
    stop.signal.throwIfAborted();
    options.container.fs.mountReadonlyPackages([...commandDirectories].map(([path, names]) => ({ path,
      entries: names.map(name => ({ path: name, type: 'file' as const, mode: 0o555, command: true as const, data: new Uint8Array() }))
    })));
    // The pinned wasm-bindgen SDK checks this record with `instanceof Object`.
    // Null-prototype records are silently treated as absent mounts. All keys
    // above are canonical absolute paths, so none can target Object's setters.
    const mount: Record<string, WasixDirectory> = {};
    for (const path of allMounts) {
      const filesystem = createShellFilesystem(options.container.fs, { root: path }); filesystems.push(filesystem);
      const directory = options.sdk.Directory.fromHostFileSystem(filesystem); directories.push(directory); mount[path] = directory;
    }
    const instance = await abortable(command.run({ args: [...invocation.args], cwd: invocation.cwd, env: { ...invocation.env }, mount, rawStdin: true }), stop.signal, discardInstance);
    // waitForExit consumes Instance. Hold the actual streams first; it does not
    // collect output, close input, or compete with these stream readers.
    const rawInput = instance.stdin, rawOut = instance.stdout, rawErr = instance.stderr;
    if (!rawInput || typeof instance.waitForExit !== 'function') throw new ContainerError('UNSUPPORTED_PROFILE', 'SDK requires rawStdin and exit-only streaming support');
    const writer = rawInput.getWriter();
    const readers = [rawOut.getReader(), rawErr.getReader()];
    let resolveExit!: (result: ProcessResult) => void;
    const exited = new Promise<ProcessResult>(resolve => { resolveExit = resolve; });
    let ending: Promise<void> | undefined;
    const finish = (result: ProcessResult) => ending ??= (async () => {
      void writer.abort(new ContainerError('ABORTED', 'Shell input is closed')).catch(() => {}).finally(() => { try { writer.releaseLock(); } catch {} });
      try { await release(); } catch { result = { code: null, reason: 'runtime-error' }; }
      resolveExit(Object.freeze(result));
    })();
    const output = (index: number) => new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await abortable(readers[index]!.read(), stop.signal);
          if (done) { readers[index]!.releaseLock(); controller.close(); return; }
          if (!(value instanceof Uint8Array) || value.length > 65536) throw new ContainerError('RESOURCE_LIMIT', 'SDK output exceeds the qualified 64 KiB stream chunk');
          controller.enqueue(value.slice());
        } catch (error) {
          if (stop.signal.aborted) { try { readers[index]!.releaseLock(); } catch {} controller.close(); }
          else { controller.error(error); terminationReason = 'runtime-error'; stop.abort(error); }
        }
      },
      async cancel(reason) {
        try { await abortable(readers[index]!.cancel(reason), stop.signal); }
        finally { readers[index]!.releaseLock(); }
      }
    }, { highWaterMark: 0 });
    const stdin = new WritableStream<Uint8Array>({
      async write(bytes) {
        if (ending) throw new ContainerError('DISPOSED', 'Shell input is closed');
        if (!(bytes instanceof Uint8Array) || bytes.length > 65536) throw new ContainerError('RESOURCE_LIMIT', 'Shell input chunks must be at most 64 KiB');
        await abortable(writer.write(bytes.slice()), stop.signal);
      },
      async close() { await abortable(writer.close(), stop.signal); writer.releaseLock(); },
      abort(reason) { stop.abort(reason); }
    }, { highWaterMark: 1 });
    const terminate = () => { stop.abort(new ContainerError('ABORTED', 'Shell group terminated')); return finish({ code: null, reason: terminationReason }); };
    const abort = () => {
      void writer.abort(stop.signal.reason).catch(() => {});
      for (const reader of readers) void reader.cancel(stop.signal.reason).catch(() => {}).finally(() => { try { reader.releaseLock(); } catch {} });
      void finish({ code: null, reason: terminationReason });
    };
    stop.signal.addEventListener('abort', abort, { once: true }); if (stop.signal.aborted) abort();
    void instance.waitForExit().then(result => {
      if (!Number.isSafeInteger(result.code) || result.code < 0 || result.code > 0xffffffff) throw new ContainerError('STARTUP_FAILED', 'SDK returned an invalid exit status');
      return finish({ code: result.code, reason: 'exited' });
    }).catch(error => { terminationReason = 'runtime-error'; stop.abort(error); });
    return Object.freeze({ pid: 0, stdin, stdout: output(0), stderr: output(1), exited, interrupt, terminate, dispose: terminate });
  } catch (error) {
    const cancelled = stop.signal.aborted;
    stop.abort(error);
    await Promise.allSettled(startupAssets);
    await release().catch(() => {});
    if (error instanceof ContainerError) throw error;
    throw new ContainerError(cancelled ? 'ABORTED' : 'STARTUP_FAILED', 'WASIX shell could not start', { cause: error });
  }
}
