import type { Container } from '../../container.js';
import type { ContainerProcess } from '../../types.js';
import type { VerifiedAssetLoader } from '../../packages/assets.js';
import type { HostCommandInvocation, HostCommandHandlerOptions, HostCommandRecord } from '../../shell/host-command.js';
import type { ShellFilesystem } from '../../shell/filesystem.js';
import type { WasixWorkerGroup } from './workers.js';

export interface WasixInstance {
  readonly stdin?: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** Consumes the Instance; retain streams first. Rejects non-guest setup/trap failures. */
  waitForExit(): Promise<{ readonly code: number; readonly ok: boolean }>;
}
export interface WasixDirectory { free(): void; }
export interface WasixRuntime {
  registerHostCommand(path: string, handler: (invocation: HostCommandInvocation) => Promise<number>): void;
  registerHostCommandDirectory(path: string, handler: (invocation: HostCommandInvocation) => Promise<number>): void;
  free(): void;
}
export interface WasixCommand {
  binary(): Uint8Array;
  run(options: {
    args: string[]; cwd: string; env: Record<string, string>;
    mount: Record<string, WasixDirectory>; rawStdin: true;
  }): Promise<WasixInstance>;
  free?(): void;
}
/** Only trusted application code may supply the statically imported SDK implementation. */
export interface WasixSdk {
  init(options: { module: WebAssembly.Module; memory: WebAssembly.Memory; sdkUrl: string; workerUrl: string }): Promise<unknown>;
  Runtime: new (options: { registry: null }) => WasixRuntime;
  Directory: { fromHostFileSystem(delegate: ShellFilesystem): WasixDirectory };
  Wasmer: { fromFile(bytes: Uint8Array, runtime: WasixRuntime): Promise<{ readonly entrypoint?: WasixCommand; free?(): void }> };
}
export interface WasixAssetReference { readonly packageId: string; readonly assetId: string; }
export interface WasixShellOptions extends Pick<HostCommandHandlerOptions, 'routes' | 'moduleDirectories' | 'timeoutMs'> {
  readonly container: Container;
  readonly sdk: WasixSdk;
  /** Install before initializing the SDK in an otherwise dedicated owner Worker. */
  readonly workers: WasixWorkerGroup;
  readonly assets: VerifiedAssetLoader;
  readonly sdkAsset: WasixAssetReference;
  readonly shellAsset: WasixAssetReference;
  readonly shellWasmSha256: string;
  /** Trusted static application module URLs, never URLs read from package metadata. */
  readonly sdkUrl: string;
  readonly workerUrl: string;
  /** Shared SDK memory in pages (64 KiB); a maximum is mandatory. */
  readonly memory: { readonly initial: number; readonly maximum: number };
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Common filesystem directories mounted at their same absolute paths. */
  readonly mounts?: readonly string[];
  readonly signal?: AbortSignal;
  readonly onRecord?: (record: HostCommandRecord) => void;
  /** Optional trusted lazy package preparation; must honor its command's signal. */
  readonly prepareCommand?: (invocation: HostCommandInvocation, signal: AbortSignal) => Promise<void>;
}
export interface WasixShellSession extends ContainerProcess {
  /** Stops routed external commands, preserving Bash. Builtin loops require terminate(). */
  interrupt(): number;
  /** Release the dedicated SDK group; idempotent. User workspace is retained. */
  dispose(): Promise<void>;
}
