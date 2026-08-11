// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeJRuntimeFingerprint } from '../../../scripts/sync-wasm-j.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_J_ASSET_VERSION, WASM_J_RUNNER_RECEIPT } from './wasmJVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-j-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-j/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-j/', import.meta.url);
const fixtureBaseUrl = 'https://runtime.example/wasm-j/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const moduleBytes = Buffer.from('export default function fixtureJModule() {}\n', 'utf8');
const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const compressedWasmBytes = gzipSync(wasmBytes, { level: 9 });
const fixtureSource = {
	repository: 'https://github.com/jsoftware/j-playground',
	path: 'bin/html2',
	revision: 'fixture'
};
const fixtureAssets = [
	{
		path: 'jamalgam.js',
		mediaType: 'text/javascript',
		size: moduleBytes.byteLength,
		sha256: createHash('sha256').update(moduleBytes).digest('hex')
	},
	{
		path: 'jamalgam.wasm',
		mediaType: 'application/wasm',
		size: wasmBytes.byteLength,
		sha256: createHash('sha256').update(wasmBytes).digest('hex')
	}
];
const fixtureStorage = [
	{
		path: 'jamalgam.js',
		logicalPath: 'jamalgam.js',
		encoding: 'identity' as const,
		size: moduleBytes.byteLength,
		sha256: createHash('sha256').update(moduleBytes).digest('hex')
	},
	{
		path: 'jamalgam.wasm.gz',
		logicalPath: 'jamalgam.wasm',
		encoding: 'gzip' as const,
		size: compressedWasmBytes.byteLength,
		sha256: createHash('sha256').update(compressedWasmBytes).digest('hex')
	}
];
const fixtureProfileId = 'jsoftware-j-playground-test';
const fixtureFingerprint = computeJRuntimeFingerprint({
	profileId: fixtureProfileId,
	source: fixtureSource,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	format: 'wasm-j-runtime-manifest-v2',
	runtime: 'jsoftware-j-playground',
	profileId: fixtureProfileId,
	fingerprint: fixtureFingerprint,
	source: fixtureSource,
	assets: fixtureAssets,
	storage: fixtureStorage
};

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const importStatement = 'return await import(moduleUrl);';
	if (!workerSource.includes(importStatement)) {
		throw new Error('J verified module import seam was not found.');
	}
	const harnessSource = workerSource.replace(
		importStatement,
		'return { default: globalThis.__createJModule };'
	);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
let harnessMode = '';
let blobCounter = 0;
URL.createObjectURL = () => {
  const url = 'blob:wasm-j-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const moduleBytes = Buffer.from(${JSON.stringify(moduleBytes.toString('base64'))}, 'base64');
const wasmBytes = Buffer.from(${JSON.stringify(wasmBytes.toString('base64'))}, 'base64');
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
globalThis.__createJModule = async (options) => {
  parentPort.postMessage({ harnessModuleWasmBytes: options.wasmBinary.byteLength });
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
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const pathname = new URL(requestedUrl).pathname;
  const isManifest = pathname.endsWith('/runtime-manifest.v2.json');
  const isModule = pathname.endsWith('/jamalgam.js');
  const isWasm = pathname.endsWith('/jamalgam.wasm');
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
  if (harnessMode === 'unknown-asset') {
    manifest.assets.push({
      path: 'unexpected.js', mediaType: 'text/javascript', size: 1, sha256: 'a'.repeat(64)
    });
  }
  if (harnessMode === 'duplicate-asset') manifest.assets[1] = { ...manifest.assets[0] };
  if (harnessMode === 'oversized-receipt') manifest.assets[0].size = 2_000_000;
  let bytes = isManifest
    ? Buffer.from(JSON.stringify(manifest))
    : isModule
      ? Buffer.from(moduleBytes)
      : isWasm
        ? Buffer.from(wasmBytes)
        : Buffer.alloc(0);
  if (harnessMode === 'corrupt-module' && isModule) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'corrupt-wasm' && isWasm) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-module' && isModule) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/jamalgam.js',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (harnessMode === 'reader-failure' && isModule) {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: {
        getReader() { throw new Error('fixture reader failure'); },
        cancel: () => parentPort.postMessage({ harnessCancelled: 'response' })
      }
    };
  }
  if ((harnessMode === 'truncated-module' || harnessMode === 'overflow-module') && isModule) {
    const streamedBytes = harnessMode === 'truncated-module'
      ? bytes.subarray(0, bytes.byteLength - 1)
      : Buffer.concat([bytes, Buffer.of(0)]);
    let cancelled = false;
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: streamedBytes };
            },
            cancel() {
              cancelled = true;
              parentPort.postMessage({ harnessCancelled: 'reader' });
            },
            releaseLock() {
              parentPort.postMessage({ harnessReleased: true, harnessWasCancelled: cancelled });
            }
          };
        }
      }
    };
  }
  if (
    isModule &&
    (harnessMode === 'wrong-content-length' || harnessMode === 'invalid-content-length')
  ) {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers({
        'content-length':
          harnessMode === 'invalid-content-length' ? '1e2' : String(bytes.byteLength + 1)
      }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  const contentLength =
    bytes.byteLength;
  const response = new Response(bytes, {
    status: 200,
    headers: {
	  'content-length': String(contentLength)
    }
  });
  Object.defineProperty(response, 'url', { value: requestedUrl });
  return response;
};
(0, eval)(${JSON.stringify(harnessSource)});
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
		code: "smoutput 'ok'",
		stdin: '',
		...overrides
	};
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
	it('keeps the input lock, deployed receipts, runner pin, and fingerprints current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_J_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_J_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'jamalgam.js',
			'jamalgam.wasm.gz',
			'runner-worker.js',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-j-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const logicalBytes = {
			'jamalgam.js': await readFile(new URL('jamalgam.js', staticRuntimeUrl)),
			'jamalgam.wasm': gunzipSync(
				await readFile(new URL('jamalgam.wasm.gz', staticRuntimeUrl))
			)
		};
		for (const receipt of manifest.assets) {
			const bytes = logicalBytes[receipt.path as keyof typeof logicalBytes];
			expect(bytes.byteLength).toBe(receipt.size);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
			const locked = inputLock.assets.find(
				(candidate: any) => candidate.path === receipt.path
			);
			expect(locked).toMatchObject({ bytes: receipt.size, sha256: receipt.sha256 });
		}
		for (const receipt of manifest.storage) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
		}
		expect(manifest.profileId).toBe(inputLock.profileId);
		expect(manifest.source).toEqual(inputLock.source);
		expect(computeJRuntimeFingerprint(manifest)).toBe(WASM_J_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_J_ASSET_VERSION);
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.fingerprint).toBe(WASM_J_ASSET_VERSION.slice(0, 16));
	});

	it('verifies the manifest, module, and Wasm before streaming stdin', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			runtimeRequest({
				code: "smoutput 'value?'\ninput =: 1!:1 [ 1\nsmoutput 'main='",
				stdin: undefined,
				stdinChannel: stdin.descriptor
			}),
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

		const output = messages.map((message) => message.output || '').join('');
		expect(output.indexOf('value?')).toBeLessThan(output.indexOf('main=73'));
		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(3);
		expect(messages).toContainEqual({ harnessModuleWasmBytes: wasmBytes.byteLength });
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessBlobCreated: expect.stringMatching(/^blob:wasm-j-/u) })
		);
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessBlobRevoked: expect.stringMatching(/^blob:wasm-j-/u) })
		);
		for (const message of messages.filter((candidate) => candidate.harnessFetch)) {
			expect(message.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
	});

	it('fails malformed streaming stdin before any asset fetch', async () => {
		const messages = await runHarness(
			runtimeRequest({
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					buffer: new SharedArrayBuffer(32),
					capacity: 16,
					controlBytes: 8
				}
			})
		);

		expect(messages).toEqual([{ error: 'Invalid J streaming stdin channel.' }]);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['unknown-asset', 'exactly two logical assets'],
		['duplicate-asset', 'receipt jamalgam.wasm is invalid'],
		['oversized-receipt', 'invalid or exceeds its byte limit'],
		['corrupt-module', 'jamalgam.js failed SHA-256 verification'],
		['corrupt-wasm', 'jamalgam.wasm failed SHA-256 verification']
	])('rejects %s before evaluating a runtime module', async (harnessMode, error) => {
		const messages = await runHarness(runtimeRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it.each([
		['redirect-module', 'response URL does not match', 'response'],
		['reader-failure', 'fixture reader failure', 'response'],
		['wrong-content-length', 'Content-Length does not match', 'response'],
		['invalid-content-length', 'invalid Content-Length', 'response'],
		['truncated-module', 'is truncated', undefined],
		['overflow-module', 'exceeds its receipt size', 'reader']
	])('rejects %s with bounded cleanup', async (harnessMode, error, expectedCancellation) => {
		const messages = await runHarness(runtimeRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		if (expectedCancellation) {
			expect(messages).toContainEqual({ harnessCancelled: expectedCancellation });
		}
		if (expectedCancellation === 'reader') {
			expect(messages).toContainEqual({ harnessReleased: true, harnessWasCancelled: true });
		}
	});
});
