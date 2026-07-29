// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_PERL_ASSET_VERSION } from './wasmPerlVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-perl-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-perl/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-perl/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.importScripts = () => globalThis.Module.onRuntimeInitialized();
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  const originalImportScripts = self.importScripts;
  self.importScripts = (...args) => {
    globalThis.Module.FS_createPath = () => {};
    globalThis.Module.FS_createDataFile = () => {};
    globalThis.Module.callMain = () => {
      globalThis.Module.print('value?');
      const input = [];
      while (true) {
        const value = globalThis.Module.stdin();
        if (value === null) break;
        input.push(value);
      }
      const parsed = Number(Buffer.from(input).toString('utf8').trim());
      globalThis.Module.print('main=' + (parsed + 5));
      return 0;
    };
    originalImportScripts(...args);
  };
  self.onmessage({ data });
});
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
				if (code !== 0) reject(new Error(`WebPerl harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('WebPerl runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const hash = createHash('sha256');
		for (const fileName of [
			'emperl.data',
			'emperl.js',
			'emperl.wasm',
			'runner-worker.js'
		].sort()) {
			hash.update(fileName);
			hash.update('\0');
			const compressed = fileName !== 'runner-worker.js';
			const stored = await readFile(
				new URL(compressed ? `${fileName}.gz` : fileName, staticRuntimeUrl)
			);
			hash.update(compressed ? gunzipSync(stored) : stored);
			hash.update('\n');
		}
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_PERL_ASSET_VERSION);
		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(manifest.fingerprint).toBe(WASM_PERL_ASSET_VERSION);
	});

	it('prints a prompt before reading live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			{
				baseUrl: 'https://runtime.example/wasm-perl/',
				code: 'my $line = <STDIN>;',
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
			baseUrl: 'https://runtime.example/wasm-perl/',
			code: 'my $line = <STDIN>;',
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid WebPerl streaming stdin channel.' }]);
	});
});
