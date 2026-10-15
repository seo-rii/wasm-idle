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
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<ProcessResult>;
  terminate(): Promise<void>;
}
export interface SpawnOptions {
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface RunOptions extends SpawnOptions {
  stdin?: Uint8Array;
  maxCaptureBytes?: number;
}
export interface CapturedProcessResult extends ProcessResult {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
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
