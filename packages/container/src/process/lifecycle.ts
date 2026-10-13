import { ContainerError } from '../errors.js';
import type { ProcessResult, ProcessState, SpawnOptions } from '../types.js';

const order: readonly ProcessState[] = ['created', 'resolving', 'preparing', 'starting', 'running', 'exiting', 'exited'];

/** Owned by one supervisor process generation; terminal publication is exactly once. */
export class ProcessLifecycle {
  #state: ProcessState = 'created';
  #result?: Readonly<ProcessResult>;
  #resolve!: (result: ProcessResult) => void;
  readonly exited = new Promise<ProcessResult>((resolve) => { this.#resolve = resolve; });
  get state(): ProcessState { return this.#state; }
  transition(next: ProcessState): void {
    if (this.#result || next === 'exited' || (next !== 'exiting' && order.indexOf(next) !== order.indexOf(this.#state) + 1)) {
      throw new ContainerError('STARTUP_FAILED', `Invalid process transition ${this.#state} → ${next}`);
    }
    this.#state = next;
  }
  finish(result: ProcessResult): boolean {
    if (this.#result) return false;
    if ((result.reason === 'exited') !== (result.code !== null) ||
        (result.code !== null && (!Number.isSafeInteger(result.code) || result.code < 0))) {
      throw new ContainerError('INVALID_ARGUMENT', 'Invalid process result');
    }
    this.#result = Object.freeze({ ...result });
    this.#state = 'exited';
    this.#resolve(this.#result);
    return true;
  }
}

export function snapshotInvocation(command: string, args: readonly string[], options: SpawnOptions = {}) {
  const validString = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0');
  if (!validString(command) || !command || !Array.isArray(args) || !args.every(validString)) {
    throw new ContainerError('INVALID_ARGUMENT', 'Command and argv must be NUL-free strings');
  }
  const cwd = options.cwd ?? '/workspace';
  if (!validString(cwd) || !cwd.startsWith('/')) {
    throw new ContainerError('INVALID_ARGUMENT', 'cwd must be an absolute NUL-free path');
  }
  const env: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!validString(key) || !key || key.includes('=') || !validString(value)) {
      throw new ContainerError('INVALID_ARGUMENT', 'Invalid environment entry');
    }
    env[key] = value;
  }
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)) {
    throw new ContainerError('INVALID_ARGUMENT', 'timeoutMs must be a positive timer-safe integer');
  }
  return Object.freeze({ command, args: Object.freeze([...args]), cwd, env: Object.freeze(env), timeoutMs, signal: options.signal });
}
