// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_CLOJURESCRIPT_ASSET_VERSION } from './wasmClojureScriptVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-clojurescript-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL(
	'../../../static/wasm-clojurescript/runner-worker.js',
	import.meta.url
);
const staticRuntimeUrl = new URL('../../../static/wasm-clojurescript/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.wasm_idle = { runner: {
  execute: (source, _filename, context, callback) => {
    context.onStdout('value?\\n');
    const input = source === 'read-all' ? context.stdin : context.stdinLines.shift();
    context.onStdout('main=' + input + '\\n');
    callback({ ok: true, stdout: 'value?\\nmain=' + input + '\\n', stderr: '' });
  }
} };
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
				if (code !== 0) reject(new Error(`ClojureScript harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function readLogicalAsset(fileName: string) {
	try {
		return await readFile(new URL(fileName, staticRuntimeUrl));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return gunzipSync(await readFile(new URL(`${fileName}.gz`, staticRuntimeUrl)));
	}
}

async function runStreamingHarness(code: string, stdinText: string) {
	const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
	let suppliedInput = false;
	const messages = await runHarness({ code, stdinChannel: stdin.descriptor }, (message) => {
		if (message?.output?.includes('value?') && !suppliedInput) {
			suppliedInput = true;
			setTimeout(() => {
				stdin.enqueue(stdinText);
				stdin.close();
			}, 10);
		}
	});
	return messages;
}

describe('ClojureScript runner worker', () => {
	it('keeps the compiler callback contract, synced worker, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const compilerSource = String(await readLogicalAsset('compiler.js'));
		expect(compilerSource.includes('onStdout')).toBe(true);
		expect(compilerSource.includes('onStderr')).toBe(true);
		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		const hash = createHash('sha256');
		for (const fileName of [...manifest.files].sort()) {
			hash.update(fileName);
			hash.update('\0');
			hash.update(await readLogicalAsset(fileName));
			hash.update('\n');
		}
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION);
	});

	it('streams a prompt before read-line consumes a UTF-8 CRLF line', async () => {
		const messages = await runStreamingHarness('read-line', '안녕\r\n');

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=안녕'))
		);
		expect(messages.filter((message) => message?.output?.includes('main=안녕'))).toHaveLength(
			1
		);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('streams the complete stdin value through the blocking getter', async () => {
		const messages = await runStreamingHarness('read-all', 'first\nsecond\n');
		expect(
			messages.filter((message) => message?.output?.includes('main=first\nsecond'))
		).toHaveLength(1);
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

		expect(messages).toEqual([{ error: 'Invalid ClojureScript streaming stdin channel.' }]);
	});
});
