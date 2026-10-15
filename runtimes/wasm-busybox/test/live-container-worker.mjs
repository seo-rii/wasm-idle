// Node transport only; guest execution remains in the production live Worker.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.postMessage = (data) => parentPort.postMessage(data);
const queued = [];
parentPort.on('message', (data) => globalThis.onmessage ? globalThis.onmessage({ data }) : queued.push(data));
await import(workerData.module);
for (const data of queued) globalThis.onmessage({ data });
