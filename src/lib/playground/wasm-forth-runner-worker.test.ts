// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-forth-runner-worker.js',
	import.meta.url
);
const fixtureBaseUrl = 'https://runtime.example/wasm-forth/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureProfileId = 'waforth-test';
const fixtureVersion = 'test';
const fingerprintDomain = 'wasm-idle:forth-runtime-manifest:v2';
const manifestFormat = 'wasm-forth-runtime-manifest-v2';
const runtimeSource = `
class FakeWAForth {
  async load() {}
  interpret() {
    for (const value of new TextEncoder().encode('value?\\n')) this.onEmit(value);
    const input = [];
    while (true) {
      const value = this.key();
      if (value === -1) break;
      input.push(value);
    }
    const parsed = Number(new TextDecoder().decode(Uint8Array.from(input)).trim());
    for (const value of new TextEncoder().encode('main=' + (parsed + 5) + '\\n')) this.onEmit(value);
    return 0;
  }
}
FakeWAForth.isSuccess = () => true;
self.WAForthPackage = FakeWAForth;
`;
const runtimeBytes = Buffer.from(runtimeSource, 'utf8');
const runtimeReceipt = {
	path: 'waforth.js',
	size: runtimeBytes.byteLength,
	sha256: createHash('sha256').update(runtimeBytes).digest('hex')
};
const fixtureFingerprint = createHash('sha256')
	.update(`${fingerprintDomain}\n`)
	.update(`format\0${manifestFormat}\n`)
	.update(`profileId\0${fixtureProfileId}\n`)
	.update(`waforthVersion\0${fixtureVersion}\n`)
	.update(`${runtimeReceipt.path}\0${runtimeReceipt.size}\0${runtimeReceipt.sha256}\n`)
	.digest('hex');
