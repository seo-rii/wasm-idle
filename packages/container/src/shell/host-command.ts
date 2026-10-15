import { ContainerError } from '../errors.js';
import type { Container } from '../container.js';
import type { DelegatedReader, DelegatedWriter, ProcessResult } from '../types.js';

/**
 * Structural shape of one trusted shell host-command invocation, such as the
 * patched WASIX SDK's `HostCommandInvocation`. The container never imports
 * the shell runtime; the caller registers the returned handler there.
 */
export interface HostCommandInvocation {
  readonly path: string;
  readonly argv: readonly string[];
  /** Raw `name=value` entries. */
  readonly env: readonly Uint8Array[];
  readonly cwd: string;
  readonly stdin: DelegatedReader | null;
  readonly stdout: DelegatedWriter | null;
  readonly stderr: DelegatedWriter | null;
}
/** A trusted mapping from one shell path to one container command. */
export interface HostCommandRoute {
  /** A registered command, a package command or `wasm-run`. */
  readonly command: string;
  /** Inserted before the shell's `argv[1..]`; the container supplies argv0. */
  readonly args?: readonly string[];
  /**
   * `delegated` (default) hands the shell child's descriptors to a live adapter.
   * `forwarded` runs a snapshot adapter, such as Clang, on container streams:
   * stdin is empty, and stdout and stderr are copied to the shell child's
   * descriptors as they arrive. The shell's stdin is never consumed.
   */
  readonly stdio?: 'delegated' | 'forwarded';
}
export interface HostCommandRecord {
  readonly path: string;
  readonly status: number;
  readonly pid?: number;
  readonly result?: ProcessResult;
  /** Container error code or message when the command did not start. */
  readonly startError?: string;
}
export interface HostCommandHandlerOptions {
  readonly routes: Readonly<Record<string, HostCommandRoute>>;
  /**
   * Normalized absolute directories, registered with the shell runtime's
   * `registerHostCommandDirectory`, whose WebAssembly modules run as
   * `wasm-run <path> argv[1..]` with delegated stdio. An exact route wins.
   */
  readonly moduleDirectories?: readonly string[];
  readonly timeoutMs?: number;
  /** Observes every invocation outcome. No argv, environment or stdio bytes are reported. */
  readonly onRecord?: (record: HostCommandRecord) => void;
}
/** Shell status conventions for results that are not an ordinary guest exit. */
export const HOST_COMMAND_STATUS = Object.freeze({
  cannotExecute: 126, notFound: 127, timeout: 124, filesystemConflict: 125, runtimeError: 134, interrupted: 130, terminated: 143
});
/** A host-command handler whose running commands its owner can interrupt. */
export interface HostCommandHandler {
  (invocation: HostCommandInvocation): Promise<number>;
  /**
   * Stop every command this handler is running or starting, as a terminal's
   * interrupt key stops the foreground job. Each completes with status 130 and
   * the shell continues; returns how many were interrupted.
   */
  interrupt(): number;
}

function decodeEnvironment(entries: readonly Uint8Array[]): Record<string, string> {
  const decoder = new TextDecoder('utf-8', { fatal: true }), env: Record<string, string> = Object.create(null);
  for (const entry of entries) {
    if (!(entry instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'Environment entry must be bytes');
    let text: string;
    try { text = decoder.decode(entry); } catch { throw new ContainerError('INVALID_ARGUMENT', 'Environment entry is not UTF-8'); }
    const separator = text.indexOf('=');
    const name = text.slice(0, separator), value = text.slice(separator + 1);
    if (separator < 1 || name.includes('\0') || value.includes('\0') || Object.hasOwn(env, name)) throw new ContainerError('INVALID_ARGUMENT', 'Environment entry is not a unique UTF-8 name=value pair');
    env[name] = value;
  }
  return env;
}

export function statusForResult(result: ProcessResult): number {
  switch (result.reason) {
    case 'exited': return result.code! & 0xff;
    case 'timeout': return HOST_COMMAND_STATUS.timeout;
    case 'terminated': return HOST_COMMAND_STATUS.terminated;
    case 'filesystem-conflict': return HOST_COMMAND_STATUS.filesystemConflict;
    default: return HOST_COMMAND_STATUS.runtimeError;
  }
}

/** Write all bytes, following partial writes. Returns false once the endpoint fails. */
async function writeAll(endpoint: DelegatedWriter, bytes: Uint8Array): Promise<boolean> {
  try {
    for (let offset = 0; offset < bytes.length;) {
      const written = await endpoint.write(bytes.subarray(offset));
      if (!Number.isSafeInteger(written) || written < 1) return false;
      offset += written;
    }
    return true;
  } catch { return false; /* The shell may already have closed it. */ }
}

async function diagnostic(stderr: DelegatedWriter | null, message: string): Promise<void> {
  if (stderr) await writeAll(stderr, new TextEncoder().encode(message));
}

/** Copy a container stream to a shell descriptor; keep draining after the descriptor fails. */
async function forward(stream: ReadableStream<Uint8Array>, endpoint: DelegatedWriter | null): Promise<void> {
  const reader = stream.getReader();
  let open = endpoint !== null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (open) open = await writeAll(endpoint!, value);
    }
  } finally { reader.releaseLock(); }
}

