// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computePrologRuntimeFingerprint } from '../../../scripts/sync-wasm-prolog.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_PROLOG_ASSET_VERSION, WASM_PROLOG_RUNNER_RECEIPT } from './wasmPrologVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-prolog-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-prolog/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-prolog/', import.meta.url);
const fixtureBaseUrl = 'https://runtime.example/wasm-prolog/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixturePackage = {
	integrity:
		'sha512-tP3bSRaMboFRWGD5cfBAGIzu2HH80yqRG+i/YL8BEgQ7xasvJAycwgx0DW16vqqRhUHyFOOPbzX4aXuy9s+b1g==',
	name: 'swipl-wasm',
	repository: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git',
	revision: '18fa003833dd4fb2531195063291687255038372',
	tarball: 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz',
	version: '8.0.1'
};
const fixtureToolchain = {
	emsdkRevision: 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de',
	emsdkVersion: '6.0.0',
	pcre2Revision: 'f454e231fe5006dd7ff8f4693fd2b8eb94333429',
	pcre2Version: '10.47',
	swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
	swiplVersion: '10.1.9',
	zlibVersion: '1.3.2'
};
const fixtureLicense = {
	path: 'LICENSE.txt',
	spdx: 'BSD-2-Clause',
	size: 32,
	sha256: 'a'.repeat(64)
};
const fixtureMetadata = {
	path: 'runtime-build.json',
	mediaType: 'application/json',
	size: 64,
	sha256: 'b'.repeat(64)
};
const fixtureLogicalBytes = {
	'swipl-web.data': Buffer.from('fixture SWI-Prolog data\n', 'utf8'),
	'swipl-web.js': Buffer.from('var SWIPL=()=>{}; // fixture\n', 'utf8'),
	'swipl-web.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes = {
	'swipl-web.data': 'application/octet-stream',
	'swipl-web.js': 'text/javascript',
	'swipl-web.wasm': 'application/wasm'
};
const fixtureStorageBytes = {
	'swipl-web.data.gz': gzipSync(fixtureLogicalBytes['swipl-web.data'], { level: 9 }),
	'swipl-web.js': fixtureLogicalBytes['swipl-web.js'],
	'swipl-web.wasm.gz': gzipSync(fixtureLogicalBytes['swipl-web.wasm'], { level: 9 })
};
const fixtureStorageMetadata = {
	'swipl-web.data.gz': { logicalPath: 'swipl-web.data', encoding: 'gzip' as const },
	'swipl-web.js': { logicalPath: 'swipl-web.js', encoding: 'identity' as const },
	'swipl-web.wasm.gz': { logicalPath: 'swipl-web.wasm', encoding: 'gzip' as const }
};
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path as keyof typeof fixtureMediaTypes],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorage = Object.entries(fixtureStorageBytes).map(([path, bytes]) => ({
	path,
	...fixtureStorageMetadata[path as keyof typeof fixtureStorageMetadata],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureProfileId = 'swipl-wasm-8.0.1-swipl-10.1.9';
const fixtureFingerprint = computePrologRuntimeFingerprint({
	profileId: fixtureProfileId,
	package: fixturePackage,
	toolchain: fixtureToolchain,
	license: fixtureLicense,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	format: 'wasm-prolog-runtime-manifest-v2',
	runtime: 'swipl-wasm',
	profileId: fixtureProfileId,
	fingerprint: fixtureFingerprint,
	package: fixturePackage,
	toolchain: fixtureToolchain,
	license: fixtureLicense,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
};
const overflowDataBytes = Buffer.concat([fixtureLogicalBytes['swipl-web.data'], Buffer.of(0)]);
const overflowStorageBytes = gzipSync(overflowDataBytes, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'swipl-web.data.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computePrologRuntimeFingerprint({
	profileId: fixtureProfileId,
	package: fixturePackage,
	toolchain: fixtureToolchain,
	license: fixtureLicense,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: overflowStorage
});
const overflowManifest = {
	...fixtureManifest,
	fingerprint: overflowFingerprint,
	storage: overflowStorage
};

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createIntegrityHarnessWorker() {
	const workerSource = await readWorkerSource();
	const encodedStorage = Object.fromEntries(
		Object.entries(fixtureStorageBytes).map(([path, bytes]) => [path, bytes.toString('base64')])
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
  const url = 'blob:wasm-prolog-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(
		Object.fromEntries(
			Object.entries(fixtureLogicalBytes).map(([path, bytes]) => [
				path,
				bytes.toString('base64')
			])
		)
  )}).map(([path, base64]) => [path, Buffer.from(base64, 'base64')])
);
const storageBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedStorage)}).map(([path, base64]) => [path, Buffer.from(base64, 'base64')])
);
const storageLogicalPaths = ${JSON.stringify(
		Object.fromEntries(
			Object.entries(fixtureStorageMetadata).map(([path, metadata]) => [
				path,
				metadata.logicalPath
			])
		)
	)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
globalThis.importScripts = (url) => {
  parentPort.postMessage({ harnessImported: url });
  globalThis.SWIPL = async (options) => {
    const wasmPath = options.locateFile('swipl-web.wasm');
    const dataPath = options.locateFile('swipl-web.data');
    let undeclaredRejected = false;
    try { options.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
    const data = Buffer.from(options.getPreloadedPackage(dataPath, logicalBytes['swipl-web.data'].byteLength));
    parentPort.postMessage({
      harnessInjected: {
        wasmPath,
        dataPath,
        undeclaredRejected,
        wasmSha256: await webcrypto.subtle.digest('SHA-256', options.wasmBinary).then(
          (value) => Buffer.from(value).toString('hex')
        ),
        dataSha256: await webcrypto.subtle.digest('SHA-256', data).then(
          (value) => Buffer.from(value).toString('hex')
        )
      }
    });
    return {
      FS: {
        analyzePath: () => ({ exists: true }),
        mkdir: () => {},
        writeFile: () => {}
      },
      prolog: {
        query: () => ({
          once: () => {
            options.print('prompt>');
            const input = [];
            while (true) {
              const value = options.stdin();
              if (value === null) break;
              input.push(value);
            }
            options.print('received=' + Buffer.from(input).toString('utf8').trim());
            return true;
          },
          close: () => {}
        })
      }
    };
  };
};
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const pathname = new URL(requestedUrl).pathname;
  const isManifest = pathname.endsWith('/runtime-manifest.v2.json');
  const storageName = Object.keys(storageBytes).find((name) => pathname.endsWith('/' + name));
  parentPort.postMessage({
    harnessFetch: requestedUrl,
    harnessFetchOptions: {
      cache: init.cache,
      credentials: init.credentials,
      redirect: init.redirect,
      referrerPolicy: init.referrerPolicy
    }
  });
  const manifest = JSON.parse(JSON.stringify(
    harnessMode === 'gzip-overflow' ? overflowManifestTemplate : manifestTemplate
  ));
  if (harnessMode === 'manifest-fingerprint') manifest.fingerprint = '0'.repeat(64);
  if (harnessMode === 'unknown-asset') {
    manifest.assets.push({
      path: 'unexpected.bin', mediaType: 'application/octet-stream', size: 1, sha256: 'c'.repeat(64)
    });
  }
  if (harnessMode === 'duplicate-asset') manifest.assets[2] = { ...manifest.assets[0] };
  if (harnessMode === 'missing-storage') manifest.storage.pop();
  if (harnessMode === 'package-metadata') manifest.package.revision = '0'.repeat(40);
  if (harnessMode === 'license-receipt') manifest.license.sha256 = 'd'.repeat(64);
  if (harnessMode === 'metadata-receipt') manifest.metadata.sha256 = 'e'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[0].sha256 = 'f'.repeat(64);
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'swipl-web.data.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'swipl-web.wasm.gz';
  const transportDecoded =
    storageName?.endsWith('.gz') &&
    (harnessMode === 'transport-decoded' || harnessMode === 'corrupt-decoded');
  if (transportDecoded) bytes = Buffer.from(logicalBytes[storageLogicalPaths[storageName]]);
  if (harnessMode === 'corrupt-storage' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'corrupt-decoded' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/swipl-web.wasm.gz',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (harnessMode === 'reader-failure' && targetedStorage) {
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
  if ((harnessMode === 'truncated-storage' || harnessMode === 'overflow-storage') && targetedStorage) {
    const streamedBytes = harnessMode === 'truncated-storage'
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
    targetedStorage &&
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
  const responseHeaders = {
    'content-length': String(
      transportDecoded ? storageBytes[storageName].byteLength : bytes.byteLength
    )
  };
  if (transportDecoded) responseHeaders['content-encoding'] = 'gzip';
  const response = new Response(bytes, {
    status: 200,
    headers: responseHeaders
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

async function runHarness(request: Record<string, unknown>, onMessage?: (message: any) => void) {
	const worker = await createIntegrityHarnessWorker();
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
				if (code !== 0) reject(new Error(`SWI-Prolog harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runHarnessSequence(requests: Record<string, unknown>[]) {
	const worker = await createIntegrityHarnessWorker();
	const messages: any[] = [];
	const terminals: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			let requestIndex = 0;
			worker.on('message', (message) => {
				messages.push(message);
				if (message?.results === undefined && message?.error === undefined) return;
				terminals.push(message);
				requestIndex += 1;
				if (requestIndex === requests.length) {
					resolve();
					return;
				}
				worker.postMessage(requests[requestIndex]);
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`SWI-Prolog harness exited with code ${code}`));
			});
			worker.postMessage(requests[0]);
		});
		return { messages, terminals };
	} finally {
		await worker.terminate();
	}
}

function integrityRequest(overrides: Record<string, unknown> = {}) {
	return {
		baseUrl: fixtureBaseUrl,
		manifestUrl: fixtureManifestUrl,
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: 'main :- true.',
		stdin: '68\n',
		...overrides
	};
}

describe('SWI-Prolog runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_PROLOG_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_PROLOG_RUNNER_RECEIPT.sha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v2.json',
			'swipl-web.data.gz',
			'swipl-web.js',
			'swipl-web.wasm.gz'
		]);

		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-prolog-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const runtimeBuild = JSON.parse(
			await readFile(new URL('runtime-build.json', staticRuntimeUrl), 'utf8')
		);
		expect(manifest.profileId).toBe(inputLock.profileId);
		expect(manifest.package).toEqual(inputLock.package);
		expect(manifest.toolchain).toEqual(inputLock.toolchain);
		expect(runtimeBuild.package).toEqual(inputLock.package);
		expect(runtimeBuild.toolchain).toEqual(inputLock.toolchain);
		expect(manifest.fingerprint).toBe(WASM_PROLOG_ASSET_VERSION);
		expect(computePrologRuntimeFingerprint(manifest)).toBe(WASM_PROLOG_ASSET_VERSION);

		for (const receipt of [manifest.license, manifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(sha256(bytes)).toBe(receipt.sha256);
		}
		const sourceLicense = await readFile(
			new URL('../../../node_modules/swipl-wasm/LICENSE.txt', import.meta.url)
		);
		expect(inputLock.license).toMatchObject({
			bytes: sourceLicense.byteLength,
			sha256: sha256(sourceLicense)
		});
		for (const storageReceipt of manifest.storage) {
			const stored = await readFile(new URL(storageReceipt.path, staticRuntimeUrl));
			expect(stored.byteLength).toBe(storageReceipt.size);
			expect(sha256(stored)).toBe(storageReceipt.sha256);
			const logical = storageReceipt.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const logicalReceipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storageReceipt.logicalPath
			);
			expect(logical.byteLength).toBe(logicalReceipt.size);
			expect(sha256(logical)).toBe(logicalReceipt.sha256);
			expect(inputLock.assets).toContainEqual(
				expect.objectContaining({
					path: logicalReceipt.path,
					bytes: logicalReceipt.size,
					sha256: logicalReceipt.sha256
				})
			);
		}
	});

	it('loads only declared storage and injects verified Wasm and data into Blob-evaluated glue', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('received=68');
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(4);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-prolog/runtime-manifest.v2.json',
			'/wasm-prolog/swipl-web.data.gz',
			'/wasm-prolog/swipl-web.js',
			'/wasm-prolog/swipl-web.wasm.gz'
		]);
		for (const message of fetches) {
			expect(message.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessImported: expect.stringMatching(/^blob:wasm-prolog-/u)
			})
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobRevoked: expect.stringMatching(/^blob:wasm-prolog-/u)
			})
		);
		expect(messages).toContainEqual({
			harnessInjected: {
				wasmPath: 'wasm-idle-verified:swipl-web.wasm',
				dataPath: 'wasm-idle-verified:swipl-web.data',
				undeclaredRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['swipl-web.wasm']),
				dataSha256: sha256(fixtureLogicalBytes['swipl-web.data'])
			}
		});
	});

	it('accepts browser-transparent gzip decoding only after the logical receipt matches', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'transport-decoded' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessImported: expect.stringMatching(/^blob:wasm-prolog-/u)
			})
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessInjected: expect.objectContaining({
					wasmSha256: sha256(fixtureLogicalBytes['swipl-web.wasm']),
					dataSha256: sha256(fixtureLogicalBytes['swipl-web.data'])
				})
			})
		);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['invalid-manifest-json', 'not valid UTF-8 JSON'],
		['unknown-asset', 'exactly three logical assets'],
		['duplicate-asset', 'unexpected or duplicate logical asset'],
		['missing-storage', 'exactly three storage assets'],
		['package-metadata', 'package metadata is invalid'],
		['license-receipt', 'receipt graph failed fingerprint verification'],
		['metadata-receipt', 'receipt graph failed fingerprint verification'],
		['storage-receipt', 'receipt graph failed fingerprint verification'],
		['corrupt-storage', 'failed SHA-256 verification'],
		['corrupt-decoded', 'failed SHA-256 verification']
	])('rejects %s before evaluating the runtime glue', async (harnessMode, error) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it.each([
		['redirect-storage', 'response URL does not match', 'response'],
		['reader-failure', 'fixture reader failure', 'response'],
		['wrong-content-length', 'Content-Length does not match', 'response'],
		['invalid-content-length', 'invalid Content-Length', 'response'],
		['truncated-storage', 'is truncated', undefined],
		['overflow-storage', 'exceeds its receipt size', 'reader']
	])('rejects %s with bounded stream cleanup', async (harnessMode, error, cancellation) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		if (cancellation) expect(messages).toContainEqual({ harnessCancelled: cancellation });
		if (cancellation === 'reader') {
			expect(messages).toContainEqual({ harnessReleased: true, harnessWasCancelled: true });
		}
	});

	it('rejects gzip expansion beyond the logical receipt before evaluating the runtime', async () => {
		const messages = await runHarness(
			integrityRequest({
				harnessMode: 'gzip-overflow',
				manifestFingerprint: overflowFingerprint
			})
		);

		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('gzip exceeds its logical receipt size')
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('clears a failed verification generation so the same worker can retry cleanly', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ harnessMode: 'corrupt-storage' }),
			integrityRequest()
		]);

		expect(terminals).toEqual([
			{ error: expect.stringContaining('failed SHA-256 verification') },
			{ results: true }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
	});

	it('refuses to replace a verified runtime profile in a warm worker', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest(),
			integrityRequest({ baseUrl: 'https://runtime.example/other-prolog/' })
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'SWI-Prolog worker cannot replace an initialized runtime profile.' }
		]);
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(4);
	});

	it('prints a prompt before consuming live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			integrityRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
			(message) => {
				if (message?.output?.includes('prompt>') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('안녕\n');
						stdin.close();
					}, 10);
				}
			}
		);

		expect(messages.findIndex((message) => message?.output?.includes('prompt>'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('received=안녕'))
		);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor after verification', async () => {
		const messages = await runHarness(
			integrityRequest({
				stdin: undefined,
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					buffer: new SharedArrayBuffer(32),
					capacity: 16,
					controlBytes: 8
				}
			})
		);

		expect(messages.at(-1)).toEqual({ error: 'Invalid SWI-Prolog streaming stdin channel.' });
	});
});
