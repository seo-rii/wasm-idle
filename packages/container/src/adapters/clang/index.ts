import { ContainerError } from '../../errors.js';
import { createSnapshotWorkerAdapter, type CommandWorker } from '../worker-adapter.js';

export interface ClangAdapterOptions {
  /** Logical identities from the application-pinned distribution. No download occurs here. */
  readonly clangSha256: string;
  readonly linkerSha256: string;
  /** Absolute path to the verified linker in the prepared readonly package tree. */
  readonly linkerPath: string;
  /** Trusted readonly executable aliases that Clang may resolve for its own cc1 jobs. */
  readonly compilerPaths?: readonly string[];
  /** Mark changed workspace outputs executable only after validating this command ABI. */
  readonly executableOutputProfile?: 'wasi-preview1-process';
  readonly workerFactory?: () => CommandWorker;
}

export function createClangAdapter(options: ClangAdapterOptions) {
  if (!options || !/^[a-f0-9]{64}$/u.test(options.clangSha256) || !/^[a-f0-9]{64}$/u.test(options.linkerSha256) ||
      typeof options.linkerPath !== 'string' || !options.linkerPath.startsWith('/opt/toolchains/') ||
      options.linkerPath.includes('\0') || options.linkerPath.includes('\\') || new TextEncoder().encode(options.linkerPath).length > 4096 ||
      options.linkerPath.slice(1).split('/').some((p) => !p || p === '.' || p === '..') ||
      options.executableOutputProfile !== undefined && options.executableOutputProfile !== 'wasi-preview1-process') {
    throw new ContainerError('INVALID_ARGUMENT', 'Clang requires pinned tool digests and a canonical readonly linker path');
  }
  if (options.compilerPaths !== undefined && (!Array.isArray(options.compilerPaths) || options.compilerPaths.length > 16 || options.compilerPaths.some(path =>
      typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.includes('\\') ||
      path.slice(1).split('/').some(part => !part || part === '.' || part === '..') ||
      new TextEncoder().encode(path).length > 4096 || new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(path)) !== path || path === options.linkerPath))) {
    throw new ContainerError('INVALID_ARGUMENT', 'Compiler aliases must be bounded canonical absolute filesystem paths');
  }
  const configuration = Object.freeze({ clangSha256: options.clangSha256, linkerSha256: options.linkerSha256,
    linkerPath: options.linkerPath, compilerPaths: Object.freeze([...(options.compilerPaths ?? [])]), executableOutputProfile: options.executableOutputProfile });
  return createSnapshotWorkerAdapter({
    id: 'llvm-clang-tool-host-v1', configuration,
    workerFactory: options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-clang' }))
  });
}
