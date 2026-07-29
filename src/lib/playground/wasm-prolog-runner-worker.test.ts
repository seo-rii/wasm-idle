// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_PROLOG_ASSET_VERSION } from './wasmPrologVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-prolog-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-prolog/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-prolog/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.importScripts = () => {};
self.SWIPL = async (options) => ({
  FS: {
    analyzePath: () => ({ exists: true }),
    mkdir: () => {},
    writeFile: () => {}
  },
  prolog: {
    query: () => ({
      once: () => {
        options.print('prompt>');
        const input = [];
        while (true) {
          const value = options.stdin();
          if (value === null) break;
          input.push(value);
        }
        options.print('received=' + Buffer.from(input).toString('utf8').trim());
        return true;
      },
      close: () => {}
    })
  }
});
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function runHarness(request: Record<string, unknown>, onMessage?: (message: any) => void) {
	const worker = await createHarnessWorker();
	const messages: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				messages.push(message);
				try {
					onMessage?.(message);
				} catch (error) {
					reject(error);
					return;
				}
				if (message?.results !== undefined || message?.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`SWI-Prolog harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('SWI-Prolog runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const hash = createHash('sha256');
		for (const fileName of [
			'runner-worker.js',
			'swipl-web.data',
			'swipl-web.js',
			'swipl-web.wasm'
		].sort()) {
			hash.update(fileName);
			hash.update('\0');
			const compressed = fileName.endsWith('.data') || fileName.endsWith('.wasm');
			const storedName = compressed ? `${fileName}.gz` : fileName;
			const stored = await readFile(new URL(storedName, staticRuntimeUrl));
			hash.update(compressed ? gunzipSync(stored) : stored);
			hash.update('\n');
		}
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_PROLOG_ASSET_VERSION);
	});

	it('prints a prompt before reading live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			{
				baseUrl: 'https://runtime.example/wasm-prolog/',
				code: 'main :- true.',
				stdinChannel: stdin.descriptor
			},
			(message) => {
				if (message?.output?.includes('prompt>') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('68\n');
						stdin.close();
					}, 10);
				}
			}
		);

		expect(messages.findIndex((message) => message?.output?.includes('prompt>'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('received=68'))
		);
		expect(messages.some((message) => message?.output?.includes('received=68'))).toBe(true);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			baseUrl: 'https://runtime.example/wasm-prolog/',
			code: 'main :- true.',
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid SWI-Prolog streaming stdin channel.' }]);
	});
});
