import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
export const command = new Uint8Array(readFileSync(new URL('../fixtures/command.wasm', import.meta.url)));
export function workerFactory(module) {
  const worker = new Worker(new URL('./node-worker-entry.mjs', import.meta.url), { workerData: { module } });
  const wrapper = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage: (data, transfer) => worker.postMessage(data, transfer),
    terminate: () => worker.terminate()
  };
  worker.on('message', (data) => wrapper.onmessage?.({ data }));
  worker.on('error', (error) => wrapper.onerror?.({ error }));
  worker.on('messageerror', (error) => wrapper.onmessageerror?.({ error }));
  return wrapper;
}
