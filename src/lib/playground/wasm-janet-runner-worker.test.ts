// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeJanetRuntimeFingerprint } from '../../../scripts/sync-wasm-janet.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_JANET_ASSET_VERSION, WASM_JANET_RUNNER_RECEIPT } from './wasmJanetVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-janet-runner-worker.js',
	import.meta.url
);
const runnerSourceUrl = new URL(
	'../../../scripts/runtime-build/wasm-janet-runner.c',
	import.meta.url
);
const lockUrl = new URL('../../../scripts/wasm-janet-assets.lock.json', import.meta.url);
const staticWorkerUrl = new URL('../../../static/wasm-janet/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-janet/', import.meta.url);
const deployedManifest = JSON.parse(
	await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
);
const fixtureBaseUrl = 'https://runtime.example/wasm-janet/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureLogicalBytes: Record<string, Buffer> = {
	'janet.js': Buffer.from('export default function Module() {}\n', 'utf8'),
	'janet.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes: Record<string, string> = {
	'janet.js': 'text/javascript',
	'janet.wasm': 'application/wasm'
};
const fixtureStorageBytes: Record<string, Buffer> = {
	'janet.js': fixtureLogicalBytes['janet.js'],
	'janet.wasm.gz': gzipSync(fixtureLogicalBytes['janet.wasm'], { level: 9 })
};
const fixtureStorageMetadata: Record<
	string,
	{ logicalPath: string; encoding: 'identity' | 'gzip' }
