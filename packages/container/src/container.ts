import { ContainerError } from './errors.js';
import { MemoryFileSystem, type FileSystemLease, type MemoryFileSystemOptions, type SnapshotEntry } from './fs/index.js';
import { ProcessLifecycle, snapshotInvocation } from './process/lifecycle.js';
import type { CommandAdapter, CommandDefinition, PreparedRuntime, RuntimeLimits } from './adapters/types.js';
import type { CapturedProcessResult, ContainerInspection, ContainerProcess, RunOptions, SpawnOptions, ProcessResult } from './types.js';

import type { ContainerPackageManager } from './packages/manager.js';

export interface ContainerOptions extends MemoryFileSystemOptions {
  readonly packages?: ContainerPackageManager;
  readonly commands?: Readonly<Record<string, CommandDefinition>>;
  readonly adapters?: readonly CommandAdapter[];
  readonly maxMemoryBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxProcesses?: number;
}
const positive = (value: number, name: string, max: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new ContainerError('INVALID_ARGUMENT', `Invalid ${name}`);
  return value;
};
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

/** First execution profile: one leased filesystem snapshot and prebuffered batch stdin. */
export class Container {
  readonly fs: MemoryFileSystem;
  readonly packages?: ContainerPackageManager;
  #mountedPackages = new Set<string>();
  #commands = new Map<string, CommandDefinition>();
  #adapters = new Map<string, CommandAdapter>();
  #processes = new Map<number, { command: string; lifecycle: ProcessLifecycle; stop: () => Promise<void> }>();
  #limits: RuntimeLimits;
  #maxProcesses: number;
  #nextPid = 1;
  #disposed = false;
  #disposal?: Promise<void>;
  constructor(options: ContainerOptions = {}) {
    this.packages = options.packages;
    if (this.packages?.resolveCommand('wasm-run')) throw new ContainerError('INVALID_ARGUMENT', 'wasm-run is a reserved command');
    this.fs = new MemoryFileSystem({ maxBytes: options.maxBytes, maxInodes: options.maxInodes });
    this.#limits = Object.freeze({
      maxWorkspaceBytes: positive(options.maxBytes ?? 64 * 1024 * 1024, 'maxBytes', 2 ** 32),
      maxWorkspaceInodes: positive(options.maxInodes ?? 16384, 'maxInodes', 1000000),
      maxMemoryBytes: positive(options.maxMemoryBytes ?? 64 * 1024 * 1024, 'maxMemoryBytes', 2 ** 32),
      maxInputBytes: positive(options.maxInputBytes ?? 8 * 1024 * 1024, 'maxInputBytes', 256 * 1024 * 1024),
      maxOutputBytes: positive(options.maxOutputBytes ?? 8 * 1024 * 1024, 'maxOutputBytes', 256 * 1024 * 1024)
    });
    this.#maxProcesses = positive(options.maxProcesses ?? 4, 'maxProcesses', 256);
    for (const adapter of options.adapters ?? []) {
      if (!adapter.id || adapter.filesystem !== 'snapshot' || this.#adapters.has(adapter.id)) throw new ContainerError('INVALID_ARGUMENT', 'Invalid or duplicate adapter');
      this.#adapters.set(adapter.id, adapter);
    }
    for (const [name, command] of Object.entries(options.commands ?? {})) {
      if (name === 'wasm-run' || this.packages?.resolveCommand(name)) throw new ContainerError('INVALID_ARGUMENT', `Reserved command: ${name}`);
      snapshotInvocation(name, [], {});
      if (!(command.bytes instanceof Uint8Array) || !this.#adapters.has(command.adapter)) throw new ContainerError('INVALID_ARGUMENT', `Invalid command: ${name}`);
      if (command.argv0 !== undefined) snapshotInvocation(command.argv0, []);
      this.#commands.set(name, Object.freeze({ ...command, bytes: command.bytes.slice() }));
    }
  }
  async spawn(command: string, args: readonly string[] = [], options: SpawnOptions = {}): Promise<ContainerProcess> {
    const invocation = snapshotInvocation(command, args, options);
    if (this.#disposed) throw new ContainerError('DISPOSED', 'Container has been disposed');
    if (invocation.signal?.aborted) throw new ContainerError('ABORTED', 'Command aborted before startup');
    if (new TextEncoder().encode(JSON.stringify([command, invocation.args, invocation.env])).length > 1024 * 1024) throw new ContainerError('RESOURCE_LIMIT', 'Invocation exceeds one MiB');
    if (this.#processes.size >= this.#maxProcesses || this.#nextPid >= Number.MAX_SAFE_INTEGER) throw new ContainerError('RESOURCE_LIMIT', 'Process admission limit reached');
    let definition = this.#commands.get(command);
    const packageCommand = this.packages?.resolveCommand(command);
    let executionArgs = invocation.args;
    if (command === 'wasm-run') {
      if (!invocation.args.length) throw new ContainerError('INVALID_ARGUMENT', 'wasm-run requires a workspace path');
      const path = invocation.args[0]!;
      definition = { adapter: 'wasi-preview1', bytes: this.fs.readFile(path, { cwd: invocation.cwd }), argv0: path };
      executionArgs = invocation.args.slice(1);
    }
    if (!definition && !packageCommand) throw new ContainerError('COMMAND_NOT_FOUND', `Unknown command: ${command}`);
    const adapterId = definition?.adapter ?? packageCommand!.adapter;
    if (!this.#adapters.has(adapterId)) throw new ContainerError('UNSUPPORTED_PROFILE', `Adapter is not registered: ${adapterId}`);
    if (this.fs.stat(invocation.cwd).type !== 'directory') throw new ContainerError('INVALID_ARGUMENT', 'cwd must name a directory');
    const adapter = this.#adapters.get(adapterId)!;
    const pid = this.#nextPid++, lifecycle = new ProcessLifecycle(), controller = new AbortController();
    let runtime: PreparedRuntime | undefined, lease: FileSystemLease | undefined, finishing: Promise<void> | undefined;
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
      try { await runtime?.dispose(); }
      catch { result = { code: null, reason: 'runtime-error' }; }
      finally {
        lease?.discard();
        stdoutResolve(output?.stdout ?? new Uint8Array()); stderrResolve(output?.stderr ?? new Uint8Array());
        this.#processes.delete(pid);
        lifecycle.finish(result);
      }
    })();
    const onAbort = () => { if (returned) void cleanup({ code: null, reason }); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const abort = () => controller.abort(invocation.signal?.reason);
    const stop = async () => { controller.abort(); if (returned) await cleanup({ code: null, reason }); else await lifecycle.exited; };
    this.#processes.set(pid, { command, lifecycle, stop });
    invocation.signal?.addEventListener('abort', abort, { once: true });
    if (invocation.signal?.aborted) abort();
    if (invocation.timeoutMs !== undefined) timer = setTimeout(() => { reason = 'timeout'; controller.abort(); }, invocation.timeoutMs);
    try {
      lifecycle.transition('resolving'); controller.signal.throwIfAborted();
      lifecycle.transition('preparing');
      if (packageCommand) {
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
        definition = { adapter: prepared.command.adapter, argv0: prepared.command.argv0, bytes: prepared.executable };
        executionArgs = Object.freeze([...prepared.command.prefixArgs, ...invocation.args]);
      }
      controller.signal.throwIfAborted();
      lease = this.fs.acquireSnapshot();
      lifecycle.transition('starting');
      runtime = await adapter.start({ command: definition!, invocation: { command, args: executionArgs, cwd: invocation.cwd, env: invocation.env }, snapshot: lease.snapshot, limits: this.#limits, generation: pid, signal: controller.signal });
      controller.signal.throwIfAborted();
      lifecycle.transition('running'); returned = true;
      const stdin = new WritableStream<Uint8Array>({
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
          const result = await runtime!.run(await input);
          if (controller.signal.aborted || finishing) return;
          if (!result || !Number.isSafeInteger(result.code) || result.code < 0 || result.code > 0xffffffff || !(result.stdout instanceof Uint8Array) || !(result.stderr instanceof Uint8Array) || result.stdout.length + result.stderr.length > this.#limits.maxOutputBytes) throw new ContainerError('STARTUP_FAILED', 'Adapter returned an invalid completion');
          try { lease!.commit(result.snapshot); }
          catch { await cleanup({ code: null, reason: 'filesystem-conflict' }); return; }
          await cleanup({ code: result.code, reason: 'exited' }, result);
        } catch {
          await cleanup({ code: null, reason: controller.signal.aborted ? reason : 'runtime-error' });
        }
      })();
      return Object.freeze({ pid, stdin, stdout, stderr, exited: lifecycle.exited, terminate: stop });
    } catch (error) {
      await cleanup({ code: null, reason: controller.signal.aborted ? reason : 'runtime-error' });
      if (controller.signal.aborted) throw new ContainerError('ABORTED', 'Command cancelled during startup', { cause: error });
      if (error instanceof ContainerError) throw error;
      throw new ContainerError('STARTUP_FAILED', 'Command could not start', { cause: error });
    }
  }
  async run(command: string, args: readonly string[] = [], options: RunOptions = {}): Promise<CapturedProcessResult> {
    const max = positive(options.maxCaptureBytes ?? 8 * 1024 * 1024, 'maxCaptureBytes', 256 * 1024 * 1024);
    if (options.stdin !== undefined && !(options.stdin instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'stdin requires bytes');
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
    const send = async () => { const writer = process.stdin.getWriter(); try { if (bytes?.length) await writer.write(bytes); await writer.close(); } finally { writer.releaseLock(); } };
    try {
      const [stdout, stderr, result] = await Promise.all([drain(process.stdout), drain(process.stderr), process.exited, send()]);
      return { ...result, stdout, stderr };
    } catch (error) { await process.terminate(); throw error; }
  }
  async inspect(): Promise<ContainerInspection> {
    return { disposed: this.#disposed, profile: 'batch', persistence: 'memory', processes: [...this.#processes].map(([pid, p]) => ({ pid, generation: pid, command: p.command, state: p.lifecycle.state })) };
  }
  async flush(): Promise<void> { throw new ContainerError('UNSUPPORTED_PROFILE', 'This workspace is memory-only; persistence is not qualified'); }
  dispose(): Promise<void> {
    if (!this.#disposal) {
      this.#disposed = true;
      this.#disposal = Promise.all([...this.#processes.values()].map((p) => p.stop())).then(() => {});
    }
    return this.#disposal;
  }
}
export function createContainer(options: ContainerOptions = {}): Container { return new Container(options); }
