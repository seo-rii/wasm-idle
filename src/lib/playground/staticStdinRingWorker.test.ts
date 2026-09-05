// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';

const readers = [
	{ language: 'bqn', factory: 'createSharedInputReader', eof: null },
	{ language: 'forth', factory: 'createSharedKeyReader', eof: -1 },
	{ language: 'tcl', factory: 'createSharedStdinReader', eof: null }
] as const;

describe.each(readers)('$language shared stdin wakeup races', ({ language, factory, eof }) => {
	it.each(['close', 'cancel'] as const)(
		'observes %s between the state check and entering Atomics.wait',
		async (operation) => {
			const host = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
			host.enqueue('68\n');
			const gate = new Int32Array(new SharedArrayBuffer(4));
			const source = await readFile(
				new URL(
					`../../../scripts/runtime-workers/wasm-${language}-runner-worker.js`,
					import.meta.url
				),
				'utf8'
			);
			const worker = new Worker(
				`
const { parentPort, workerData } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = () => {};
const read = new Function(${JSON.stringify(`${source}\nreturn ${factory};`)})()(workerData.channel);
const nativeWait = Atomics.wait;
let interposed = false;
Atomics.wait = (control, index, expected, timeout) => {
  if (!interposed) {
    interposed = true;
    parentPort.postMessage({ beforeWait: true });
    // Force the host's notification to finish before the real stdin wait begins.
    if (nativeWait(workerData.gate, 0, 0, 2000) === 'timed-out') {
      throw new Error('Host did not release the stdin race gate');
    }
  }
  return nativeWait(control, index, expected, timeout);
};
const bytes = [];
try {
  while (true) {
    const value = read();
    if (value === workerData.eof) break;
    bytes.push(value);
  }
  parentPort.postMessage({ bytes, eof: true });
} catch (error) {
  parentPort.postMessage({ bytes, error: error.message });
}
`,
				{ eval: true, workerData: { channel: host.descriptor, gate, eof } }
			);
			let watchdog: ReturnType<typeof setTimeout> | undefined;
			try {
				const result = await new Promise<{
					bytes: number[];
					eof?: boolean;
					error?: string;
				}>((resolve, reject) => {
					watchdog = setTimeout(
						() => reject(new Error('Worker did not reach the stdin race gate')),
						3_000
					);
					worker.once('error', reject);
					worker.once('exit', (code) =>
						reject(new Error(`Stdin race Worker exited before returning a result (${code})`))
					);
					worker.on('message', (message) => {
						if (message.beforeWait) {
							clearTimeout(watchdog);
							host[operation]();
							Atomics.store(gate, 0, 1);
							Atomics.notify(gate, 0);
							watchdog = setTimeout(
								() =>
									reject(
										new Error(
											`Lost ${operation} notification left stdin blocked`
										)
									),
								1_000
							);
							return;
						}
						resolve(message);
					});
				});
				expect(result.bytes).toEqual([54, 56, 10]);
				if (operation === 'close') expect(result.eof).toBe(true);
				else expect(result.error).toContain('streaming stdin was cancelled');
			} finally {
				clearTimeout(watchdog);
				await worker.terminate();
			}
		}
	);
});
