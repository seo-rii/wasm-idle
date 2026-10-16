import type { Container } from '../../container.js';
import { ContainerError } from '../../errors.js';
import { FsError, type FileStat } from '../../fs/index.js';
import { snapshotInvocation } from '../../process/lifecycle.js';
import { openWorkspaceEditor, createWorkspaceBackup, restoreWorkspaceBackup } from '../../workspace/index.js';
import type { WorkspaceSaveController, WorkspaceSaveInspection } from '../../workspace/save.js';
import type { PersistentWorkspaceGarbageCollectionOptions, PersistentWorkspaceGarbageCollectionResult } from '../../fs/persistence/index.js';
import type { ContainerInspection, ContainerProcess, ProcessResult } from '../../types.js';
import type { WasixShellSession } from './types.js';

export interface ShellStartOptions { readonly args?: readonly string[]; readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; }
export interface OwnerFile { readonly bytes: Uint8Array; readonly inode: number; readonly generation: number; }
export interface OwnerInspection extends ContainerInspection { readonly save?: WorkspaceSaveInspection; }
export interface RemoteShellSession extends ContainerProcess { interrupt(): Promise<number>; dispose(): Promise<void>; }
export interface ContainerOwnerOptions {
  readonly container: Container;
  readonly startShell: (options: ShellStartOptions, signal: AbortSignal) => Promise<WasixShellSession>;
  readonly save?: WorkspaceSaveController;
  /** Explicit asset-cache operation. This protocol never deletes browser stores itself. */
  readonly clearAssetCache?: () => Promise<unknown>;
  /** Release host-owned assets/persistence after process cleanup. */
  readonly dispose?: () => Promise<void>;
  readonly generation?: number;
  readonly maxFileBytes?: number;
  readonly maxBackupBytes?: number;
  readonly maxPendingRequests?: number;
}
export interface ContainerOwnerClient {
  readonly fs: {
    readFile(path: string): Promise<OwnerFile>;
    writeFile(path: string, bytes: Uint8Array, expected?: { readonly inode: number; readonly bytes: Uint8Array }): Promise<{ readonly inode: number; readonly generation: number }>;
    stat(path: string): Promise<FileStat>;
    readdir(path: string): Promise<readonly { readonly name: string; readonly type: FileStat['type'] }[]>;
    mkdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
  };
  startShell(options?: ShellStartOptions): Promise<RemoteShellSession>;
  inspect(): Promise<OwnerInspection>;
  flush(): Promise<OwnerInspection>;
  backup(): Promise<Uint8Array>;
  restore(bytes: Uint8Array, options: { readonly replace: true }): Promise<unknown>;
  setAutosave(enabled: boolean): Promise<OwnerInspection>;
  clearAssetCache(): Promise<unknown>;
  collectGarbage(options?: PersistentWorkspaceGarbageCollectionOptions): Promise<PersistentWorkspaceGarbageCollectionResult>;
  dispose(): Promise<void>;
}
export interface ContainerOwnerClientOptions {
  readonly generation?: number;
  readonly requestTimeoutMs?: number;
  readonly maxPendingRequests?: number;
  readonly maxFileBytes?: number;
  readonly maxBackupBytes?: number;
  /** The application's owner-Worker lifetime/error signal; rejects pending I/O. */
  readonly signal?: AbortSignal;
  /** A transport failure means remote cleanup is unconfirmed, not successful. */
  readonly onFailure?: (error: ContainerOwnerError) => void;
}
export class ContainerOwnerError extends Error {
  override readonly name = 'ContainerOwnerError';
  constructor(readonly code: string, message: string) { super(message); }
}
const VERSION = 1, CHUNK_BYTES = 65536;
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 && (value === '/workspace' || value.startsWith('/workspace/')) && !value.includes('\0');
const fail = (code: string, message: string): never => { throw new ContainerOwnerError(code, message); };
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const control = new Set(['dispose', 'shell.interrupt', 'shell.terminate', 'shell.cancel']);

