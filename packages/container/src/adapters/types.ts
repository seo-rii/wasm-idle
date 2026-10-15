import type { FileSystemSnapshot, MemoryFileSystem } from '../fs/index.js';

export interface CommandDefinition {
  readonly adapter: string;
  readonly bytes: Uint8Array;
  readonly argv0?: string;
}
export interface CommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}
export interface RuntimeLimits {
  readonly maxMemoryBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxWorkspaceBytes: number;
  readonly maxWorkspaceInodes: number;
}
export interface RuntimeCompletion {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly snapshot: FileSystemSnapshot;
}
export interface PreparedRuntime {
  run(stdin: Uint8Array): Promise<RuntimeCompletion>;
  dispose(): Promise<void>;
}
interface StartRequest {
  command: CommandDefinition;
  invocation: CommandInvocation;
  limits: RuntimeLimits;
  generation: number;
  signal: AbortSignal;
}
export interface SnapshotCommandAdapter {
  readonly id: string;
  readonly filesystem: 'snapshot';
  start(request: StartRequest & { snapshot: FileSystemSnapshot }): Promise<PreparedRuntime>;
}
export interface PreparedLiveRuntime {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  run(): Promise<{ readonly code: number }>;
  dispose(): Promise<void>;
}
export interface LiveCommandAdapter {
  readonly id: string;
  readonly filesystem: 'live';
  start(request: StartRequest & { fs: MemoryFileSystem }): Promise<PreparedLiveRuntime>;
}
/** Trusted local adapter code, never supplied by a distribution URL. */
export type CommandAdapter = SnapshotCommandAdapter | LiveCommandAdapter;
