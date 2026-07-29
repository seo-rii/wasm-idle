// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_JULIA_ASSET_VERSION } from './wasmJuliaVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-julia-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-julia/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-julia/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = (event) => {
  try {
    const stdin = createStdinReader(event.data?.stdin || '', event.data?.stdinChannel);
    const output = createCharOutput([], (text) => self.postMessage({ output: text }));
    for (const value of new TextEncoder().encode('value? ')) output(value);
    const input = [];
    for (let value = stdin(); value !== null && value !== 10; value = stdin()) input.push(value);
    const text = new TextDecoder().decode(new Uint8Array(input));
    for (const value of new TextEncoder().encode('main=' + text)) output(value);
    output(10);
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
				if (code !== 0) reject(new Error(`Julia worker harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('Julia runner worker', () => {
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
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_JULIA_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_JULIA_ASSET_VERSION);
	});

	it('uses native stdin only for the shared-memory execution path', async () => {
		const source = await readWorkerSource();
		expect(source).toContain('open("/dev/stdin", "r")');
		expect(source).toContain(': `IOBuffer(${juliaString(stdin)})`');
		expect(source).toContain('stdinChannel !== undefined');
		expect(source).not.toContain('emscripten_run_script_int');
	});

	it('streams a prompt before consuming UTF-8 input from the shared ring', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		let transcript = '';
		const messages = await runHarness({ stdinChannel: stdin.descriptor }, (message) => {
			transcript += message?.output || '';
			if (transcript.includes('value? ') && !suppliedInput) {
				suppliedInput = true;
				setTimeout(() => {
					stdin.enqueue('안녕\n');
					stdin.close();
				}, 10);
			}
		});

		expect(suppliedInput).toBe(true);
		expect(transcript).toContain('value? main=안녕\n');
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

		expect(messages).toEqual([{ error: 'Invalid Julia streaming stdin channel.' }]);
	});
});
