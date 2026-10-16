import { ContainerError } from './errors.js';
import { MemoryFileSystem, type FileSystemLease, type MemoryFileSystemOptions, type SnapshotEntry } from './fs/index.js';
import { ProcessLifecycle, snapshotInvocation } from './process/lifecycle.js';
import type { CommandAdapter, CommandDefinition, PreparedRuntime, PreparedLiveRuntime, RuntimeLimits } from './adapters/types.js';
import { PipeError } from './fd/pipe.js';
import type { CapturedProcessResult, ContainerInspection, ContainerProcess, DelegatedStdio, RunOptions, SpawnOptions, ProcessResult, PipelineCommand, ContainerPipeline } from './types.js';

import type { ContainerPackageManager } from './packages/manager.js';
import type { PersistentWorkspace } from './fs/persistence/index.js';
import type { DistributionCommand } from './packages/distribution.js';

export interface ContainerOptions extends MemoryFileSystemOptions {
  /** Explicitly opened persistence owner. The injecting host retains its lifetime. */
  readonly workspace?: PersistentWorkspace;
  readonly packages?: ContainerPackageManager;
  readonly commands?: Readonly<Record<string, CommandDefinition>>;
  readonly adapters?: readonly CommandAdapter[];
  /** Registered adapter used by the explicit wasm-run command. Default: wasi-preview1. */
  readonly artifactAdapter?: string;
  readonly maxMemoryBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxProcesses?: number;
}
const positive = (value: number, name: string, max: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new ContainerError('INVALID_ARGUMENT', `Invalid ${name}`);
  return value;
};
function delegatedStdio(value: unknown): DelegatedStdio | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new ContainerError('INVALID_ARGUMENT', 'Invalid delegated stdio');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const channels = { stdin: 'read', stdout: 'write', stderr: 'write' } as const;
  const result: Record<string, unknown> = {};
  for (const [name, endpoint] of Object.entries(value)) {
    if (!(name in channels)) throw invalid();
    const method = channels[name as keyof typeof channels];
    if (endpoint !== null && (!endpoint || typeof endpoint !== 'object' || typeof endpoint[method] !== 'function' || typeof endpoint.close !== 'function')) throw invalid();
    result[name] = endpoint;
  }
  return Object.freeze(result) as DelegatedStdio;
}
function byteOutput(bytes: Promise<Uint8Array>) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const data = await bytes;
      if (offset === data.length) { controller.close(); return; }
      const end = Math.min(data.length, offset + 65536);
      controller.enqueue(data.slice(offset, end)); offset = end;
    }
  }, { highWaterMark: 0 });
}

