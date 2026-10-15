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
  readonly timeoutMs?: number;
  /** Observes every invocation outcome. No argv, environment or stdio bytes are reported. */
  readonly onRecord?: (record: HostCommandRecord) => void;
}
/** Shell status conventions for results that are not an ordinary guest exit. */
export const HOST_COMMAND_STATUS = Object.freeze({
  cannotExecute: 126, notFound: 127, timeout: 124, filesystemConflict: 125, runtimeError: 134, terminated: 143
});

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

async function diagnostic(stderr: DelegatedWriter | null, message: string): Promise<void> {
  if (!stderr) return;
  const bytes = new TextEncoder().encode(message);
  try {
    for (let offset = 0; offset < bytes.length;) {
      const written = await stderr.write(bytes.subarray(offset));
      if (!Number.isSafeInteger(written) || written < 1) return;
      offset += written;
    }
  } catch { /* The shell may already have closed its stderr. */ }
}

/**
 * Run each routed shell host command as one container process whose stdio is
 * the shell child's own delegated descriptors. Only live adapters accept them.
 * The returned status follows the shell's exit-status conventions.
 */
export function createHostCommandHandler(container: Container, options: HostCommandHandlerOptions): (invocation: HostCommandInvocation) => Promise<number> {
  const routes = new Map<string, HostCommandRoute>();
  for (const [path, route] of Object.entries(options.routes)) {
    if (!path.startsWith('/') || !route || typeof route.command !== 'string' || route.args !== undefined && !Array.isArray(route.args)) throw new ContainerError('INVALID_ARGUMENT', `Invalid host command route: ${path}`);
    routes.set(path, Object.freeze({ command: route.command, args: Object.freeze([...(route.args ?? [])]) }));
  }
  const record = (value: HostCommandRecord) => { options.onRecord?.(Object.freeze(value)); return value.status; };
  return async (invocation) => {
    const route = routes.get(invocation.path), name = invocation.argv[0] || invocation.path;
    if (!route) {
      await diagnostic(invocation.stderr, `${name}: no container route\n`);
      return record({ path: invocation.path, status: HOST_COMMAND_STATUS.notFound, startError: 'COMMAND_NOT_FOUND' });
    }
    let process;
    try {
      process = await container.spawn(route.command, [...route.args!, ...invocation.argv.slice(1)], {
        cwd: invocation.cwd, env: decodeEnvironment(invocation.env), timeoutMs: options.timeoutMs,
        stdio: { stdin: invocation.stdin, stdout: invocation.stdout, stderr: invocation.stderr }
      });
    } catch (error) {
      const code = error instanceof ContainerError ? error.code : (error as { code?: unknown })?.code;
      await diagnostic(invocation.stderr, `${name}: ${error instanceof Error ? error.message : 'cannot start'}\n`);
      return record({ path: invocation.path, status: code === 'COMMAND_NOT_FOUND' ? HOST_COMMAND_STATUS.notFound : HOST_COMMAND_STATUS.cannotExecute, startError: typeof code === 'string' ? code : 'STARTUP_FAILED' });
    }
    const result = await process.exited;
    return record({ path: invocation.path, pid: process.pid, result, status: statusForResult(result) });
  };
}
