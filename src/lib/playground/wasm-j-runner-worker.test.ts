// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeJRuntimeFingerprint } from '../../../scripts/sync-wasm-j.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_J_ASSET_VERSION,
	WASM_J_RUNNER_RECEIPT,
	WASM_J_RUNTIME_PROFILE
} from './wasmJVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-j-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-j/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-j/', import.meta.url);
const moduleBytes = Buffer.from('export default function fixtureJModule() {}\n', 'utf8');
const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
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
		path: 'jamalgam.wasm.gz.bin',
		logicalPath: 'jamalgam.wasm',
		encoding: 'gzip' as const,
		size: 32,
		sha256: 'c'.repeat(64)
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

function runtimePreflight() {
	return {
		protocol: 'wasm-idle-j-preflight',
		protocolVersion: 1,
		profileId: fixtureProfileId,
		sourceRevision: fixtureSource.revision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(fixtureManifest))),
		moduleBytes: Uint8Array.from(moduleBytes),
		wasmBytes: Uint8Array.from(wasmBytes)
	};
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
globalThis.fetch = (...args) => {
  parentPort.postMessage({ harnessFetch: args.map(String) });
  throw new Error('J worker attempted an unexpected network request');
};
let blobCounter = 0;
URL.createObjectURL = () => {
  const url = 'blob:wasm-j-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
globalThis.__createJModule = async (options) => {
  parentPort.postMessage({
    harnessModuleWasmBytes: options.wasmBinary.byteLength,
    harnessLocateFile: options.locateFile('jamalgam.wasm')
  });
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
(0, eval)(${JSON.stringify(harnessSource)});
parentPort.on('message', (data) => {
  const request = structuredClone(data);
  const mode = request.harnessMode || '';
  delete request.harnessMode;
  const payload = request.runtimePreflight;
  if (mode === 'missing-preflight') delete request.runtimePreflight;
  if (mode === 'extra-payload') payload.unexpected = true;
  if (mode === 'protocol') payload.protocolVersion = 2;
  if (mode === 'payload-fingerprint') payload.manifestFingerprint = '0'.repeat(64);
  if (mode === 'profile') payload.profileId = 'jsoftware-j-playground-other';
  if (mode === 'source') payload.sourceRevision = 'other';
  if (mode === 'malformed-manifest') payload.manifestBytes = Uint8Array.from([0xff]);
  if (
    mode === 'manifest-fingerprint' || mode === 'unknown-asset' ||
    mode === 'duplicate-asset' || mode === 'oversized-receipt' || mode === 'storage-graph'
  ) {
    const manifest = JSON.parse(Buffer.from(payload.manifestBytes).toString('utf8'));
    if (mode === 'manifest-fingerprint') manifest.fingerprint = '0'.repeat(64);
    if (mode === 'unknown-asset') {
      manifest.assets.push({
        path: 'unexpected.js', mediaType: 'text/javascript', size: 1, sha256: 'a'.repeat(64)
      });
    }
    if (mode === 'duplicate-asset') manifest.assets[1] = { ...manifest.assets[0] };
    if (mode === 'oversized-receipt') manifest.assets[0].size = 2_000_000;
    if (mode === 'storage-graph') manifest.storage[1].sha256 = 'd'.repeat(64);
    payload.manifestBytes = Uint8Array.from(Buffer.from(JSON.stringify(manifest)));
  }
  if (mode === 'corrupt-module') payload.moduleBytes[payload.moduleBytes.length - 1] ^= 1;
  if (mode === 'corrupt-wasm') payload.wasmBytes[payload.wasmBytes.length - 1] ^= 1;
  self.onmessage({ data: request });
});
`;
	return new NodeWorker(harness, { eval: true });
}

function runtimeRequest(overrides: Record<string, unknown> = {}) {
	return {
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: "smoutput 'ok'",
		stdin: '',
		runtimePreflight: runtimePreflight(),
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
	it('keeps input locks, generated profile receipts, runner pin, and fingerprints current', async () => {
		const source = await readWorkerSource();
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_J_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_J_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'jamalgam.js',
			'jamalgam.wasm.gz',
			'jamalgam.wasm.gz.bin',
			'runner-worker.js',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const manifestSource = await readFile(
			new URL('runtime-manifest.v2.json', staticRuntimeUrl),
			'utf8'
		);
		const manifest = JSON.parse(manifestSource);
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-j-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const logicalBytes = {
			'jamalgam.js': await readFile(new URL('jamalgam.js', staticRuntimeUrl)),
			'jamalgam.wasm': gunzipSync(
				await readFile(new URL('jamalgam.wasm.gz.bin', staticRuntimeUrl))
			)
		};
		expect(await readFile(new URL('jamalgam.wasm.gz', staticRuntimeUrl))).toEqual(
			await readFile(new URL('jamalgam.wasm.gz.bin', staticRuntimeUrl))
		);
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
		expect(WASM_J_RUNTIME_PROFILE).toMatchObject({
			profileId: manifest.profileId,
			sourceRevision: manifest.source.revision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: Buffer.byteLength(manifestSource),
				sha256: createHash('sha256').update(manifestSource).digest('hex')
			},
			moduleReceipt: {
				bytes: manifest.assets[0].size,
				sha256: manifest.assets[0].sha256
			},
			wasmReceipt: {
				bytes: manifest.storage[1].size,
				sha256: manifest.storage[1].sha256,
				uncompressedBytes: manifest.assets[1].size,
				uncompressedSha256: manifest.assets[1].sha256
			}
		});
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.fingerprint).toBe(WASM_J_ASSET_VERSION.slice(0, 16));
	}, 15_000);

	it('revalidates host-preflighted assets without network access before streaming stdin', async () => {
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
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages).toContainEqual({
			harnessModuleWasmBytes: wasmBytes.byteLength,
			harnessLocateFile: 'wasm-idle-preflight://j/jamalgam.wasm'
		});
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessBlobCreated: expect.stringMatching(/^blob:wasm-j-/u) })
		);
		expect(messages).toContainEqual(
			expect.objectContaining({ harnessBlobRevoked: expect.stringMatching(/^blob:wasm-j-/u) })
		);
	});

	it('fails malformed streaming stdin before evaluating a runtime module', async () => {
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
		['missing-preflight', 'valid host-preflighted asset payload'],
		['extra-payload', 'valid host-preflighted asset payload'],
		['protocol', 'valid host-preflighted asset payload'],
		['payload-fingerprint', 'valid host-preflighted asset payload'],
		['profile', 'profile or source metadata is invalid or mismatched'],
		['source', 'profile or source metadata is invalid or mismatched'],
		['malformed-manifest', 'not valid UTF-8 JSON'],
		['manifest-fingerprint', 'fingerprint does not match'],
		['unknown-asset', 'exactly two logical assets'],
		['duplicate-asset', 'receipt jamalgam.wasm is invalid'],
		['oversized-receipt', 'invalid or exceeds its byte limit'],
		['storage-graph', 'receipt graph failed fingerprint verification'],
		['corrupt-module', 'jamalgam.js failed SHA-256 verification'],
		['corrupt-wasm', 'jamalgam.wasm failed SHA-256 verification']
	])('rejects %s before evaluating a runtime module', async (harnessMode, error) => {
		const messages = await runHarness(runtimeRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
	});
});