/** Snapshot batch and explicitly registered live adapters share one resource owner. */
export class Container {
  readonly fs: MemoryFileSystem;
  readonly packages?: ContainerPackageManager;
  readonly workspace?: PersistentWorkspace;
  #mountedPackages = new Set<string>();
  /** Commands whose complete closure this container has already verified and mounted readonly. */
  #mountedCommands = new Map<string, Readonly<{ command: DistributionCommand; executablePath: string }>>();
  #commands = new Map<string, CommandDefinition>();
  #adapters = new Map<string, CommandAdapter>();
  #processes = new Map<number, { command: string; lifecycle: ProcessLifecycle; stop: () => Promise<void> }>();
  #limits: RuntimeLimits;
  #maxProcesses: number;
  #reservedProcesses = 0;
  #artifactAdapter: string;
  #nextPid = 1;
  #disposed = false;
  #disposal?: Promise<void>;
  #disposalController = new AbortController();
  /** Aborted when disposal starts, including after the last process has exited. */
  get disposalSignal(): AbortSignal { return this.#disposalController.signal; }
  constructor(options: ContainerOptions = {}) {
    this.packages = options.packages;
    if (this.packages?.resolveCommand('wasm-run')) throw new ContainerError('INVALID_ARGUMENT', 'wasm-run is a reserved command');
    this.workspace = options.workspace;
    if (this.workspace && (!(this.workspace.fs instanceof MemoryFileSystem) || this.workspace.inspect().state === 'disposed' ||
        options.maxBytes !== undefined && options.maxBytes !== this.workspace.fs.maxBytes ||
        options.maxInodes !== undefined && options.maxInodes !== this.workspace.fs.maxInodes)) throw new ContainerError('INVALID_ARGUMENT', 'Workspace owner and container quotas must agree');
    this.fs = this.workspace?.fs ?? new MemoryFileSystem({ maxBytes: options.maxBytes, maxInodes: options.maxInodes });
    this.#limits = Object.freeze({
      maxWorkspaceBytes: positive(this.fs.maxBytes, 'maxBytes', 2 ** 32),
      maxWorkspaceInodes: positive(this.fs.maxInodes, 'maxInodes', 1000000),
      maxMemoryBytes: positive(options.maxMemoryBytes ?? 64 * 1024 * 1024, 'maxMemoryBytes', 2 ** 32),
      maxInputBytes: positive(options.maxInputBytes ?? 8 * 1024 * 1024, 'maxInputBytes', 256 * 1024 * 1024),
      maxOutputBytes: positive(options.maxOutputBytes ?? 8 * 1024 * 1024, 'maxOutputBytes', 256 * 1024 * 1024)
    });
    this.#maxProcesses = positive(options.maxProcesses ?? 4, 'maxProcesses', 256);
    this.#artifactAdapter = options.artifactAdapter ?? 'wasi-preview1';
    for (const adapter of options.adapters ?? []) {
      if (!adapter.id || !['snapshot', 'live'].includes(adapter.filesystem) || this.#adapters.has(adapter.id)) throw new ContainerError('INVALID_ARGUMENT', 'Invalid or duplicate adapter');
      this.#adapters.set(adapter.id, adapter);
    }
    if (options.artifactAdapter !== undefined && !this.#adapters.has(options.artifactAdapter)) throw new ContainerError('INVALID_ARGUMENT', 'Artifact adapter must be explicitly registered');
    for (const [name, command] of Object.entries(options.commands ?? {})) {
      if (name === 'wasm-run' || this.packages?.resolveCommand(name)) throw new ContainerError('INVALID_ARGUMENT', `Reserved command: ${name}`);
      snapshotInvocation(name, [], {});
      if (!(command.bytes instanceof Uint8Array) || !this.#adapters.has(command.adapter)) throw new ContainerError('INVALID_ARGUMENT', `Invalid command: ${name}`);
      if (command.argv0 !== undefined) snapshotInvocation(command.argv0, []);
      this.#commands.set(name, Object.freeze({ ...command, bytes: command.bytes.slice() }));
    }
  }
  spawn(command: string, args: readonly string[] = [], options: SpawnOptions = {}): Promise<ContainerProcess> {
    return this.#spawn(command, args, options);
  }
  async #spawn(command: string, args: readonly string[], options: SpawnOptions, reservation?: { remaining: number }): Promise<ContainerProcess> {
    const invocation = snapshotInvocation(command, args, options);
    const stdio = delegatedStdio(options.stdio);
    if (this.#disposed) throw new ContainerError('DISPOSED', 'Container has been disposed');
    if (this.workspace?.inspect().state === 'disposed') throw new ContainerError('DISPOSED', 'Workspace owner has been disposed');
    if (invocation.signal?.aborted) throw new ContainerError('ABORTED', 'Command aborted before startup');
    if (new TextEncoder().encode(JSON.stringify([command, invocation.args, invocation.env])).length > 1024 * 1024) throw new ContainerError('RESOURCE_LIMIT', 'Invocation exceeds one MiB');
    if ((!reservation && this.#processes.size + this.#reservedProcesses >= this.#maxProcesses) || this.#nextPid >= Number.MAX_SAFE_INTEGER) throw new ContainerError('RESOURCE_LIMIT', 'Process admission limit reached');
    let definition = this.#commands.get(command);
    const packageCommand = this.packages?.resolveCommand(command);
    let executionArgs = invocation.args;
    if (command === 'wasm-run') {
      if (!invocation.args.length) throw new ContainerError('INVALID_ARGUMENT', 'wasm-run requires a workspace path');
      const path = invocation.args[0]!;
      definition = { adapter: this.#artifactAdapter, bytes: this.fs.readFile(path, { cwd: invocation.cwd }), argv0: path };
      executionArgs = invocation.args.slice(1);
    }
    if (!definition && !packageCommand) throw new ContainerError('COMMAND_NOT_FOUND', `Unknown command: ${command}`);
    const adapterId = definition?.adapter ?? packageCommand!.adapter;
    if (!this.#adapters.has(adapterId)) throw new ContainerError('UNSUPPORTED_PROFILE', `Adapter is not registered: ${adapterId}`);
    if (this.fs.stat(invocation.cwd).type !== 'directory') throw new ContainerError('INVALID_ARGUMENT', 'cwd must name a directory');
    const adapter = this.#adapters.get(adapterId)!;
    if (stdio && adapter.filesystem !== 'live') throw new ContainerError('UNSUPPORTED_PROFILE', 'Delegated stdio requires a live adapter');
    const pid = this.#nextPid++, lifecycle = new ProcessLifecycle(), controller = new AbortController();
    let runtime: PreparedRuntime | PreparedLiveRuntime | undefined, lease: FileSystemLease | undefined, finishing: Promise<void> | undefined;
    let liveLease: { release(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reason: 'terminated' | 'timeout' = 'terminated';
    let returned = false, inputSize = 0, inputClosed = false;
    const inputChunks: Uint8Array[] = [];
    let inputResolve!: (bytes: Uint8Array) => void, inputReject!: (error: unknown) => void;
    const input = new Promise<Uint8Array>((resolve, reject) => { inputResolve = resolve; inputReject = reject; });
    void input.catch(() => {});
    let stdoutResolve!: (bytes: Uint8Array) => void, stderrResolve!: (bytes: Uint8Array) => void;
    const stdout = byteOutput(new Promise<Uint8Array>((resolve) => { stdoutResolve = resolve; }));
    const stderr = byteOutput(new Promise<Uint8Array>((resolve) => { stderrResolve = resolve; }));
    const cleanup = (result: ProcessResult, output?: { stdout: Uint8Array; stderr: Uint8Array }) => finishing ??= (async () => {
      if (timer !== undefined) clearTimeout(timer);
      invocation.signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
      inputClosed = true; inputChunks.length = 0;
      inputReject(new ContainerError('ABORTED', 'Command stopped'));
      try { const ending = runtime; runtime = undefined; await ending?.dispose(); }
      catch { result = { code: null, reason: 'runtime-error' }; }
      finally {
        lease?.discard();
        liveLease?.release();
        lease = undefined; liveLease = undefined;
        stdoutResolve(output?.stdout ?? new Uint8Array()); stderrResolve(output?.stderr ?? new Uint8Array());
        this.#processes.delete(pid);
        lifecycle.finish(result);
      }
    })();
    const onAbort = () => { if (returned) void cleanup({ code: null, reason }); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const abort = () => controller.abort(invocation.signal?.reason);
    const stop = async () => { controller.abort(); if (returned) await cleanup({ code: null, reason }); else await lifecycle.exited; };
    if (reservation) { reservation.remaining--; this.#reservedProcesses--; }
    this.#processes.set(pid, { command, lifecycle, stop });
    invocation.signal?.addEventListener('abort', abort, { once: true });
    if (invocation.signal?.aborted) abort();
    if (invocation.timeoutMs !== undefined) timer = setTimeout(() => { reason = 'timeout'; controller.abort(); }, invocation.timeoutMs);
    try {
      lifecycle.transition('resolving'); controller.signal.throwIfAborted();
      lifecycle.transition('preparing');
      const mounted = packageCommand && this.#mountedCommands.get(packageCommand.name);
      if (mounted) {
        // An earlier spawn verified this closure before publishing it. Readonly mounts are immutable,
        // so a later run must not depend on the network, asset caches or a second closure copy.
        definition = { adapter: mounted.command.adapter, argv0: mounted.command.argv0, bytes: this.fs.readFile(mounted.executablePath) };
        executionArgs = Object.freeze([...mounted.command.prefixArgs, ...invocation.args]);
      } else if (packageCommand) {
        const prepared = await this.packages!.prepareCommand(command, { signal: controller.signal });
        controller.signal.throwIfAborted();
        const missing = prepared.packages.filter((pkg) => !this.#mountedPackages.has(`${prepared.distributionSha256}:${pkg.identity}:${pkg.mount}`));
        const mounts = missing.map((pkg) => {
          const entries = new Map<string, Omit<SnapshotEntry, 'inode'>>();
          for (const file of pkg.files) {
            const parts = file.path.split('/');
            for (let i = 1; i < parts.length; i++) {
              const path = parts.slice(0, i).join('/');
              entries.set(path, { path, type: 'directory', mode: 0o555 });
            }
            entries.set(file.path, { path: file.path, type: 'file', mode: file.executable ? 0o555 : 0o444, data: file.bytes });
          }
          return { path: pkg.mount, entries: [...entries.values()] };
        });
        if (mounts.length) this.fs.mountReadonlyPackages(mounts);
        for (const pkg of missing) this.#mountedPackages.add(`${prepared.distributionSha256}:${pkg.identity}:${pkg.mount}`);
        this.#mountedCommands.set(prepared.command.name, Object.freeze({ command: prepared.command, executablePath: prepared.executablePath }));
        definition = { adapter: prepared.command.adapter, argv0: prepared.command.argv0, bytes: prepared.executable };
        executionArgs = Object.freeze([...prepared.command.prefixArgs, ...invocation.args]);
      }
      controller.signal.throwIfAborted();
      lifecycle.transition('starting');
      const start = { command: definition!, invocation: { command, args: executionArgs, cwd: invocation.cwd, env: invocation.env }, limits: this.#limits, generation: pid, signal: controller.signal };
      let liveRuntime: PreparedLiveRuntime | undefined;
      if (adapter.filesystem === 'live') {
        liveLease = this.fs.acquireLive();
        runtime = liveRuntime = await adapter.start({ ...start, fs: this.fs, ...(stdio ? { stdio } : {}) });
      } else {
        lease = this.fs.acquireSnapshot();
        runtime = await adapter.start({ ...start, snapshot: lease.snapshot });
      }
      controller.signal.throwIfAborted();
      lifecycle.transition('running'); returned = true;
      const stdin = liveRuntime?.stdin ?? new WritableStream<Uint8Array>({
        write: (bytes) => {
          if (inputClosed) throw new ContainerError('ABORTED', 'Command stdin is closed');
          if (!(bytes instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'stdin requires bytes');
          if (inputSize + bytes.length > this.#limits.maxInputBytes) {
            controller.abort(); throw new ContainerError('RESOURCE_LIMIT', 'Batch stdin exceeds configured limit');
          }
          if (!bytes.length) return;
          inputChunks.push(bytes.slice()); inputSize += bytes.length;
        },
        close: () => {
          if (inputClosed) return;
          inputClosed = true; const bytes = new Uint8Array(inputSize); let offset = 0;
          for (const chunk of inputChunks) { bytes.set(chunk, offset); offset += chunk.length; }
          inputChunks.length = 0; inputResolve(bytes);
        },
        abort: () => { controller.abort(); }
      });
      void (async () => {
        try {
          if (liveRuntime) {
            const result = await liveRuntime.run();
            if (controller.signal.aborted || finishing) return;
            if (!result || !Number.isSafeInteger(result.code) || result.code < 0 || result.code > 0xffffffff) throw new ContainerError('STARTUP_FAILED', 'Adapter returned an invalid completion');
            await cleanup({ code: result.code, reason: 'exited' }); return;
          }
          const result = await (runtime as PreparedRuntime).run(await input);
          if (controller.signal.aborted || finishing) return;
          if (!result || !Number.isSafeInteger(result.code) || result.code < 0 || result.code > 0xffffffff || !(result.stdout instanceof Uint8Array) || !(result.stderr instanceof Uint8Array) || result.stdout.length + result.stderr.length > this.#limits.maxOutputBytes) throw new ContainerError('STARTUP_FAILED', 'Adapter returned an invalid completion');
          try { lease!.commit(result.snapshot); }
          catch { await cleanup({ code: null, reason: 'filesystem-conflict' }); return; }
          await cleanup({ code: result.code, reason: 'exited' }, result);
        } catch {
          await cleanup({ code: null, reason: controller.signal.aborted ? reason : 'runtime-error' });
        }
      })();
      return Object.freeze({ pid, stdin, stdout: liveRuntime?.stdout ?? stdout, stderr: liveRuntime?.stderr ?? stderr, exited: lifecycle.exited, terminate: stop });
    } catch (error) {
      await cleanup({ code: null, reason: controller.signal.aborted ? reason : 'runtime-error' });
      if (controller.signal.aborted) throw new ContainerError('ABORTED', 'Command cancelled during startup', { cause: error });
      if (error instanceof ContainerError) throw error;
      throw new ContainerError('STARTUP_FAILED', 'Command could not start', { cause: error });
    }
  }
  /** Explicit byte pipeline, with capacity reserved before starting any guest. No shell parsing. */
  async spawnPipeline(commands: readonly PipelineCommand[], options: SpawnOptions = {}): Promise<ContainerPipeline> {
    if (this.#disposed) throw new ContainerError('DISPOSED', 'Container has been disposed');
    if (!Array.isArray(commands) || commands.length < 2) throw new ContainerError('INVALID_ARGUMENT', 'A pipeline requires at least two commands');
    if (options.stdio !== undefined) throw new ContainerError('INVALID_ARGUMENT', 'Pipelines own their stdio');
    if (commands.length > this.#maxProcesses - this.#processes.size - this.#reservedProcesses) throw new ContainerError('RESOURCE_LIMIT', 'Cannot reserve all pipeline processes');
    const invocations = commands.map(entry => {
      if (!entry || typeof entry !== 'object') throw new ContainerError('INVALID_ARGUMENT', 'Invalid pipeline command');
      const invocation = snapshotInvocation(entry.command, entry.args ?? [], options);
      const id = entry.command === 'wasm-run' ? this.#artifactAdapter : this.#commands.get(entry.command)?.adapter ?? this.packages?.resolveCommand(entry.command)?.adapter;
      if (!id || this.#adapters.get(id)?.filesystem !== 'live') throw new ContainerError('UNSUPPORTED_PROFILE', 'Pipelines require registered live adapters');
      return { command: entry.command, invocation };
    });
    const reservation = { remaining: commands.length };
    this.#reservedProcesses += commands.length;
    const processes: ContainerProcess[] = [];
    try {
      // Start consumers first. A waiting read never occupies the Supervisor event loop.
      for (const entry of [...invocations].reverse()) {
        const { invocation } = entry;
        processes.unshift(await this.#spawn(entry.command, invocation.args, invocation, reservation));
      }
      const terminate = async () => { await Promise.all(processes.map(process => process.terminate())); };
      const links = processes.slice(0, -1).map((process, index) => process.stdout.pipeTo(processes[index + 1]!.stdin).catch(async error => {
        if (error instanceof PipeError && error.code === 'EPIPE') return;
        await terminate();
      }));
      const exited = Promise.all(processes.map(process => process.exited)).then(async results => { await Promise.all(links); return Object.freeze(results); });
      return Object.freeze({ processes: Object.freeze(processes), stdin: processes[0]!.stdin, stdout: processes.at(-1)!.stdout, stderr: Object.freeze(processes.map(process => process.stderr)), exited, terminate });
    } catch (error) {
      await Promise.all(processes.map(process => process.terminate())); throw error;
    } finally { this.#reservedProcesses -= reservation.remaining; }
  }
  async run(command: string, args: readonly string[] = [], options: RunOptions = {}): Promise<CapturedProcessResult> {
    const max = positive(options.maxCaptureBytes ?? 8 * 1024 * 1024, 'maxCaptureBytes', 256 * 1024 * 1024);
    if (options.stdin !== undefined && !(options.stdin instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'stdin requires bytes');
    if (options.stdio !== undefined) throw new ContainerError('INVALID_ARGUMENT', 'run captures its own stdio; use spawn to delegate it');
    const bytes = options.stdin?.slice();
    const process = await this.spawn(command, args, options);
    let captured = 0;
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          captured += value.length;
          if (captured > max) throw new ContainerError('CAPTURE_LIMIT', 'Combined stdout/stderr capture exceeds its limit');
          chunks.push(value); size += value.length;
        }
        const result = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        return result;
      } finally { reader.releaseLock(); }
    };
    const send = async () => {
      const writer = process.stdin.getWriter();
      try { if (bytes?.length) await writer.write(bytes); await writer.close(); }
      // A command may deliberately finish without consuming the remaining input.
      catch (error) { if (!(error instanceof PipeError) || error.code !== 'EPIPE') throw error; }
      finally { writer.releaseLock(); }
    };
    try {
      const [stdout, stderr, result] = await Promise.all([drain(process.stdout), drain(process.stderr), process.exited, send()]);
      return { ...result, stdout, stderr };
    } catch (error) { await process.terminate(); throw error; }
  }
  async inspect(): Promise<ContainerInspection> {
    return { disposed: this.#disposed, profile: [...this.#adapters.values()].some(adapter => adapter.filesystem === 'live') ? 'isolated' : 'batch', persistence: this.workspace ? 'opfs' : 'memory',
      ...(this.workspace ? { workspace: this.workspace.inspect() } : {}),
      ...(this.packages ? { packages: this.packages.inspect() } : {}), limits: this.#limits,
      processes: [...this.#processes].map(([pid, p]) => ({ pid, generation: pid, command: p.command, state: p.lifecycle.state })) };
  }
  async flush(): Promise<void> {
    if (this.#disposed) throw new ContainerError('DISPOSED', 'Container has been disposed');
    if (!this.workspace) throw new ContainerError('UNSUPPORTED_PROFILE', 'This workspace is memory-only; open a persistence owner explicitly');
    await this.workspace.flush();
  }
  dispose(): Promise<void> {
    if (!this.#disposal) {
      this.#disposed = true;
      this.#disposal = Promise.all([...this.#processes.values()].map((p) => p.stop())).then(() => {});
      this.#disposalController.abort(new ContainerError('DISPOSED', 'Container has been disposed'));
    }
    return this.#disposal;
  }
}
export function createContainer(options: ContainerOptions = {}): Container { return new Container(options); }