/** Bind a private MessagePort to exactly one owner/container generation. */
export function serveContainerOwner(port: MessagePort, options: ContainerOwnerOptions): { dispose(): Promise<void> } {
  const generation = options.generation ?? 1, maxFile = options.maxFileBytes ?? 8 * 1024 * 1024;
  const maxBackup = options.maxBackupBytes ?? 32 * 1024 * 1024, maxPending = options.maxPendingRequests ?? 32;
  if (![generation, maxFile, maxBackup, maxPending].every(validNumber) || maxFile > 256 * 1024 * 1024 || maxBackup > 512 * 1024 * 1024 || maxPending > 256) throw new ContainerError('INVALID_ARGUMENT', 'Invalid owner protocol budgets');
  const container = options.container, active = new Set<number>(), stop = new AbortController();
  let sequence = 0, closed = false, starting: Promise<WasixShellSession> | undefined, shell: WasixShellSession | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [], reading = [false, false], inputBusy = { value: false };
  let disposing: Promise<void> | undefined;
  const dispose = () => disposing ??= (async () => {
    closed = true; stop.abort(new ContainerError('ABORTED', 'Owner disposed'));
    const errors: unknown[] = [];
    // Stop autosave scheduling immediately, before awaiting any guest cleanup.
    const saveDisposal = Promise.resolve().then(() => options.save?.dispose()); void saveDisposal.catch(() => {});
    if (starting) await starting.catch(() => {});
    for (const cleanup of [() => shell?.dispose(), () => container.dispose()]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    // Stream cancellation is observed without making cleanup depend on an SDK
    // promise which may be awaiting the now-terminated guest.
    for (const reader of readers) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
    if (writer) { void writer.abort().catch(() => {}); try { writer.releaseLock(); } catch {} }
    for (const cleanup of [() => saveDisposal, () => options.dispose?.()]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Container owner cleanup failed');
  })();
  const inspect = async (): Promise<OwnerInspection> => ({ ...await container.inspect(), ...(options.save ? { save: options.save.inspect() } : {}) });
  const path = (value: unknown) => { if (!validPath(value)) return fail('INVALID_ARGUMENT', 'Owner filesystem paths must stay in /workspace'); return value; };
  const bytes = (value: unknown, max: number) => { if (!(value instanceof Uint8Array) || value.length > max) return fail('RESOURCE_LIMIT', 'Owner byte request exceeds its limit'); return value; };
  const guest = () => { if (!shell) return fail('INVALID_ARGUMENT', 'Shell has not started'); return shell; };
  const dispatch = async (op: string, args: unknown[]): Promise<unknown> => {
    if (closed && op !== 'dispose') return fail('DISPOSED', 'Container owner is closed');
    switch (op) {
      case 'inspect': return inspect();
      case 'flush': if (options.save) await options.save.save(); else await container.flush(); return inspect();
      case 'backup': return createWorkspaceBackup(container.fs, { maxArchiveBytes: maxBackup });
      case 'restore': if (args[1] !== true) return fail('INVALID_ARGUMENT', 'Workspace replacement must be explicit'); return restoreWorkspaceBackup(container.fs, bytes(args[0], maxBackup), { replace: true, maxArchiveBytes: maxBackup });
      case 'autosave': if (!options.save || typeof args[0] !== 'boolean') return fail('UNSUPPORTED_PROFILE', 'Owner has no save controller'); options.save.setAutosave(args[0]); return inspect();
      case 'cache.clear': if (!options.clearAssetCache) return fail('UNSUPPORTED_PROFILE', 'Owner has no asset-cache action'); return options.clearAssetCache();
      case 'workspace.gc': if (!container.workspace) return fail('UNSUPPORTED_PROFILE', 'Owner has no persistent workspace'); return container.workspace.collectGarbage(args[0] as PersistentWorkspaceGarbageCollectionOptions);
      case 'fs.stat': return container.fs.stat(path(args[0]), { root: '/workspace' });
      case 'fs.readdir': {
        const directory = path(args[0]);
        return container.fs.readdir(directory, { root: '/workspace' }).map(name => ({ name, type: container.fs.lstat(`${directory}/${name}`, { root: '/workspace' }).type }));
      }
      case 'fs.read': {
        const name = path(args[0]), stat = container.fs.stat(name, { root: '/workspace' });
        if (stat.size > maxFile) return fail('RESOURCE_LIMIT', 'Editor file exceeds the owner byte limit');
        return { bytes: container.fs.readFile(name, { root: '/workspace' }), inode: stat.inode, generation: container.fs.generation };
      }
      case 'fs.write': {
        const name = path(args[0]), content = bytes(args[1], maxFile), expected = args[2] as { inode?: unknown; bytes?: unknown } | undefined;
        if (expected !== undefined) {
          if (!expected || !validNumber(expected.inode)) return fail('INVALID_ARGUMENT', 'Invalid expected file identity');
          const baseline = bytes(expected.bytes, maxFile);
          const resolved = container.fs.realpath(name, { root: '/workspace' });
          const editor = openWorkspaceEditor(container.fs, resolved, { maxFileBytes: maxFile });
          try {
            if (editor.inspect().inode !== expected.inode || !equal(editor.read(), baseline)) throw new FsError('ECONFLICT', 'File changed since the editor read it');
            editor.edit(content); return editor.publish();
          } finally { editor.dispose(); }
        }
        container.fs.writeFile(name, content, { root: '/workspace' });
        return { inode: container.fs.stat(name, { root: '/workspace' }).inode, generation: container.fs.generation };
      }
      case 'fs.mkdir': container.fs.mkdir(path(args[0]), { root: '/workspace' }); return;
      case 'fs.unlink': container.fs.unlink(path(args[0]), { root: '/workspace' }); return;
      case 'shell.start': {
        if (starting) return fail('INVALID_ARGUMENT', 'Each owner supports one SDK shell session');
        const request = args[0] as ShellStartOptions;
        if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['args', 'cwd', 'env'].includes(key))) return fail('INVALID_ARGUMENT', 'Invalid shell start request');
        if (request.env !== undefined && (!request.env || typeof request.env !== 'object' || Array.isArray(request.env))) return fail('INVALID_ARGUMENT', 'Shell environment must be a record');
        const invocation = snapshotInvocation('bash', request.args ?? [], request);
        const invocationSize = invocation.cwd.length + invocation.args.reduce((size, arg) => size + arg.length, 0) + Object.entries(invocation.env).reduce((size, [key, value]) => size + key.length + value.length, 0);
        if (invocation.args.length > 4096 || Object.keys(invocation.env).length > 4096 || invocationSize > 65536) return fail('RESOURCE_LIMIT', 'Shell invocation exceeds the owner request limit');
        const settings = { ...(request.args !== undefined ? { args: invocation.args } : {}),
          ...(request.cwd !== undefined ? { cwd: invocation.cwd } : {}), ...(request.env !== undefined ? { env: invocation.env } : {}) };
        starting = new Promise<WasixShellSession>((resolve, reject) => {
          const abort = () => reject(stop.signal.reason);
          stop.signal.addEventListener('abort', abort, { once: true });
          void Promise.resolve().then(() => { stop.signal.throwIfAborted(); return options.startShell(settings, stop.signal); }).then(value => {
            stop.signal.removeEventListener('abort', abort);
            if (stop.signal.aborted) { void Promise.resolve().then(() => value.dispose()).catch(() => {}); return; }
            resolve(value);
          }, error => { stop.signal.removeEventListener('abort', abort); reject(error); });
          if (stop.signal.aborted) abort();
        });
        shell = await starting;
        writer = shell.stdin.getWriter(); readers.push(shell.stdout.getReader(), shell.stderr.getReader());
        return { pid: shell.pid };
      }
      case 'shell.exit': return guest().exited;
      case 'shell.interrupt': return guest().interrupt();
      case 'shell.terminate': await guest().terminate(); return;
      case 'shell.read': {
        guest(); const index = args[0];
        if (index !== 0 && index !== 1 || reading[index]) return fail('INVALID_ARGUMENT', 'Only one read per output channel may be pending');
        reading[index] = true;
        try {
          const result = await readers[index]!.read();
          if (result.done) return null;
          return bytes(result.value, CHUNK_BYTES);
        } finally { reading[index] = false; }
      }
      case 'shell.cancel': {
        guest(); const index = args[0];
        if (index !== 0 && index !== 1) return fail('INVALID_ARGUMENT', 'Invalid output channel');
        await readers[index]!.cancel(); return;
      }
      case 'shell.write': case 'shell.eof': {
        guest(); if (inputBusy.value) return fail('RESOURCE_LIMIT', 'Only one stdin operation may be pending');
        inputBusy.value = true;
        try { if (op === 'shell.write') await writer!.write(bytes(args[0], CHUNK_BYTES)); else await writer!.close(); }
        finally { inputBusy.value = false; }
        return;
      }
      case 'dispose': await dispose(); return;
      default: return fail('INVALID_ARGUMENT', 'Unknown owner operation');
    }
  };
  port.onmessage = event => {
    const request = event.data;
    if (!request || request.version !== VERSION || request.generation !== generation || !validNumber(request.id) || request.id <= sequence || typeof request.op !== 'string' || !Array.isArray(request.args) || request.args.length > 3) {
      void dispose().catch(() => {}); port.close(); return;
    }
    sequence = request.id;
    const capacity = maxPending + (control.has(request.op) ? 4 : 0);
    const work = active.size >= capacity ? Promise.reject(new ContainerOwnerError('RESOURCE_LIMIT', 'Too many pending owner requests')) : dispatch(request.op, request.args);
    active.add(request.id);
    const reply = (ok: boolean, value: unknown) => {
      active.delete(request.id);
      port.postMessage({ version: VERSION, generation, id: request.id, ok, value });
      if (request.op === 'dispose') port.close();
    };
    void work.then(value => reply(true, value), error => reply(false, { code: typeof error?.code === 'string' ? error.code : 'STARTUP_FAILED', message: String(error?.message ?? error).slice(0, 1024) })).catch(() => { void dispose().catch(() => {}); });
  };
  port.onmessageerror = () => { void dispose().catch(() => {}); port.close(); };
  port.start();
  return { dispose };
}

