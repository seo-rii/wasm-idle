// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_NIM_ASSET_VERSION } from './wasmNimVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-nim-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-nim/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-nim/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = (event) => {
  try {
    const stdin = createStdinReader(event.data?.stdin || '', event.data?.stdinChannel);
    const output = createOutputCollector((text) => self.postMessage({ output: text }));
    output.push(new TextEncoder().encode('value?\\n'));
    const input = stdin.read(32);
    output.push(new TextEncoder().encode('main=' + new TextDecoder().decode(input) + '\\n'));
    output.finish();
    self.postMessage({ results: true });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(harnessHandler)});
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
				if (code !== 0) reject(new Error(`Nim worker harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('Nim runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		const hash = createHash('sha256');
		for (const fileName of [...manifest.files, 'runner-worker.js'].sort()) {
			hash.update(fileName);
			hash.update('\0');
			hash.update(await readFile(new URL(fileName, staticRuntimeUrl)));
			hash.update('\n');
		}
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_NIM_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_NIM_ASSET_VERSION);
	});

	it('streams a prompt before consuming currently available UTF-8 input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness({ stdinChannel: stdin.descriptor }, (message) => {
			if (message?.output?.includes('value?') && !suppliedInput) {
				suppliedInput = true;
				setTimeout(() => {
					stdin.enqueue('안녕\r\n');
					stdin.close();
				}, 10);
			}
		});

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=안녕'))
		);
		expect(messages.some((message) => message?.output?.includes('main=안녕'))).toBe(true);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid Nim streaming stdin channel.' }]);
	});
});
