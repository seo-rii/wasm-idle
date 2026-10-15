import { parentPort } from 'node:worker_threads';
globalThis.postMessage = (data) => parentPort.postMessage(data);
const queued = [];
parentPort.on('message', (data) => globalThis.onmessage ? globalThis.onmessage({ data }) : queued.push(data));
await import('../../dist/adapters/wasi/worker.js');
for (const data of queued) globalThis.onmessage({ data });
