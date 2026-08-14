// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeJuliaRuntimeFingerprint } from '../../../scripts/sync-wasm-julia.mjs';
import { WASM_JULIA_ASSET_VERSION, WASM_JULIA_RUNNER_RECEIPT } from './wasmJuliaVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-julia-runner-worker.js',
	import.meta.url
);
const lockUrl = new URL('../../../scripts/wasm-julia-assets.lock.json', import.meta.url);
const staticWorkerUrl = new URL('../../../static/wasm-julia/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-julia/', import.meta.url);
const deployedManifest = JSON.parse(
	await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
);
const fixtureBaseUrl = 'https://runtime.example/wasm-julia/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureLogicalBytes: Record<string, Buffer> = {
	'julia.js': Buffer.from('globalThis.__verifiedJuliaGlue = true;\n'),
	'julia.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
	'julia.data': Buffer.from('verified Julia data\n')
};
const fixtureMediaTypes: Record<string, string> = {
	'julia.js': 'text/javascript',
	'julia.wasm': 'application/wasm',
	'julia.data': 'application/octet-stream'
};
const fixtureStorageBytes = Object.fromEntries(
	Object.entries(fixtureLogicalBytes).map(([assetPath, bytes]) => [
		`${assetPath}.gz`,
		gzipSync(bytes, { level: 9 })
	])
) as Record<string, Buffer>;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorage = Object.entries(fixtureStorageBytes).map(([path, bytes]) => ({
	path,
	logicalPath: path.slice(0, -3),
	encoding: 'gzip' as const,
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureFingerprint = computeJuliaRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	license: deployedManifest.license,
	documentation: deployedManifest.documentation,
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
const overflowLogicalWasm = Buffer.concat([fixtureLogicalBytes['julia.wasm'], Buffer.of(0)]);
const overflowStorageBytes = gzipSync(overflowLogicalWasm, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'julia.wasm.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computeJuliaRuntimeFingerprint({
	profileId: deployedManifest.profileId,
	licenseExpression: deployedManifest.licenseExpression,
	artifact: deployedManifest.artifact,
	components: deployedManifest.components,
	license: deployedManifest.license,
	documentation: deployedManifest.documentation,
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
	const encodedStorage = Object.fromEntries(
		Object.entries(fixtureStorageBytes).map(([assetPath, bytes]) => [
			assetPath,
			bytes.toString('base64')
		])
	);
	const encodedLogical = Object.fromEntries(
		Object.entries(fixtureLogicalBytes).map(([assetPath, bytes]) => [
			assetPath,
			bytes.toString('base64')
		])
	);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { createHash, webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
let harnessMode = '';
let blobCounter = 0;
let lastBlob = null;
URL.createObjectURL = (blob) => {
  lastBlob = blob;
  const url = 'blob:wasm-julia-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url, harnessBlobBytes: blob.size, harnessBlobType: blob.type });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedLogical)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const storageBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedStorage)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
globalThis.importScripts = (scriptUrl) => {
  if (!String(scriptUrl).startsWith('blob:wasm-julia-fixture-') || !lastBlob) {
    throw new Error('fixture received an unverified script URL');
  }
  const module = globalThis.Module;
  const wasmPath = module.locateFile('julia-wasm/julia.wasm');
  const dataPath = module.locateFile('https://cdn.jsdelivr.net');
  let undeclaredRejected = false;
  try { module.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
  const data = module.getPreloadedPackage(dataPath, logicalBytes['julia.data'].byteLength);
  parentPort.postMessage({
    harnessInjected: {
      wasmPath,
      dataPath,
      undeclaredRejected,
      wasmSha256: createHash('sha256').update(module.wasmBinary).digest('hex'),
      dataSha256: createHash('sha256').update(Buffer.from(data)).digest('hex')
    }
  });
  module.HEAPU8 = new Uint8Array(64 * 1024);
  module._malloc = () => 0;
  module._free = () => {};
  module._jl_initialize = () => {};
  module._jl_exception_occurred = () => 0;
  module._jl_eval_string = (pointer) => {
    let end = pointer;
    while (module.HEAPU8[end] !== 0) end += 1;
    const source = new TextDecoder().decode(module.HEAPU8.subarray(pointer, end));
    parentPort.postMessage({ harnessRunnerSource: source });
    for (const value of Buffer.from('main=68\\n')) module.stdout(value);
  };
  module.onRuntimeInitialized();
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
  if (harnessMode === 'component-metadata') manifest.components.julia.revision = '0'.repeat(40);
  if (harnessMode === 'unknown-asset') manifest.assets[0].path = 'unexpected.bin';
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'julia.wasm.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'julia.wasm.gz';
  const transportDecoded = targetedStorage && harnessMode === 'transport-decoded';
  if (transportDecoded) bytes = Buffer.from(logicalBytes['julia.wasm']);
  if (harnessMode === 'corrupt-storage' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/julia.wasm.gz',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (harnessMode === 'wrong-content-length' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers({ 'content-length': String(bytes.byteLength + 1) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if ((harnessMode === 'truncated-storage' || harnessMode === 'overflow-storage') && targetedStorage) {
    const streamed = harnessMode === 'truncated-storage'
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
              return { done: false, value: streamed };
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
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) }
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

type HarnessMessage = Record<string, unknown>;

async function runHarness(request: Record<string, unknown>) {
	const worker = await createHarnessWorker();
	const messages: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				if (message.results !== undefined || message.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`Julia harness exited with code ${code}`));
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
	const messages: HarnessMessage[] = [];
	const terminals: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			let requestIndex = 0;
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				if (message.results === undefined && message.error === undefined) return;
				terminals.push(message);
				requestIndex += 1;
				if (requestIndex === requests.length) resolve();
				else worker.postMessage(requests[requestIndex]);
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`Julia harness exited with code ${code}`));
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
		maxAssetBytes: 1024 * 1024,
		code: 'println(readline())',
		stdin: '68\n',
		activePath: 'main.jl',
		...overrides
	};
}

describe('Julia runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_JULIA_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_JULIA_RUNNER_RECEIPT.sha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.md',
			'julia.data.gz',
			'julia.js.gz',
			'julia.wasm.gz',
			'readme.md',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(deployedManifest.fingerprint).toBe(WASM_JULIA_ASSET_VERSION);
		expect(computeJuliaRuntimeFingerprint(deployedManifest)).toBe(WASM_JULIA_ASSET_VERSION);
		for (const storage of deployedManifest.storage) {
			const stored = await readFile(new URL(storage.path, staticRuntimeUrl));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const logical = gunzipSync(stored);
			const receipt = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
		}
		for (const receipt of [
			deployedManifest.license,
			deployedManifest.documentation,
			deployedManifest.metadata
		]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(sha256(bytes)).toBe(receipt.sha256);
		}
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		for (const receipt of lock.assets) {
			expect(
				deployedManifest.assets.find(
					(candidate: { path: string }) => candidate.path === receipt.path
				)
			).toMatchObject({ size: receipt.bytes, sha256: receipt.sha256 });
		}
	});

	it('loads only declared storage and injects verified Wasm/data into Blob-evaluated glue', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => String(message.output || '')).join('')).toContain(
			'main=68'
		);
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(4);
		expect(fetches.map((message) => new URL(String(message.harnessFetch)).pathname)).toEqual([
			'/wasm-julia/runtime-manifest.v2.json',
			'/wasm-julia/julia.data.gz',
			'/wasm-julia/julia.js.gz',
			'/wasm-julia/julia.wasm.gz'
		]);
		for (const fetchMessage of fetches) {
			expect(fetchMessage.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(fetches[0].harnessFetchOptions).toMatchObject({ cache: 'no-store' });
		expect(messages.find((message) => message.harnessInjected)?.harnessInjected).toEqual({
			wasmPath: 'wasm-idle-verified:julia.wasm',
			dataPath: 'wasm-idle-verified:julia.data',
			undeclaredRejected: true,
			wasmSha256: sha256(fixtureLogicalBytes['julia.wasm']),
			dataSha256: sha256(fixtureLogicalBytes['julia.data'])
		});
		expect(messages.find((message) => message.harnessBlobCreated)).toMatchObject({
			harnessBlobBytes: fixtureLogicalBytes['julia.js'].byteLength,
			harnessBlobType: 'text/javascript'
		});
		expect(messages.some((message) => message.harnessBlobRevoked)).toBe(true);
		expect(
			String(messages.find((message) => message.harnessRunnerSource)?.harnessRunnerSource)
		).toContain('Base.include_string(Main, "println(readline())", "main.jl")');
	});

	it('accepts a transparently decoded gzip response only when logical receipt matches', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'transport-decoded' }));
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it.each([
		['manifest-fingerprint', 'fingerprint'],
		['unexpected-manifest-field', 'schema'],
		['component-metadata', 'component'],
		['unknown-asset', 'unexpected or duplicate'],
		['corrupt-storage', 'SHA-256'],
		['redirect-storage', 'does not match'],
		['wrong-content-length', 'Content-Length'],
		['truncated-storage', 'truncated'],
		['overflow-storage', 'exceeds its receipt size'],
		['gzip-overflow', 'exceeds its logical receipt size']
	])('fails closed for %s', async (harnessMode, expectedMessage) => {
		const request = integrityRequest({ harnessMode });
		if (harnessMode === 'gzip-overflow') {
			request.manifestFingerprint = overflowFingerprint;
		}
		const messages = await runHarness(request);
		expect(String(messages.at(-1)?.error)).toContain(expectedMessage);
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it('clears failed verification state so a later request can retry', async () => {
		const { terminals } = await runHarnessSequence([
			integrityRequest({ harnessMode: 'corrupt-storage' }),
			integrityRequest()
		]);
		expect(String(terminals[0].error)).toContain('SHA-256');
		expect(terminals[1]).toEqual({ results: true });
	});

	it('rejects profile replacement and a second runtime evaluation in a warm worker', async () => {
		const { terminals } = await runHarnessSequence([
			integrityRequest(),
			integrityRequest({ manifestUrl: `${fixtureBaseUrl}alternate.json` }),
			integrityRequest()
		]);
		expect(terminals[0]).toEqual({ results: true });
		expect(String(terminals[1].error)).toContain(
			'cannot replace an initialized runtime profile'
		);
		expect(String(terminals[2].error)).toContain(
			'cannot execute more than one runtime instance'
		);
	});

	it('fails malformed streaming stdin before requesting runtime assets', async () => {
		const messages = await runHarness({
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});
		expect(messages).toEqual([{ error: 'Invalid Julia streaming stdin channel.' }]);
	});
});