const normalizedDirectory = (path: unknown): path is string => typeof path === 'string' && path.length > 1 &&
  path.startsWith('/') && !path.includes('\0') && path.slice(1).split('/').every((part) => part && part !== '.' && part !== '..');

/**
 * Run each routed shell host command as one container process whose stdio is
 * the shell child's own delegated descriptors. Only live adapters accept them.
 * The returned status follows the shell's exit-status conventions.
 */
export function createHostCommandHandler(container: Container, options: HostCommandHandlerOptions): HostCommandHandler {
  const routes = new Map<string, HostCommandRoute>();
  for (const [path, route] of Object.entries(options.routes)) {
    if (!path.startsWith('/') || !route || typeof route.command !== 'string' || route.args !== undefined && !Array.isArray(route.args) ||
        route.stdio !== undefined && route.stdio !== 'delegated' && route.stdio !== 'forwarded') throw new ContainerError('INVALID_ARGUMENT', `Invalid host command route: ${path}`);
    routes.set(path, Object.freeze({ command: route.command, args: Object.freeze([...(route.args ?? [])]), stdio: route.stdio ?? 'delegated' }));
  }
  const directories = [...(options.moduleDirectories ?? [])];
  if (!directories.every(normalizedDirectory)) throw new ContainerError('INVALID_ARGUMENT', 'Module directories must be normalized absolute paths');
  const moduleRoute = (path: string): HostCommandRoute | undefined =>
    normalizedDirectory(path) && directories.some((directory) => path.startsWith(directory + '/'))
      ? { command: 'wasm-run', args: [path], stdio: 'delegated' } : undefined;
  const record = (value: HostCommandRecord) => { options.onRecord?.(Object.freeze(value)); return value.status; };
  const running = new Set<AbortController>();
  const handler = async (invocation: HostCommandInvocation): Promise<number> => {
    const route = routes.get(invocation.path) ?? moduleRoute(invocation.path), name = invocation.argv[0] || invocation.path;
    if (!route) {
      await diagnostic(invocation.stderr, `${name}: no container route\n`);
      return record({ path: invocation.path, status: HOST_COMMAND_STATUS.notFound, startError: 'COMMAND_NOT_FOUND' });
    }
    const forwarded = route.stdio === 'forwarded';
    const controller = new AbortController();
    running.add(controller);
    try {
      let process;
      try {
        process = await container.spawn(route.command, [...route.args!, ...invocation.argv.slice(1)], {
          cwd: invocation.cwd, env: decodeEnvironment(invocation.env), timeoutMs: options.timeoutMs, signal: controller.signal,
          ...(forwarded ? {} : { stdio: { stdin: invocation.stdin, stdout: invocation.stdout, stderr: invocation.stderr } })
        });
      } catch (error) {
        const code = error instanceof ContainerError ? error.code : (error as { code?: unknown })?.code;
        if (controller.signal.aborted) return record({ path: invocation.path, status: HOST_COMMAND_STATUS.interrupted, startError: 'ABORTED' });
        await diagnostic(invocation.stderr, `${name}: ${error instanceof Error ? error.message : 'cannot start'}\n`);
        return record({ path: invocation.path, status: code === 'COMMAND_NOT_FOUND' ? HOST_COMMAND_STATUS.notFound : HOST_COMMAND_STATUS.cannotExecute, startError: typeof code === 'string' ? code : 'STARTUP_FAILED' });
      }
      if (forwarded) {
        await process.stdin.close().catch(() => {});
        await Promise.all([forward(process.stdout, invocation.stdout), forward(process.stderr, invocation.stderr)]);
      }
      const result = await process.exited;
      const status = controller.signal.aborted && result.reason === 'terminated' ? HOST_COMMAND_STATUS.interrupted : statusForResult(result);
      return record({ path: invocation.path, pid: process.pid, result, status });
    } finally {
      running.delete(controller);
    }
  };
  return Object.assign(handler, {
    interrupt() {
      const interrupted = [...running];
      for (const controller of interrupted) controller.abort(new ContainerError('ABORTED', 'Interrupted by the shell owner'));
      return interrupted.length;
    }
  });
}
