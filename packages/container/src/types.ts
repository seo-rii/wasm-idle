import type { RuntimeLimits } from './adapters/types.js';
import type { PersistentWorkspaceInspection } from './fs/persistence/index.js';
import type { PackageManagerInspection } from './packages/manager.js';

export type ProcessExitReason =
  | 'exited' | 'terminated' | 'timeout' | 'runtime-error' | 'filesystem-conflict';
export interface ProcessResult {
  readonly code: number | null;
  readonly reason: ProcessExitReason;
  /** Present only when the adapter implements that signal. */
  readonly signal?: string;
}
export interface ContainerProcess {
  readonly pid: number;
  /** Opaque owner-only attribution token; independent of other containers' pid namespaces. */
  readonly mutationSource?: object;
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<ProcessResult>;
  terminate(): Promise<void>;
}
/** A caller-owned byte source, read on demand. An empty result is end of file. */
export interface DelegatedReader {
  /** Resolve with 1 to `maxBytes` bytes, or an empty array at end of file. */
  read(maxBytes: number): Promise<Uint8Array>;
  close(): void;
}
/** A caller-owned byte sink. A write may accept fewer bytes than offered. */
export interface DelegatedWriter {
  write(bytes: Uint8Array): Promise<number>;
  close(): void;
}
/**
 * Explicit stdio delegation for live adapters. An omitted channel keeps the
 * container-owned stream; `null` starts that descriptor closed in the guest.
 * A delegated endpoint is used directly by the guest's fd_read/fd_write/fd_close
 * and stays owned by the caller: the container never closes it on exit, and the
 * corresponding `ContainerProcess` stream is closed from the start.
 */
export interface DelegatedStdio {
  readonly stdin?: DelegatedReader | null;
  readonly stdout?: DelegatedWriter | null;
  readonly stderr?: DelegatedWriter | null;
}
export interface SpawnOptions {
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Live adapters only. Not supported by `run` or `spawnPipeline`. */
  stdio?: DelegatedStdio;
}
export interface RunOptions extends SpawnOptions {
  stdin?: Uint8Array;
  maxCaptureBytes?: number;
}
export interface CapturedProcessResult extends ProcessResult {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}
export interface PipelineCommand {
  readonly command: string;
  readonly args?: readonly string[];
}
export interface ContainerPipeline {
  readonly processes: readonly ContainerProcess[];
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  /** Stderr stays separate for each process; consumers must drain every stream. */
  readonly stderr: readonly ReadableStream<Uint8Array>[];
  readonly exited: Promise<readonly ProcessResult[]>;
  terminate(): Promise<void>;
}
export type ProcessState = 'created' | 'resolving' | 'preparing' | 'starting' | 'running' | 'exiting' | 'exited';
export interface ProcessInspection {
  readonly pid: number;
  readonly generation: number;
  readonly command: string;
  readonly state: ProcessState;
}
export interface ContainerInspection {
  readonly disposed: boolean;
  readonly processes: readonly ProcessInspection[];
  readonly profile: 'batch' | 'isolated';
  readonly persistence: 'memory' | 'opfs';
  readonly limits: RuntimeLimits;
  readonly workspace?: PersistentWorkspaceInspection;
  readonly packages?: PackageManagerInspection;
}
