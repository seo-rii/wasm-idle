// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeNimRuntimeFingerprint } from '../../../scripts/sync-wasm-nim.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_NIM_ASSET_VERSION, WASM_NIM_RUNNER_RECEIPT } from './wasmNimVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-nim-runner-worker.js',
	import.meta.url
);
const lockUrl = new URL('../../../scripts/wasm-nim-assets.lock.json', import.meta.url);
const staticWorkerUrl = new URL('../../../static/wasm-nim/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-nim/', import.meta.url);
const deployedManifest = JSON.parse(
	await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
);
const fixtureBaseUrl = 'https://runtime.example/wasm-nim/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const compressedAssetPaths = new Set([
	'nim/nim-bundle.js',
	'nim/nim.wasm',
	'clang/clang.wasm',
	'clang/lld.wasm',
	'clang/memfs.wasm',
	'clang/sysroot.tar'
]);
const fixtureLogicalBytes: Record<string, Buffer> = {
	'nim/nim-bundle.js': Buffer.from('globalThis.__verifiedNimBundle = true;\n'),
	'nim/nim.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
	'nim/nimbase.h': Buffer.from('#define NIM_INTBITS 32\n'),
	'clang/clang.js': Buffer.from('export async function init() {}\n'),
	'clang/clang.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1]),
	'clang/lld.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 2]),
	'clang/memfs.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 3]),
	'clang/sysroot.tar': Buffer.from('fixture sysroot tar bytes\n')
};
const fixtureMediaTypes = Object.fromEntries(
	deployedManifest.assets.map((receipt: { mediaType: string; path: string }) => [
		receipt.path,
		receipt.mediaType
	])
) as Record<string, string>;
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorageBytes = Object.fromEntries(
	Object.entries(fixtureLogicalBytes).map(([logicalPath, bytes]) => {
		const compressed = compressedAssetPaths.has(logicalPath);
		return [
			compressed ? `${logicalPath}.gz` : logicalPath,
			compressed ? gzipSync(bytes, { level: 9 }) : bytes
		];
	})
) as Record<string, Buffer>;
const fixtureStorage = Object.entries(fixtureStorageBytes).map(([path, bytes]) => ({
	path,
	logicalPath: path.endsWith('.gz') ? path.slice(0, -3) : path,
	encoding: path.endsWith('.gz') ? ('gzip' as const) : ('identity' as const),
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureFingerprint = computeNimRuntimeFingerprint({
	...deployedManifest,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	...deployedManifest,
	fingerprint: fixtureFingerprint,
	assets: fixtureAssets,
	storage: fixtureStorage
};
const overflowLogicalWasm = Buffer.concat([fixtureLogicalBytes['nim/nim.wasm'], Buffer.of(0)]);
const overflowStorageBytes = gzipSync(overflowLogicalWasm, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'nim/nim.wasm.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computeNimRuntimeFingerprint({
	...fixtureManifest,
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

async function listFiles(root: URL) {
	const files: string[] = [];
	const directories: Array<{ relative: string; url: URL }> = [{ relative: '', url: root }];
	while (directories.length) {
		const directory = directories.pop()!;
		for (const entry of await readdir(directory.url, { withFileTypes: true })) {
			const relative = directory.relative
				? `${directory.relative}/${entry.name}`
				: entry.name;
			if (entry.isDirectory())
				directories.push({ relative, url: new URL(`${relative}/`, root) });
			else if (entry.isFile()) files.push(relative);
		}
	}
	return files.sort();
}

async function createIntegrityHarnessWorker() {
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
	const integrityHandler = `
self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    const runtime = await loadVerifiedNimRuntime(
      data.baseUrl,
      data.manifestUrl,
      data.manifestFingerprint,
      data.maxAssetBytes
    );
    const assetPath = data.assetPath || 'nim/nim.wasm';
    const bytes = await runtime.take(assetPath);
    self.postMessage({
      results: true,
      assetPath,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes)
    });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
let harnessMode = '';
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedLogical)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const storageBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedStorage)}).map(([assetPath, base64]) => [assetPath, Buffer.from(base64, 'base64')])
);
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
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
  if (harnessMode === 'component-metadata') manifest.components.nim.revision = '0'.repeat(40);
  if (harnessMode === 'notices-receipt') manifest.notices.sha256 = '0'.repeat(64);
  if (harnessMode === 'unknown-asset') manifest.assets[0].path = 'unexpected.bin';
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'nim/nim.wasm.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'nim/nim.wasm.gz';
  if (targetedStorage && harnessMode === 'transport-decoded') {
    bytes = Buffer.from(logicalBytes['nim/nim.wasm']);
  }
  if (targetedStorage && harnessMode === 'corrupt-storage') bytes[bytes.length - 1] ^= 1;
  if (targetedStorage && harnessMode === 'redirect-storage') {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/nim.wasm.gz',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (targetedStorage && harnessMode === 'wrong-content-length') {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers({ 'content-length': String(bytes.byteLength + 1) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (targetedStorage && (harnessMode === 'truncated-storage' || harnessMode === 'overflow-storage')) {
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
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(integrityHandler)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  self.onmessage({ data });
});
`;
	return new NodeWorker(harness, { eval: true });
}

async function createStdinHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = (event) => {
  try {
    const stdin = createStdinReader(event.data?.stdin || '', event.data?.stdinChannel);
    const output = createOutputCollector((text) => self.postMessage({ output: text }));
    output.push(new TextEncoder().encode('value?\\n'));
    const input = stdin.read(32);
    output.push(new TextEncoder().encode('main=' + new TextDecoder().decode(input) + '\\n'));
    output.finish();
    self.postMessage({ results: true });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(harnessHandler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

type HarnessMessage = Record<string, any>;

async function runHarness(
	createWorker: () => Promise<NodeWorker>,
	request: Record<string, unknown>,
	onMessage?: (message: HarnessMessage) => void
) {
	const worker = await createWorker();
	const messages: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				try {
					onMessage?.(message);
				} catch (error) {
					reject(error);
					return;
				}
				if (message.results !== undefined || message.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`Nim worker harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runIntegritySequence(requests: Record<string, unknown>[]) {
	const worker = await createIntegrityHarnessWorker();
	const terminals: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				if (message.results === undefined && message.error === undefined) return;
				terminals.push(message);
				if (terminals.length === requests.length) resolve();
				else worker.postMessage(requests[terminals.length]);
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`Nim integrity harness exited with code ${code}`));
			});
			worker.postMessage(requests[0]);
		});
		return terminals;
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
		assetPath: 'nim/nim.wasm',
		...overrides
	};
}

describe('Nim runner worker', () => {
	it('keeps the input lock, deployed receipts, runner pin, and fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_NIM_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_NIM_RUNNER_RECEIPT.sha256);
		expect(await listFiles(staticRuntimeUrl)).toEqual([
			'LICENSE',
			'README.md',
			'THIRD_PARTY_NOTICES.md',
			'clang/clang.js',
			'clang/clang.wasm.gz',
			'clang/lld.wasm.gz',
			'clang/memfs.wasm.gz',
			'clang/sysroot.tar.gz',
			'nim/nim-bundle.js.gz',
			'nim/nim.wasm.gz',
			'nim/nimbase.h',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(deployedManifest.fingerprint).toBe(WASM_NIM_ASSET_VERSION);
		expect(computeNimRuntimeFingerprint(deployedManifest)).toBe(WASM_NIM_ASSET_VERSION);
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		expect(deployedManifest.profileId).toBe(lock.profileId);
		expect(deployedManifest.licenseExpression).toBe(lock.licenseExpression);
		expect(deployedManifest.artifact).toEqual(lock.artifact);
		expect(deployedManifest.components).toEqual(lock.components);
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
			const locked = lock.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(locked).toMatchObject({ bytes: receipt.size, sha256: receipt.sha256 });
		}
		for (const receipt of [
			deployedManifest.license,
			deployedManifest.notices,
			deployedManifest.documentation,
			deployedManifest.metadata
		]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(sha256(bytes)).toBe(receipt.sha256);
		}
		const legacy = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacy.fingerprint).toBe(WASM_NIM_ASSET_VERSION.slice(0, 16));
	});

	it('verifies gzip and identity assets through the declared receipt graph', async () => {
		const gzipMessages = await runHarness(createIntegrityHarnessWorker, integrityRequest());
		expect(gzipMessages.at(-1)).toEqual({
			results: true,
			assetPath: 'nim/nim.wasm',
			bytes: fixtureLogicalBytes['nim/nim.wasm'].byteLength,
			sha256: sha256(fixtureLogicalBytes['nim/nim.wasm'])
		});
		const fetches = gzipMessages.filter((message) => message.harnessFetch);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-nim/runtime-manifest.v2.json',
			'/wasm-nim/nim/nim.wasm.gz'
		]);
		for (const message of fetches) {
			expect(message.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(fetches[0].harnessFetchOptions).toMatchObject({ cache: 'no-store' });

		const identityMessages = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ assetPath: 'clang/clang.js' })
		);
		expect(identityMessages.at(-1)).toMatchObject({
			results: true,
			assetPath: 'clang/clang.js',
			sha256: sha256(fixtureLogicalBytes['clang/clang.js'])
		});
	});

	it('accepts a transparently decoded gzip response only when its logical receipt matches', async () => {
		const messages = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ harnessMode: 'transport-decoded' })
		);
		expect(messages.at(-1)).toMatchObject({ results: true });
	});

	it.each([
		['invalid-manifest-json', 'valid UTF-8 JSON'],
		['manifest-fingerprint', 'fingerprint'],
		['unexpected-manifest-field', 'schema'],
		['component-metadata', 'component'],
		['notices-receipt', 'fingerprint'],
		['unknown-asset', 'unexpected or duplicate'],
		['corrupt-storage', 'SHA-256'],
		['redirect-storage', 'does not match'],
		['wrong-content-length', 'Content-Length'],
		['truncated-storage', 'truncated'],
		['overflow-storage', 'exceeds its receipt size'],
		['gzip-overflow', 'exceeds its logical receipt size']
	])('fails closed for %s', async (harnessMode, expectedMessage) => {
		const request = integrityRequest({ harnessMode });
		if (harnessMode === 'gzip-overflow') request.manifestFingerprint = overflowFingerprint;
		const messages = await runHarness(createIntegrityHarnessWorker, request);
		expect(String(messages.at(-1)?.error)).toContain(expectedMessage);
	});

	it('clears failed verification and asset state so later requests can retry', async () => {
		const manifestTerminals = await runIntegritySequence([
			integrityRequest({ harnessMode: 'manifest-fingerprint' }),
			integrityRequest()
		]);
		expect(String(manifestTerminals[0].error)).toContain('fingerprint');
		expect(manifestTerminals[1]).toMatchObject({ results: true });

		const assetTerminals = await runIntegritySequence([
			integrityRequest({ harnessMode: 'corrupt-storage' }),
			integrityRequest()
		]);
		expect(String(assetTerminals[0].error)).toContain('SHA-256');
		expect(assetTerminals[1]).toMatchObject({ results: true });
	});

	it('rejects a different runtime identity after successful verification', async () => {
		const terminals = await runIntegritySequence([
			integrityRequest(),
			integrityRequest({ manifestUrl: `${fixtureBaseUrl}alternate.json` })
		]);
		expect(terminals[0]).toMatchObject({ results: true });
		expect(String(terminals[1].error)).toContain(
			'cannot replace an initialized runtime profile'
		);
	});

	it('streams a prompt before consuming currently available UTF-8 input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			createStdinHarnessWorker,
			{ stdinChannel: stdin.descriptor },
			(message) => {
				if (message.output?.includes('value?') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('안녕\r\n');
						stdin.close();
					}, 10);
				}
			}
		);

		expect(messages.findIndex((message) => message.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message.output?.includes('main=안녕'))
		);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness(createStdinHarnessWorker, {
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid Nim streaming stdin channel.' }]);
	});
});