/** Pull-based client: at most one pending read per stream, no unsolicited output queue. */
export function createContainerOwnerClient(port: MessagePort, options: ContainerOwnerClientOptions = {}): ContainerOwnerClient {
  const generation = options.generation ?? 1, timeout = options.requestTimeoutMs ?? 30000, maxPending = options.maxPendingRequests ?? 32;
  const maxFile = options.maxFileBytes ?? 8 * 1024 * 1024, maxBackup = options.maxBackupBytes ?? 32 * 1024 * 1024;
  if (![generation, timeout, maxPending, maxFile, maxBackup].every(validNumber) || maxPending > 256 || timeout > 3600000 || maxFile > 256 * 1024 * 1024 || maxBackup > 512 * 1024 * 1024) throw new ContainerError('INVALID_ARGUMENT', 'Invalid owner client limits');
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void; timer?: ReturnType<typeof setTimeout> }>();
  let sequence = 0, closed = false, disposal: Promise<void> | undefined, started = false;
  const close = (error: ContainerOwnerError, unexpected = false) => {
    if (closed) return;
    closed = true;
    if (unexpected) {
      // Best effort only: without a reply the host must report cleanup as
      // unconfirmed. It still owns the Worker and its failure/termination policy.
      try { port.postMessage({ version: VERSION, generation, id: ++sequence, op: 'dispose', args: [] }); } catch {}
    }
    for (const request of pending.values()) { if (request.timer) clearTimeout(request.timer); request.reject(error); }
    pending.clear(); options.signal?.removeEventListener('abort', abort); port.close();
    if (unexpected) { try { options.onFailure?.(error); } catch {} }
  };
  const abort = () => close(new ContainerOwnerError('ABORTED', 'Owner Worker lifetime ended; cleanup is unconfirmed'), true);
  const call = <T = any>(op: string, args: unknown[] = [], long = false): Promise<T> => {
    if (closed) return Promise.reject(new ContainerOwnerError('DISPOSED', 'Owner client is closed'));
    if (pending.size >= maxPending + (control.has(op) ? 4 : 0) || sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(new ContainerOwnerError('RESOURCE_LIMIT', 'Owner request budget exceeded'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = long ? undefined : setTimeout(() => close(new ContainerOwnerError('ABORTED', 'Owner request deadline exceeded; cleanup is unconfirmed'), true), timeout);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ version: VERSION, generation, id, op, args }); }
      catch (error) { if (timer) clearTimeout(timer); pending.delete(id); reject(error); }
    });
  };
  const ownedBytes = (value: Uint8Array, max: number) => { if (!(value instanceof Uint8Array) || value.length > max) return fail('RESOURCE_LIMIT', 'Owner request exceeds byte limit'); return value.slice(); };
  port.onmessage = event => {
    if (closed) return;
    const reply = event.data, request = pending.get(reply?.id);
    if (!reply || reply.version !== VERSION || reply.generation !== generation || typeof reply.ok !== 'boolean' || !request) { close(new ContainerOwnerError('STARTUP_FAILED', 'Invalid owner response generation or request'), true); return; }
    pending.delete(reply.id); if (request.timer) clearTimeout(request.timer);
    if (reply.ok) request.resolve(reply.value); else request.reject(new ContainerOwnerError(String(reply.value?.code ?? 'STARTUP_FAILED'), String(reply.value?.message ?? 'Owner request failed')));
  };
  port.onmessageerror = () => close(new ContainerOwnerError('STARTUP_FAILED', 'Owner response could not be decoded'), true);
  port.start();
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
  return Object.freeze({
    fs: Object.freeze({
      readFile: (path: string) => call<OwnerFile>('fs.read', [path]),
      writeFile: (path: string, bytes: Uint8Array, expected?: { inode: number; bytes: Uint8Array }) => call('fs.write', [path, ownedBytes(bytes, maxFile), expected && { inode: expected.inode, bytes: ownedBytes(expected.bytes, maxFile) }]),
      stat: (path: string) => call<FileStat>('fs.stat', [path]),
      readdir: (path: string) => call<readonly { name: string; type: FileStat['type'] }[]>('fs.readdir', [path]),
      mkdir: (path: string) => call<void>('fs.mkdir', [path]), unlink: (path: string) => call<void>('fs.unlink', [path])
    }),
    async startShell(settings: ShellStartOptions = {}) {
      if (started) return fail('INVALID_ARGUMENT', 'Each owner supports one SDK shell session'); started = true;
      const result = await call<{ pid: number }>('shell.start', [settings], true);
      const output = (index: number) => new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { const bytes = await call<Uint8Array | null>('shell.read', [index], true); if (bytes === null) controller.close(); else if (bytes instanceof Uint8Array && bytes.length <= CHUNK_BYTES) controller.enqueue(bytes); else throw new ContainerOwnerError('RESOURCE_LIMIT', 'Invalid owner output chunk'); }
          catch (error) { controller.error(error); }
        },
        cancel: () => call<void>('shell.cancel', [index])
      }, { highWaterMark: 0 });
      const stdin = new WritableStream<Uint8Array>({ write: bytes => call<void>('shell.write', [ownedBytes(bytes, CHUNK_BYTES)], true), close: () => call<void>('shell.eof', [], true), abort: () => call<void>('shell.terminate') }, { highWaterMark: 1 });
      const exited = call<ProcessResult>('shell.exit', [], true); void exited.catch(() => {});
      const terminate = () => call<void>('shell.terminate');
      return Object.freeze({ pid: result.pid, stdin, stdout: output(0), stderr: output(1), exited, terminate, dispose: terminate, interrupt: () => call<number>('shell.interrupt') });
    },
    inspect: () => call<OwnerInspection>('inspect'), flush: () => call<OwnerInspection>('flush'),
    backup: () => call<Uint8Array>('backup'), restore: (bytes: Uint8Array, settings: { replace: true }) => call('restore', [ownedBytes(bytes, maxBackup), settings?.replace]),
    setAutosave: (enabled: boolean) => call<OwnerInspection>('autosave', [enabled]), clearAssetCache: () => call('cache.clear'),
    collectGarbage: (settings: PersistentWorkspaceGarbageCollectionOptions = {}) => call<PersistentWorkspaceGarbageCollectionResult>('workspace.gc', [settings]),
    dispose() { return disposal ??= call<void>('dispose').finally(() => close(new ContainerOwnerError('DISPOSED', 'Owner client disposed'))); }
  });
}