const fixtureManifest = {
	format: manifestFormat,
	runtime: 'waforth',
	profileId: fixtureProfileId,
	waforthVersion: fixtureVersion,
	fingerprint: fixtureFingerprint,
	assets: [runtimeReceipt]
};

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
const runtimeBytes = Buffer.from(${JSON.stringify(runtimeBytes.toString('base64'))}, 'base64');
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
let harnessMode = '';
let blobCounter = 0;
const blobSources = new Map();
globalThis.Blob = class HarnessBlob {
  constructor(parts) {
    this.source = parts.map((part) =>
      typeof part === 'string' ? part : Buffer.from(part).toString('utf8')
    ).join('');
  }
};
URL.createObjectURL = (blob) => {
  const url = 'blob:wasm-forth-fixture-' + ++blobCounter;
  blobSources.set(url, blob.source);
  return url;
};
URL.revokeObjectURL = (url) => {
  blobSources.delete(url);
  parentPort.postMessage({ harnessRevoked: url });
};
globalThis.importScripts = (url) => {
  const source = blobSources.get(url);
  if (source === undefined) throw new Error('Unknown fixture Blob URL');
  parentPort.postMessage({ harnessEvaluated: true });
  (0, eval)(source);
};
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const isManifest = requestedUrl.includes('runtime-manifest.v2.json');
  parentPort.postMessage({
    harnessFetch: requestedUrl,
    harnessFetchOptions: {
      cache: init.cache,
      credentials: init.credentials,
      redirect: init.redirect,
      referrerPolicy: init.referrerPolicy
    }
  });
  const manifest = JSON.parse(JSON.stringify(manifestTemplate));
  if (harnessMode === 'manifest-fingerprint') manifest.fingerprint = '0'.repeat(64);
  if (harnessMode === 'oversized-receipt') manifest.assets[0].size = 2_000_000;
  let bytes = isManifest ? Buffer.from(JSON.stringify(manifest)) : Buffer.from(runtimeBytes);
  if (!isManifest && harnessMode === 'corrupt-runtime') {
    bytes = Buffer.from(bytes);
    bytes[bytes.length - 1] ^= 1;
  }
  if (!isManifest && harnessMode === 'redirect-runtime') {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/waforth.js',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: {
        cancel() {
          parentPort.postMessage({ harnessCancelled: true });
        }
      }
    };
  }
  if (!isManifest && harnessMode === 'reader-failure') {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: {
        getReader() {
          throw new Error('fixture reader failure');
        },
        cancel() {
          parentPort.postMessage({ harnessCancelled: true });
        }
      }
    };
  }
  if (!isManifest && (harnessMode === 'truncated-runtime' || harnessMode === 'overflow-runtime')) {
    const streamedBytes = harnessMode === 'truncated-runtime'
      ? bytes.subarray(0, bytes.byteLength - 1)
      : Buffer.concat([bytes, Buffer.of(0)]);
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(streamedBytes);
          controller.close();
        },
        cancel() {
          parentPort.postMessage({ harnessCancelled: true });
        }
      })
    };
  }
  const contentLength =
    !isManifest && harnessMode === 'wrong-content-length'
      ? bytes.byteLength + 1
      : bytes.byteLength;
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(contentLength) }
  });
  Object.defineProperty(response, 'url', { value: requestedUrl });
  return response;
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  self.onmessage({ data });
});
`;
	return new NodeWorker(harness, { eval: true });
}

function runtimeRequest(overrides: Record<string, unknown> = {}) {
	return {
		baseUrl: fixtureBaseUrl,
		manifestUrl: fixtureManifestUrl,
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: 'KEY',
		stdin: '68\n',
		...overrides
	};
}

async function runHarness(
	requests: Array<Record<string, unknown>>,
	onMessage?: (message: any) => void
) {
	const worker = await createHarnessWorker();
	const messages: any[] = [];
	let requestIndex = 0;
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
				if (message?.results === undefined && message?.error === undefined) return;
				requestIndex += 1;
				if (requestIndex >= requests.length) {
					resolve();
					return;
				}
				worker.postMessage(requests[requestIndex]);
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`WAForth harness exited with code ${code}`));
			});
			worker.postMessage(requests[0]);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('WAForth runner worker', () => {
	it('streams a prompt before reading verified shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		let transcript = '';
		const messages = await runHarness(
			[runtimeRequest({ stdin: undefined, stdinChannel: stdin.descriptor })],
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
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(2);
		expect(messages).toContainEqual({ harnessEvaluated: true });
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessFetchOptions: expect.objectContaining({
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer'
				})
			})
		);
	});

	it('fails malformed stdin before any runtime fetch', async () => {
		const messages = await runHarness([
			runtimeRequest({
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					buffer: new SharedArrayBuffer(32),
					capacity: 16,
					controlBytes: 8
				}
			})
		]);

		expect(messages).toEqual([{ error: 'Invalid WAForth streaming stdin channel.' }]);
	});

	it('rejects a mismatched manifest fingerprint before fetching or evaluating the runtime', async () => {
		const messages = await runHarness([
			runtimeRequest({ harnessMode: 'manifest-fingerprint' })
		]);

		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(1);
		expect(messages.some((message) => message.harnessEvaluated)).toBe(false);
		expect(messages.at(-1)?.error).toContain(
			'manifest fingerprint does not match the pinned runtime'
		);
	});

	it('rejects a receipt over the active limit before fetching the runtime asset', async () => {
		const messages = await runHarness([runtimeRequest({ harnessMode: 'oversized-receipt' })]);

		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(1);
		expect(messages.some((message) => message.harnessEvaluated)).toBe(false);
		expect(messages.at(-1)?.error).toContain('receipt is invalid or exceeds its byte limit');
	});

	it('blocks same-length corruption and retries cleanly without cache poisoning', async () => {
		const messages = await runHarness([
			runtimeRequest({ harnessMode: 'corrupt-runtime' }),
			runtimeRequest()
		]);
		const terminal = messages.filter(
			(message) => message?.results !== undefined || message?.error !== undefined
		);

		expect(terminal[0]?.error).toContain('failed SHA-256 verification');
		expect(terminal[1]).toEqual({ results: true });
		expect(messages.filter((message) => message.harnessEvaluated)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(4);
	});

	it('rejects substituted final URLs and cancels the rejected body', async () => {
		const messages = await runHarness([runtimeRequest({ harnessMode: 'redirect-runtime' })]);

		expect(messages.some((message) => message.harnessEvaluated)).toBe(false);
		expect(messages).toContainEqual({ harnessCancelled: true });
		expect(messages.at(-1)?.error).toContain('response URL does not match the requested asset');
	});

	it('rejects a declared runtime size that differs from its receipt', async () => {
		const messages = await runHarness([
			runtimeRequest({ harnessMode: 'wrong-content-length' })
		]);

		expect(messages.some((message) => message.harnessEvaluated)).toBe(false);
		expect(messages.at(-1)?.error).toContain('Content-Length does not match its receipt');
	});

	it.each([
		['truncated-runtime', 'is truncated'],
		['overflow-runtime', 'exceeds its receipt size']
	])('enforces the receipt size while streaming in %s mode', async (harnessMode, message) => {
		const messages = await runHarness([runtimeRequest({ harnessMode })]);

		expect(messages.some((entry) => entry.harnessEvaluated)).toBe(false);
		expect(messages.at(-1)?.error).toContain(message);
	});

	it('cancels the response if its byte stream cannot be acquired', async () => {
		const messages = await runHarness([runtimeRequest({ harnessMode: 'reader-failure' })]);

		expect(messages.some((message) => message.harnessEvaluated)).toBe(false);
		expect(messages).toContainEqual({ harnessCancelled: true });
		expect(messages.at(-1)?.error).toContain('fixture reader failure');
	});
});
