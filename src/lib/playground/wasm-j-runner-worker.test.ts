// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_J_ASSET_VERSION } from './wasmJVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-j-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-j/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-j/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const importStatement = "const runtimeModule = await import(assetUrl(baseUrl, 'jamalgam.js'));";
	if (!workerSource.includes(importStatement)) {
		throw new Error('J worker module import seam was not found.');
	}
	const harnessSource = workerSource.replace(
		importStatement,
		'const runtimeModule = { default: globalThis.__createJModule };'
	);
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.fetch = async () => new Response(new Uint8Array([0]));
globalThis.__createJModule = async (options) => {
  let parsed = 0;
  return {
    cwrap: (name) => {
      if (name === 'em_jinit') return () => 0;
      if (name === 'em_jsetstr') return () => {};
      return (line) => {
        if (line.includes('stdlib.ijs')) return '';
        if (line.includes("smoutput 'value?'")) return 'value?';
        if (line.includes('1!:1')) {
          const input = [];
          while (true) {
            const value = options.stdin();
            if (value === null) break;
            input.push(value);
          }
          parsed = Number(Buffer.from(input).toString('utf8').trim());
          return '';
        }
        if (line.includes("smoutput 'main='")) return 'main=' + (parsed + 5);
        return '';
      };
    }
  };
};
(0, eval)(${JSON.stringify(harnessSource)});
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
				if (code !== 0) reject(new Error(`J harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('J runner worker', () => {
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
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_J_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_J_ASSET_VERSION);
	});

	it('streams a prompt before reading shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			{
				baseUrl: 'https://runtime.example/wasm-j/',
				code: "smoutput 'value?'\ninput =: 1!:1 [ 1\nsmoutput 'main='",
				stdinChannel: stdin.descriptor
			},
			(message) => {
				if (message?.output?.includes('value?') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('68\n');
						stdin.close();
					}, 10);
				}
			}
		);

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=73'))
		);
		expect(messages.some((message) => message?.output?.includes('main=73'))).toBe(true);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			baseUrl: 'https://runtime.example/wasm-j/',
			code: 'input =: 1!:1 [ 1',
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid J streaming stdin channel.' }]);
	});
});
