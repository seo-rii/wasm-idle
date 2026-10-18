import { createSnapshotWorkerAdapter, type CommandWorker } from '../worker-adapter.js';
export type { CommandWorker } from '../worker-adapter.js';
export interface WasiAdapterOptions {
  /** Trusted host factory for bundlers and Node contract tests. */
  workerFactory?: () => CommandWorker;
}
export function createWasiAdapter(options: WasiAdapterOptions = {}) {
  return createSnapshotWorkerAdapter({
    id: 'wasi-preview1',
    workerFactory: options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-command' }))
  });
}
