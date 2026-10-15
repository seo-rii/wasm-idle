import { createLiveWorkerAdapter, type LiveWorkerOptions } from '../live-worker.js';
import type { LiveCommandAdapter } from '../types.js';

export interface LiveWasiAdapterOptions extends LiveWorkerOptions {}

/** Isolated, dedicated-Worker execution with immediate shared filesystem visibility. */
export function createLiveWasiAdapter(options: LiveWasiAdapterOptions = {}): LiveCommandAdapter {
  return createLiveWorkerAdapter({
    ...options, id: 'wasi-preview1-live',
    workerFactory: options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-live-command' }))
  });
}
