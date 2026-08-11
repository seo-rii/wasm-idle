// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeBqnRuntimeFingerprint } from '../../../scripts/sync-wasm-bqn.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_BQN_ASSET_VERSION, WASM_BQN_RUNNER_RECEIPT } from './wasmBqnVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-bqn-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-bqn/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-bqn/', import.meta.url);
const fixtureBaseUrl = 'https://runtime.example/wasm-bqn/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const moduleBytes = Buffer.from('export default function fixtureBqnModule() {}\n', 'utf8');
const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const compressedWasmBytes = gzipSync(wasmBytes, { level: 9 });
const licenseBytes = Buffer.from('GNU GENERAL PUBLIC LICENSE Version 3 fixture\n', 'utf8');
const fixtureSource = {
	repository: 'https://github.com/dzaima/CBQN',
	path: 'dist',
	revision: 'fixture'
};
const fixtureBuild = {
	emscripten: '3.1.8',
	options: ['ENVIRONMENT=worker', 'MODULARIZE=1', 'EXPORT_ES6=1', 'FORCE_FILESYSTEM=1']
};
const fixtureLicense = {
	path: 'LICENSE-GPLv3.txt',
	spdx: 'GPL-3.0-or-later',
	size: licenseBytes.byteLength,
	sha256: createHash('sha256').update(licenseBytes).digest('hex')
};
const fixtureAssets = [
	{
		path: 'BQN.js',
		mediaType: 'text/javascript',
		size: moduleBytes.byteLength,
		sha256: createHash('sha256').update(moduleBytes).digest('hex')
	},
	{
		path: 'BQN.wasm',
		mediaType: 'application/wasm',
		size: wasmBytes.byteLength,
		sha256: createHash('sha256').update(wasmBytes).digest('hex')
	}
];
const fixtureStorage = [
	{
		path: 'BQN.js',
		logicalPath: 'BQN.js',
		encoding: 'identity' as const,
		size: moduleBytes.byteLength,
		sha256: createHash('sha256').update(moduleBytes).digest('hex')
	},
	{
		path: 'BQN.wasm.gz',
		logicalPath: 'BQN.wasm',
		encoding: 'gzip' as const,
		size: compressedWasmBytes.byteLength,
		sha256: createHash('sha256').update(compressedWasmBytes).digest('hex')
	}
];
const fixtureProfileId = 'dzaima-cbqn-test';
const fixtureFingerprint = computeBqnRuntimeFingerprint({
	profileId: fixtureProfileId,
	source: fixtureSource,
	build: fixtureBuild,
	license: fixtureLicense,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	format: 'wasm-bqn-runtime-manifest-v2',
	runtime: 'dzaima-cbqn',
	profileId: fixtureProfileId,
	fingerprint: fixtureFingerprint,
	source: fixtureSource,
	build: fixtureBuild,
	license: fixtureLicense,
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
		throw new Error('CBQN verified module import seam was not found.');
	}
	const harnessSource = workerSource.replace(
		importStatement,
		'return { default: globalThis.__createBqnModule };'
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
  const url = 'blob:wasm-bqn-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const moduleBytes = Buffer.from(${JSON.stringify(moduleBytes.toString('base64'))}, 'base64');
const wasmBytes = Buffer.from(${JSON.stringify(wasmBytes.toString('base64'))}, 'base64');
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
globalThis.__createBqnModule = async (options) => ({
  cwrap: () => () => {
    parentPort.postMessage({ harnessModuleWasmBytes: options.wasmBinary.byteLength });
    options.print('value?');
    const input = [];
    while (true) {
      const value = options.stdin();
      if (value === null) break;
      input.push(value);
    }
    const parsed = Number(Buffer.from(input).toString('utf8').trim());
    options.print(String(parsed + 5));
  }
});
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const pathname = new URL(requestedUrl).pathname;
  const isManifest = pathname.endsWith('/runtime-manifest.v2.json');
  const isModule = pathname.endsWith('/BQN.js');
  const isWasm = pathname.endsWith('/BQN.wasm');
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
  if (harnessMode === 'license-receipt') manifest.license.sha256 = 'b'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[1].sha256 = 'c'.repeat(64);
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
      url: 'https://untrusted.example/BQN.js',
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
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) }
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
		code: '5 + •ParseFloat •GetLine @',
		stdin: '68\n',
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
				if (code !== 0) reject(new Error(`CBQN harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('CBQN runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprints current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_BQN_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_BQN_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'BQN.js',
			'BQN.wasm.gz',
			'LICENSE-GPLv3.txt',
			'runner-worker.js',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-bqn-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const logicalBytes = {
			'BQN.js': await readFile(new URL('BQN.js', staticRuntimeUrl)),
			'BQN.wasm': gunzipSync(await readFile(new URL('BQN.wasm.gz', staticRuntimeUrl)))
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
		const deployedLicense = await readFile(new URL(manifest.license.path, staticRuntimeUrl));
		expect(deployedLicense.byteLength).toBe(manifest.license.size);
		expect(createHash('sha256').update(deployedLicense).digest('hex')).toBe(
			manifest.license.sha256
		);
		expect(inputLock.license).toMatchObject({
			bytes: manifest.license.size,
			sha256: manifest.license.sha256
		});
		expect(manifest.profileId).toBe(inputLock.profileId);
		expect(manifest.source).toEqual(inputLock.source);
		expect(manifest.build).toEqual(inputLock.build);
		expect(computeBqnRuntimeFingerprint(manifest)).toBe(WASM_BQN_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_BQN_ASSET_VERSION);
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.fingerprint).toBe(WASM_BQN_ASSET_VERSION.slice(0, 16));
		expect(await readFile(new URL('BQN.wasm.gz', staticRuntimeUrl))).toEqual(
			gzipSync(logicalBytes['BQN.wasm'], { level: 9 })
		);
	});

	it('verifies the manifest, module, and Wasm before streaming stdin', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			runtimeRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
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
		expect(output.indexOf('value?')).toBeLessThan(output.indexOf('73'));
		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(3);
		expect(messages).toContainEqual({ harnessModuleWasmBytes: wasmBytes.byteLength });
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobCreated: expect.stringMatching(/^blob:wasm-bqn-/u)
			})
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobRevoked: expect.stringMatching(/^blob:wasm-bqn-/u)
			})
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

		expect(messages).toEqual([{ error: 'Invalid CBQN streaming stdin channel.' }]);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['unknown-asset', 'exactly two logical assets'],
		['duplicate-asset', 'receipt BQN.wasm is invalid'],
		['oversized-receipt', 'invalid or exceeds its byte limit'],
		['license-receipt', 'receipt graph failed fingerprint verification'],
		['storage-receipt', 'receipt graph failed fingerprint verification'],
		['corrupt-module', 'BQN.js failed SHA-256 verification'],
		['corrupt-wasm', 'BQN.wasm failed SHA-256 verification']
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
