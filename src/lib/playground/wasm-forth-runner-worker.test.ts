// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_FORTH_ASSET_VERSION } from './wasmForthVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-forth-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-forth/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-forth/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
class FakeWAForth {
  async load() {}
  interpret() {
    for (const value of Buffer.from('value?\\n')) this.onEmit(value);
    const input = [];
    while (true) {
      const value = this.key();
      if (value === -1) break;
      input.push(value);
    }
    const parsed = Number(Buffer.from(input).toString('utf8').trim());
    for (const value of Buffer.from('main=' + (parsed + 5) + '\\n')) this.onEmit(value);
    return 0;
  }
}
FakeWAForth.isSuccess = () => true;
self.WAForthPackage = FakeWAForth;
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
				if (code !== 0) reject(new Error(`WAForth harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('WAForth runner worker', () => {
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
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_FORTH_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_FORTH_ASSET_VERSION);
	});

	it('streams a prompt before reading shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		let transcript = '';
		const messages = await runHarness(
			{
				baseUrl: 'https://runtime.example/wasm-forth/',
				code: 'KEY',
				stdinChannel: stdin.descriptor
			},
			(message) => {
				transcript += message?.output || '';
				if (transcript.includes('value?') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('68\n');
						stdin.close();
					}, 10);
				}
			}
		);

		const output = messages.map((message) => message?.output || '').join('');
		expect(output.indexOf('value?')).toBeLessThan(output.indexOf('main=73'));
		expect(output).toContain('main=73');
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			baseUrl: 'https://runtime.example/wasm-forth/',
			code: 'KEY',
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid WAForth streaming stdin channel.' }]);
	});
});
