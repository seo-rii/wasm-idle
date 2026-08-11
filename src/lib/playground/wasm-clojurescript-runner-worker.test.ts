// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeClojureScriptRuntimeFingerprint } from '../../../scripts/sync-wasm-clojurescript.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_CLOJURESCRIPT_ASSET_VERSION,
	WASM_CLOJURESCRIPT_RUNNER_RECEIPT
} from './wasmClojureScriptVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-clojurescript-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL(
	'../../../static/wasm-clojurescript/runner-worker.js',
	import.meta.url
);
const staticRuntimeUrl = new URL('../../../static/wasm-clojurescript/', import.meta.url);
const fixtureBaseUrl = 'https://runtime.example/wasm-clojurescript/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureCompilerBytes = Buffer.from(
	'globalThis.wasm_idle = { runner: { execute() {} } }; // fixture\n',
	'utf8'
);
const fixtureCompressedCompilerBytes = gzipSync(fixtureCompilerBytes, { level: 9 });
const fixtureSource = {
	repository: 'https://github.com/clojure/clojurescript',
	revision: 'r1.12.134',
	integrationRepository: 'https://github.com/seo-rii/wasm-idle',
	integrationRevision: 'f'.repeat(40)
};
const fixtureBuild = {
	clojureScriptVersion: '1.12.134',
	clojureToolsVersion: '1.12.4.1618',
	jdkVersion: '21.0.11+10',
	jdkArchiveSha256: '4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de',
	clojureToolsArchiveSha256: '13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21',
	target: 'webworker',
	optimizations: 'simple'
};
const fixtureLicense = {
	path: 'LICENSE.txt',
	spdx: 'EPL-1.0',
	size: 32,
	sha256: 'a'.repeat(64)
};
const fixtureMetadata = {
	path: 'runtime-build.json',
	mediaType: 'application/json',
	size: 64,
	sha256: 'b'.repeat(64)
};
const fixtureAssets = [
	{
		path: 'compiler.js',
		mediaType: 'text/javascript',
		size: fixtureCompilerBytes.byteLength,
		sha256: createHash('sha256').update(fixtureCompilerBytes).digest('hex')
	}
];
const fixtureStorage = [
	{
		path: 'compiler.js.gz',
		logicalPath: 'compiler.js',
		encoding: 'gzip' as const,
		size: fixtureCompressedCompilerBytes.byteLength,
		sha256: createHash('sha256').update(fixtureCompressedCompilerBytes).digest('hex')
	}
];
const fixtureProfileId = 'clojurescript-1.12.134-test';
const fixtureFingerprint = computeClojureScriptRuntimeFingerprint({
	profileId: fixtureProfileId,
	source: fixtureSource,
	build: fixtureBuild,
	license: fixtureLicense,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	format: 'wasm-clojurescript-runtime-manifest-v2',
	runtime: 'cljs.js',
	profileId: fixtureProfileId,
	fingerprint: fixtureFingerprint,
	source: fixtureSource,
	build: fixtureBuild,
	license: fixtureLicense,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
};

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createStreamingHarnessWorker() {
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

async function createIntegrityHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
let harnessMode = '';
let blobCounter = 0;
URL.createObjectURL = () => {
  const url = 'blob:wasm-clojurescript-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
globalThis.importScripts = (url) => {
  parentPort.postMessage({ harnessImported: url });
  globalThis.wasm_idle = { runner: {
    execute: (_source, _filename, context, callback) => {
      context.onStdout('value?\\n');
      const input = context.stdinLines.shift();
      context.onStdout('main=' + (Number(input) + 5) + '\\n');
      callback({ ok: true, stdout: 'value?\\nmain=' + (Number(input) + 5) + '\\n', stderr: '' });
    }
  } };
};
const compilerBytes = Buffer.from(${JSON.stringify(fixtureCompilerBytes.toString('base64'))}, 'base64');
const compressedCompilerBytes = Buffer.from(
  ${JSON.stringify(fixtureCompressedCompilerBytes.toString('base64'))},
  'base64'
);
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const pathname = new URL(requestedUrl).pathname;
  const isManifest = pathname.endsWith('/runtime-manifest.v2.json');
  const isCompiler = pathname.endsWith('/compiler.js.gz');
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
      path: 'unexpected.js', mediaType: 'text/javascript', size: 1, sha256: 'c'.repeat(64)
    });
  }
  if (harnessMode === 'oversized-receipt') manifest.assets[0].size = 2_000_000;
  if (harnessMode === 'license-receipt') manifest.license.sha256 = 'd'.repeat(64);
  if (harnessMode === 'metadata-receipt') manifest.metadata.sha256 = 'e'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[0].sha256 = 'f'.repeat(64);
  let bytes = isManifest
    ? Buffer.from(JSON.stringify(manifest))
    : isCompiler
      ? Buffer.from(compressedCompilerBytes)
      : Buffer.alloc(0);
  if (harnessMode === 'corrupt-storage' && isCompiler) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && isCompiler) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/compiler.js.gz',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (harnessMode === 'reader-failure' && isCompiler) {
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
  if ((harnessMode === 'truncated-storage' || harnessMode === 'overflow-storage') && isCompiler) {
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
    isCompiler &&
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
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  self.onmessage({ data });
});
`;
	return new NodeWorker(harness, { eval: true });
}

async function runHarness(
	createWorker: () => Promise<NodeWorker>,
	request: Record<string, unknown>,
	onMessage?: (message: any) => void
) {
	const worker = await createWorker();
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

function integrityRequest(overrides: Record<string, unknown> = {}) {
	return {
		baseUrl: fixtureBaseUrl,
		manifestUrl: fixtureManifestUrl,
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: 'read-line',
		stdin: '68\n',
		...overrides
	};
}

async function runStreamingHarness(code: string, stdinText: string) {
	const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
	let suppliedInput = false;
	const messages = await runHarness(
		createStreamingHarnessWorker,
		{ code, stdinChannel: stdin.descriptor },
		(message) => {
			if (message?.output?.includes('value?') && !suppliedInput) {
				suppliedInput = true;
				setTimeout(() => {
					stdin.enqueue(stdinText);
					stdin.close();
				}, 10);
			}
		}
	);
	return messages;
}

describe('ClojureScript runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprints current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_CLOJURESCRIPT_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_CLOJURESCRIPT_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'compiler.js.gz',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-clojurescript-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const compressedCompiler = await readFile(new URL('compiler.js.gz', staticRuntimeUrl));
		const compiler = gunzipSync(compressedCompiler);
		expect(compiler.byteLength).toBe(manifest.assets[0].size);
		expect(createHash('sha256').update(compiler).digest('hex')).toBe(manifest.assets[0].sha256);
		expect(inputLock.assets).toContainEqual(
			expect.objectContaining({
				path: 'compiler.js',
				bytes: manifest.assets[0].size,
				sha256: manifest.assets[0].sha256
			})
		);
		expect(compressedCompiler.byteLength).toBe(manifest.storage[0].size);
		expect(createHash('sha256').update(compressedCompiler).digest('hex')).toBe(
			manifest.storage[0].sha256
		);
		for (const receipt of [manifest.license, manifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
		}
		expect(inputLock.license).toMatchObject({
			bytes: manifest.license.size,
			sha256: manifest.license.sha256
		});
		expect(inputLock.assets).toContainEqual(
			expect.objectContaining({
				path: 'runtime-build.json',
				bytes: manifest.metadata.size,
				sha256: manifest.metadata.sha256
			})
		);
		expect(manifest.profileId).toBe(inputLock.profileId);
		expect(manifest.source).toEqual(inputLock.source);
		expect(manifest.build).toEqual(inputLock.build);
		expect(computeClojureScriptRuntimeFingerprint(manifest)).toBe(
			WASM_CLOJURESCRIPT_ASSET_VERSION
		);
		expect(manifest.fingerprint).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION);
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.fingerprint).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION.slice(0, 16));
	});

	it('verifies and evaluates only the manifest-declared compiler storage', async () => {
		const messages = await runHarness(createIntegrityHarnessWorker, integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(2);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-clojurescript/runtime-manifest.v2.json',
			'/wasm-clojurescript/compiler.js.gz'
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
				harnessImported: expect.stringMatching(/^blob:wasm-clojurescript-/u)
			})
		);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessBlobRevoked: expect.stringMatching(/^blob:wasm-clojurescript-/u)
			})
		);
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['unknown-asset', 'exactly one logical asset'],
		['oversized-receipt', 'invalid or exceeds its byte limit'],
		['license-receipt', 'receipt graph failed fingerprint verification'],
		['metadata-receipt', 'receipt graph failed fingerprint verification'],
		['storage-receipt', 'receipt graph failed fingerprint verification'],
		['corrupt-storage', 'failed SHA-256 verification']
	])('rejects %s before evaluating the compiler', async (harnessMode, error) => {
		const messages = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ harnessMode })
		);

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
	])('rejects %s with bounded cleanup', async (harnessMode, error, expectedCancellation) => {
		const messages = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ harnessMode })
		);

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		if (expectedCancellation) {
			expect(messages).toContainEqual({ harnessCancelled: expectedCancellation });
		}
		if (expectedCancellation === 'reader') {
			expect(messages).toContainEqual({ harnessReleased: true, harnessWasCancelled: true });
		}
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
		const messages = await runHarness(createStreamingHarnessWorker, {
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
