import type { FileSystemSnapshot } from '../fs/index.js';

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
/** Trusted local adapter code, never supplied by a distribution URL. */
export interface CommandAdapter {
  readonly id: string;
  readonly filesystem: 'snapshot';
  start(request: {
    command: CommandDefinition;
    invocation: CommandInvocation;
    snapshot: FileSystemSnapshot;
    limits: RuntimeLimits;
    generation: number;
    signal: AbortSignal;
  }): Promise<PreparedRuntime>;
}