> = {
	'janet.js': { logicalPath: 'janet.js', encoding: 'identity' },
	'janet.wasm.gz': { logicalPath: 'janet.wasm', encoding: 'gzip' }
};
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorage = Object.entries(fixtureStorageBytes).map(([path, bytes]) => ({
	path,
	...fixtureStorageMetadata[path],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureFingerprint = computeJanetRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	build: deployedManifest.build,
	license: deployedManifest.license,
	metadata: deployedManifest.metadata,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	...deployedManifest,
	fingerprint: fixtureFingerprint,
	assets: fixtureAssets,
	storage: fixtureStorage
};
const overflowWasmBytes = Buffer.concat([fixtureLogicalBytes['janet.wasm'], Buffer.of(0)]);
const overflowStorageBytes = gzipSync(overflowWasmBytes, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'janet.wasm.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computeJanetRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	build: deployedManifest.build,
	license: deployedManifest.license,
	metadata: deployedManifest.metadata,
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

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const importSeam = 'return await import(moduleUrl);';
	if (!workerSource.includes(importSeam)) {
		throw new Error('Janet verified module import seam was not found.');
	}
	const harnessWorkerSource = workerSource.replace(
		importSeam,
		'return { default: globalThis.__createJanetModule };'
	);
	const encodedLogical = Object.fromEntries(
		Object.entries(fixtureLogicalBytes).map(([assetPath, bytes]) => [
			assetPath,
			bytes.toString('base64')
		])
	);
	const encodedStorage = Object.fromEntries(
		Object.entries(fixtureStorageBytes).map(([assetPath, bytes]) => [
			assetPath,
			bytes.toString('base64')
		])
	);
	const storageLogicalPaths = Object.fromEntries(
		Object.entries(fixtureStorageMetadata).map(([assetPath, metadata]) => [
			assetPath,
			metadata.logicalPath
		])
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
  const url = 'blob:wasm-janet-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedLogical)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const storageBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedStorage)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const storageLogicalPaths = ${JSON.stringify(storageLogicalPaths)};
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
globalThis.__createJanetModule = async (options) => {
  const wasmPath = options.locateFile('janet.wasm');
  let undeclaredRejected = false;
  try { options.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
  parentPort.postMessage({
    harnessInjected: {
      wasmPath,
      undeclaredRejected,
      wasmSha256: await webcrypto.subtle.digest('SHA-256', options.wasmBinary).then(
        (value) => Buffer.from(value).toString('hex')
      )
    }
  });
  let readStdin;
  let writeStdout;
  const module = {
    FS: {
      init(stdin, stdout) {
        readStdin = stdin;
        writeStdout = stdout;
      },
      writeFile() {}
    }
  };
  for (const prepare of options.preRun) prepare(module);
  module.callMain = () => {
    for (const value of Buffer.from('value?\\n')) writeStdout(value);
    const input = [];
    while (true) {
      const value = readStdin();
      if (value === null) break;
      input.push(value);
    }
    for (const value of Buffer.from('main=' + Buffer.from(input).toString('utf8').trim() + '\\n')) {
      writeStdout(value);
    }
    return 0;
  };
  return module;
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
  if (harnessMode === 'unexpected-manifest-field') manifest.unexpected = true;
  if (harnessMode === 'unknown-asset') {
    manifest.assets.push({
      path: 'unexpected.bin', mediaType: 'application/octet-stream', size: 1, sha256: 'c'.repeat(64)
    });
  }
  if (harnessMode === 'duplicate-asset') manifest.assets[1] = { ...manifest.assets[0] };
  if (harnessMode === 'missing-storage') manifest.storage.pop();
  if (harnessMode === 'component-metadata') manifest.components.janet.revision = '0'.repeat(40);
  if (harnessMode === 'build-metadata') manifest.build.options = [];
  if (harnessMode === 'license-receipt') manifest.license.sha256 = 'd'.repeat(64);
  if (harnessMode === 'metadata-receipt') manifest.metadata.sha256 = 'e'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[0].sha256 = 'f'.repeat(64);
  if (harnessMode === 'unexpected-license-field') manifest.license.unexpected = true;
  if (harnessMode === 'unexpected-metadata-field') manifest.metadata.unexpected = true;
  if (harnessMode === 'unexpected-asset-field') manifest.assets[0].unexpected = true;
  if (harnessMode === 'unexpected-storage-field') manifest.storage[0].unexpected = true;
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'janet.wasm.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'janet.wasm.gz';
  const transportDecoded = targetedStorage &&
    (harnessMode === 'transport-decoded' || harnessMode === 'corrupt-decoded');
  if (transportDecoded) bytes = Buffer.from(logicalBytes[storageLogicalPaths[storageName]]);
  if (harnessMode === 'corrupt-storage' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'corrupt-decoded' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/janet.wasm.gz',
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
        'content-length': harnessMode === 'invalid-content-length' ? '1e2' : String(bytes.byteLength + 1)
      }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  const response = new Response(bytes, {
    status: 200,
    headers: {
      'content-length': String(
        transportDecoded ? storageBytes[storageName].byteLength : bytes.byteLength
      )
    }
  });
  Object.defineProperty(response, 'url', { value: requestedUrl });
  return response;
};
(0, eval)(${JSON.stringify(harnessWorkerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
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
				if (code !== 0) reject(new Error(`Janet harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runHarnessSequence(requests: Record<string, unknown>[]) {
	const worker = await createHarnessWorker();
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
				if (code !== 0) reject(new Error(`Janet harness exited with code ${code}`));
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
		maxAssetBytes: 8 * 1024 * 1024,
		code: '(getline)',
		stdin: '68\n',
		...overrides
	};
}

describe('Janet runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_JANET_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_JANET_RUNNER_RECEIPT.sha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'janet.js',
			'janet.wasm.gz',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(deployedManifest.fingerprint).toBe(WASM_JANET_ASSET_VERSION);
		expect(computeJanetRuntimeFingerprint(deployedManifest)).toBe(WASM_JANET_ASSET_VERSION);
		for (const storage of deployedManifest.storage) {
			const stored = await readFile(new URL(storage.path, staticRuntimeUrl));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const logical = storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
		}
		for (const receipt of [deployedManifest.license, deployedManifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(sha256(bytes)).toBe(receipt.sha256);
		}
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		const runner = await readFile(runnerSourceUrl);
		expect(runner.byteLength).toBe(lock.build.runner.bytes);
		expect(sha256(runner)).toBe(lock.build.runner.sha256);
		for (const receipt of lock.assets) {
			const deployed = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === receipt.path
			);
			expect(deployed).toMatchObject({ size: receipt.bytes, sha256: receipt.sha256 });
		}
	});

	it('loads only declared storage and injects verified Wasm into Blob-evaluated glue', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=68');
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(3);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-janet/runtime-manifest.v2.json',
			'/wasm-janet/janet.js',
			'/wasm-janet/janet.wasm.gz'
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
				harnessBlobCreated: expect.stringMatching(/^blob:wasm-janet-/u)
			})
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobRevoked: expect.stringMatching(/^blob:wasm-janet-/u)
			})
		);
		expect(messages).toContainEqual({
			harnessInjected: {
				wasmPath: 'wasm-idle-verified:janet.wasm',
				undeclaredRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['janet.wasm'])
			}
		});
	});

	it('accepts browser-transparent gzip decoding only after the logical receipt matches', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'transport-decoded' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(true);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['invalid-manifest-json', 'not valid UTF-8 JSON'],
		['unknown-asset', 'exactly two logical assets'],
		['duplicate-asset', 'unexpected or duplicate logical asset'],
		['missing-storage', 'exactly two storage assets'],
		['component-metadata', 'component metadata is invalid'],
		['build-metadata', 'build metadata is invalid'],
		['license-receipt', 'receipt graph failed fingerprint verification'],
		['metadata-receipt', 'receipt graph failed fingerprint verification'],
		['storage-receipt', 'receipt graph failed fingerprint verification'],
		['corrupt-storage', 'failed SHA-256 verification'],
		['corrupt-decoded', 'failed SHA-256 verification']
	])('rejects %s before evaluating the runtime glue', async (harnessMode, error) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it.each([
		['unexpected-manifest-field', 'manifest schema is invalid'],
		['unexpected-license-field', 'license receipt is invalid'],
		['unexpected-metadata-field', 'metadata receipt is invalid'],
		['unexpected-asset-field', 'asset janet.js receipt is invalid'],
		['unexpected-storage-field', 'storage receipt is invalid']
	])('rejects unpinned schema extension %s', async (harnessMode, error) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
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
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
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
		expect(messages.filter((message) => message.harnessBlobCreated)).toHaveLength(1);
	});

	it('refuses to replace a verified runtime profile in a warm worker', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest(),
			integrityRequest({ baseUrl: 'https://runtime.example/other-janet/' })
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'Janet worker cannot replace an initialized runtime profile.' }
		]);
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(3);
	});

	it('prints a prompt before reading live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			integrityRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
			(message) => {
				if (message?.output?.includes('value?') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('73\n');
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

		expect(messages.at(-1)).toEqual({ error: 'Invalid Janet streaming stdin channel.' });
	});
});
