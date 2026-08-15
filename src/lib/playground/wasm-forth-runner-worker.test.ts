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
globalThis.fetch = () => {
  parentPort.postMessage({ harnessFetch: true });
  throw new Error('WAForth worker must not fetch runtime assets');
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  const request = {
    ...data,
    runtimePreflight: data.runtimePreflight
      ? { ...data.runtimePreflight }
      : data.runtimePreflight
  };
  if (data.harnessMode === 'missing-preflight') request.runtimePreflight = undefined;
  if (data.harnessMode === 'unexpected-key') request.runtimePreflight.unexpected = true;
  if (data.harnessMode === 'corrupt-runtime') {
    const bytes = Buffer.from(request.runtimePreflight.runtimeBytes);
    bytes[bytes.length - 1] ^= 1;
    request.runtimePreflight.runtimeBytes = bytes;
  }
  if (
    data.harnessMode === 'manifest-fingerprint' ||
    data.harnessMode === 'oversized-receipt' ||
    data.harnessMode === 'profile-mismatch'
  ) {
    const manifest = JSON.parse(JSON.stringify(manifestTemplate));
    if (data.harnessMode === 'manifest-fingerprint') manifest.fingerprint = '0'.repeat(64);
    if (data.harnessMode === 'oversized-receipt') manifest.assets[0].size = 2_000_000;
    if (data.harnessMode === 'profile-mismatch') {
      manifest.profileId = 'waforth-other';
      manifest.waforthVersion = 'other';
    }
    request.runtimePreflight.manifestBytes = Buffer.from(JSON.stringify(manifest));
  }
  self.onmessage({ data: request });
});
`;
	return new NodeWorker(harness, { eval: true });
}

function runtimeRequest(overrides: Record<string, unknown> = {}) {
	return {
		baseUrl: fixtureBaseUrl,
		manifestFingerprint: fixtureFingerprint,
		runtimePreflight: {
			protocol: 'wasm-idle-forth-preflight',
			protocolVersion: 1,
			profileId: fixtureProfileId,
			implementationVersion: fixtureVersion,
			manifestFingerprint: fixtureFingerprint,
			manifestBytes: Buffer.from(JSON.stringify(fixtureManifest)),
			runtimeBytes: Buffer.from(runtimeBytes)
		},
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
	it('streams a prompt from host-preflighted bytes before reading shared-ring input', async () => {
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
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages).toContainEqual({ harnessEvaluated: true });
	});

	it('fails malformed stdin before evaluating host-preflighted assets', async () => {
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

	it.each([
		['missing-preflight', 'requires a valid host-preflighted asset payload'],
		['unexpected-key', 'requires a valid host-preflighted asset payload'],
		['manifest-fingerprint', 'manifest fingerprint does not match the pinned runtime'],
		['oversized-receipt', 'receipt is invalid or exceeds its byte limit'],
		['profile-mismatch', 'manifest profile is invalid or does not match preflight']
	])('rejects %s payloads before runtime evaluation', async (harnessMode, message) => {
		const messages = await runHarness([runtimeRequest({ harnessMode })]);

		expect(messages.some((entry) => entry.harnessEvaluated)).toBe(false);
		expect(messages.some((entry) => entry.harnessFetch)).toBe(false);
		expect(messages.at(-1)?.error).toContain(message);
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
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
	});

	it('enforces the active byte limit on preflighted runtime bytes', async () => {
		const messages = await runHarness([
			runtimeRequest({ maxAssetBytes: runtimeBytes.byteLength - 1 })
		]);

		expect(messages.some((entry) => entry.harnessEvaluated)).toBe(false);
		expect(messages.at(-1)?.error).toContain('exceed their active byte limits');
	});
});
