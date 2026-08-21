// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computePerlRuntimeFingerprint } from '../../../scripts/sync-wasm-perl.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_PERL_ASSET_VERSION, WASM_PERL_RUNNER_RECEIPT } from './wasmPerlVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-perl-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-perl/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-perl/', import.meta.url);
const deployedManifest = JSON.parse(
	await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
);
const fixtureBaseUrl = 'https://runtime.example/wasm-perl/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureLogicalBytes = {
	'emperl.data': Buffer.from('fixture WebPerl data\n', 'utf8'),
	'emperl.js': Buffer.from('/* fixture WebPerl glue */\n', 'utf8'),
	'emperl.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes = {
	'emperl.data': 'application/octet-stream',
	'emperl.js': 'text/javascript',
	'emperl.wasm': 'application/wasm'
};
const fixtureStorageBytes = {
	'emperl.data.gz': gzipSync(fixtureLogicalBytes['emperl.data'], { level: 9 }),
	'emperl.js.gz': gzipSync(fixtureLogicalBytes['emperl.js'], { level: 9 }),
	'emperl.wasm.gz': gzipSync(fixtureLogicalBytes['emperl.wasm'], { level: 9 })
};
const fixtureStorageMetadata = {
	'emperl.data.gz': { logicalPath: 'emperl.data', encoding: 'gzip' as const },
	'emperl.js.gz': { logicalPath: 'emperl.js', encoding: 'gzip' as const },
	'emperl.wasm.gz': { logicalPath: 'emperl.wasm', encoding: 'gzip' as const }
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
const fixtureFingerprint = computePerlRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	licenses: deployedManifest.licenses,
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
const overflowDataBytes = Buffer.concat([fixtureLogicalBytes['emperl.data'], Buffer.of(0)]);
const overflowStorageBytes = gzipSync(overflowDataBytes, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'emperl.data.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computePerlRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	licenses: deployedManifest.licenses,
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
	const encodedLogical = Object.fromEntries(
		Object.entries(fixtureLogicalBytes).map(([path, bytes]) => [path, bytes.toString('base64')])
	);
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
  const url = 'blob:wasm-perl-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedLogical)}).map(([path, base64]) => [path, Buffer.from(base64, 'base64')])
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
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
globalThis.importScripts = async (url) => {
  parentPort.postMessage({ harnessImported: url });
  const wasmPath = globalThis.Module.locateFile('emperl.wasm');
  const dataPath = globalThis.Module.locateFile('emperl.data');
  let undeclaredRejected = false;
  try { globalThis.Module.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
  const data = Buffer.from(
    globalThis.Module.getPreloadedPackage(dataPath, logicalBytes['emperl.data'].byteLength)
  );
  parentPort.postMessage({
    harnessInjected: {
      wasmPath,
      dataPath,
      undeclaredRejected,
      wasmSha256: await webcrypto.subtle.digest('SHA-256', globalThis.Module.wasmBinary).then(
        (value) => Buffer.from(value).toString('hex')
      ),
      dataSha256: await webcrypto.subtle.digest('SHA-256', data).then(
        (value) => Buffer.from(value).toString('hex')
      )
    }
  });
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
    globalThis.Module.print('main=' + Buffer.from(input).toString('utf8').trim());
    return 0;
  };
  globalThis.Module.onRuntimeInitialized();
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
  if (harnessMode === 'duplicate-asset') manifest.assets[2] = { ...manifest.assets[0] };
  if (harnessMode === 'missing-storage') manifest.storage.pop();
  if (harnessMode === 'component-metadata') manifest.components.perl.revision = '0'.repeat(40);
  if (harnessMode === 'license-receipt') manifest.licenses[0].sha256 = 'd'.repeat(64);
  if (harnessMode === 'metadata-receipt') manifest.metadata.sha256 = 'e'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[0].sha256 = 'f'.repeat(64);
  if (harnessMode === 'unexpected-license-field') manifest.licenses[0].unexpected = true;
  if (harnessMode === 'unexpected-metadata-field') manifest.metadata.unexpected = true;
  if (harnessMode === 'unexpected-asset-field') manifest.assets[0].unexpected = true;
  if (harnessMode === 'unexpected-storage-field') manifest.storage[0].unexpected = true;
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'emperl.data.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'emperl.wasm.gz';
  const transportDecoded = storageName?.endsWith('.gz') &&
    (harnessMode === 'transport-decoded' || harnessMode === 'corrupt-decoded');
  if (transportDecoded) bytes = Buffer.from(logicalBytes[storageLogicalPaths[storageName]]);
  if (harnessMode === 'corrupt-storage' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'corrupt-decoded' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/emperl.wasm.gz',
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
(0, eval)(${JSON.stringify(workerSource)});
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
				if (code !== 0) reject(new Error(`WebPerl harness exited with code ${code}`));
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
				if (code !== 0) reject(new Error(`WebPerl harness exited with code ${code}`));
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
		maxAssetBytes: 32 * 1024 * 1024,
		code: 'my $line = <STDIN>;',
		stdin: '68\n',
		...overrides
	};
}

describe('WebPerl runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_PERL_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_PERL_RUNNER_RECEIPT.sha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'emperl.data.gz',
			'emperl.js.gz',
			'emperl.wasm.gz',
			'licenses',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

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
			const logicalReceipt = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === fileName
			);
			const storedReceipt = deployedManifest.storage.find(
				(candidate: { logicalPath: string }) => candidate.logicalPath === fileName
			);
			expect(Boolean(logicalReceipt)).toBe(compressed);
			expect(Boolean(storedReceipt)).toBe(compressed);
			const bytes = compressed
				? gunzipSync(await readFile(new URL(storedReceipt.path, staticRuntimeUrl)))
				: await readFile(staticWorkerUrl);
			if (logicalReceipt) {
				expect(bytes.byteLength).toBe(logicalReceipt.size);
				expect(sha256(bytes)).toBe(logicalReceipt.sha256);
			}
			hash.update(bytes);
			hash.update('\n');
		}
		expect(hash.digest('hex')).toMatch(/^[a-f0-9]{64}$/u);
		expect(deployedManifest.fingerprint).toBe(WASM_PERL_ASSET_VERSION);
		expect(computePerlRuntimeFingerprint(deployedManifest)).toBe(WASM_PERL_ASSET_VERSION);
		for (const receipt of [...deployedManifest.licenses, deployedManifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(sha256(bytes)).toBe(receipt.sha256);
		}
	});

	it('loads only declared storage and injects verified Wasm and data into Blob-evaluated glue', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=68');
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(4);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-perl/runtime-manifest.v2.json',
			'/wasm-perl/emperl.data.gz',
			'/wasm-perl/emperl.js.gz',
			'/wasm-perl/emperl.wasm.gz'
		]);
		for (const message of fetches) {
			expect(message.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessImported: expect.stringMatching(/^blob:wasm-perl-/u) })
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobRevoked: expect.stringMatching(/^blob:wasm-perl-/u)
			})
		);
		expect(messages).toContainEqual({
			harnessInjected: {
				wasmPath: 'wasm-idle-verified:emperl.wasm',
				dataPath: 'wasm-idle-verified:emperl.data',
				undeclaredRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['emperl.wasm']),
				dataSha256: sha256(fixtureLogicalBytes['emperl.data'])
			}
		});
	});

	it('accepts browser-transparent gzip decoding only after the logical receipt matches', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'transport-decoded' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessImported: expect.stringMatching(/^blob:wasm-perl-/u) })
		);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['invalid-manifest-json', 'not valid UTF-8 JSON'],
		['unknown-asset', 'exactly three logical assets'],
		['duplicate-asset', 'unexpected or duplicate logical asset'],
		['missing-storage', 'exactly three storage assets'],
		['component-metadata', 'component metadata is invalid'],
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
		['unexpected-manifest-field', 'manifest schema is invalid'],
		['unexpected-license-field', 'license receipt is invalid'],
		['unexpected-metadata-field', 'metadata receipt is invalid'],
		['unexpected-asset-field', 'asset emperl.data receipt is invalid'],
		['unexpected-storage-field', 'storage receipt is invalid']
	])('rejects unpinned schema extension %s', async (harnessMode, error) => {
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
			integrityRequest({ baseUrl: 'https://runtime.example/other-perl/' })
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'WebPerl worker cannot replace an initialized runtime profile.' }
		]);
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(4);
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
	}, 15_000);

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

		expect(messages.at(-1)).toEqual({ error: 'Invalid WebPerl streaming stdin channel.' });
	});
});
