import { createSnapshotWorkerAdapter } from '../worker-adapter.js';
import { validateClangOptions, type ClangAdapterOptions } from './configuration.js';
export type { ClangAdapterOptions } from './configuration.js';

export function createClangAdapter(options: ClangAdapterOptions) {
  const configuration = validateClangOptions(options);
  return createSnapshotWorkerAdapter({
    id: 'llvm-clang-tool-host-v1', configuration,
    workerFactory: options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-clang' }))
  });
}
