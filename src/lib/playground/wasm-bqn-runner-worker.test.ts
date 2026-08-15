// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeBqnRuntimeFingerprint } from '../../../scripts/sync-wasm-bqn.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_BQN_ASSET_VERSION,
	WASM_BQN_RUNNER_RECEIPT,
	WASM_BQN_RUNTIME_PROFILE
} from './wasmBqnVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-bqn-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-bqn/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-bqn/', import.meta.url);
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
		path: 'BQN.wasm.gz.bin',
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

function runtimePreflight() {
	return {
		protocol: 'wasm-idle-bqn-preflight',
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
globalThis.fetch = (...args) => {
  parentPort.postMessage({ harnessFetch: args.map(String) });
  throw new Error('CBQN worker attempted an unexpected network request');
};
let blobCounter = 0;
URL.createObjectURL = () => {
  const url = 'blob:wasm-bqn-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
globalThis.__createBqnModule = async (options) => {
  parentPort.postMessage({
    harnessModuleWasmBytes: options.wasmBinary.byteLength,
    harnessLocateFile: options.locateFile('BQN.wasm')
  });
  return {
    cwrap: () => () => {
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
  if (mode === 'profile') payload.profileId = 'dzaima-cbqn-other';
  if (mode === 'source') payload.sourceRevision = 'other';
  if (mode === 'malformed-manifest') payload.manifestBytes = Uint8Array.from([0xff]);
  if (
    mode === 'manifest-fingerprint' || mode === 'unknown-asset' ||
    mode === 'duplicate-asset' || mode === 'oversized-receipt' ||
    mode === 'license-receipt' || mode === 'storage-receipt'
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
    if (mode === 'license-receipt') manifest.license.sha256 = 'b'.repeat(64);
    if (mode === 'storage-receipt') manifest.storage[1].sha256 = 'c'.repeat(64);
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
		code: '5 + •ParseFloat •GetLine @',
		stdin: '68\n',
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
	it('keeps input locks, generated profile receipts, runner pin, and fingerprints current', async () => {
		const source = await readWorkerSource();
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_BQN_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_BQN_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'BQN.js',
			'BQN.wasm.gz',
			'BQN.wasm.gz.bin',
			'LICENSE-GPLv3.txt',
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
				new URL('../../../scripts/wasm-bqn-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const logicalBytes = {
			'BQN.js': await readFile(new URL('BQN.js', staticRuntimeUrl)),
			'BQN.wasm': gunzipSync(await readFile(new URL('BQN.wasm.gz.bin', staticRuntimeUrl)))
		};
		expect(await readFile(new URL('BQN.wasm.gz', staticRuntimeUrl))).toEqual(
			await readFile(new URL('BQN.wasm.gz.bin', staticRuntimeUrl))
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
		expect(WASM_BQN_RUNTIME_PROFILE).toMatchObject({
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
		expect(legacyManifest.fingerprint).toBe(WASM_BQN_ASSET_VERSION.slice(0, 16));
		expect(await readFile(new URL('BQN.wasm.gz.bin', staticRuntimeUrl))).toEqual(
			gzipSync(logicalBytes['BQN.wasm'], { level: 9 })
		);
	}, 15_000);

	it('revalidates host-preflighted assets without network access before streaming stdin', async () => {
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
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages).toContainEqual({
			harnessModuleWasmBytes: wasmBytes.byteLength,
			harnessLocateFile: 'wasm-idle-preflight://bqn/BQN.wasm'
		});
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
	}, 15_000);

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

		expect(messages).toEqual([{ error: 'Invalid CBQN streaming stdin channel.' }]);
	});

	it.each(['missing-preflight', 'extra-payload'])(
		'rejects %s even when the requested source is empty',
		async (harnessMode) => {
			const messages = await runHarness(runtimeRequest({ code: '', harnessMode }));

			expect(messages.at(-1)).toEqual({
				error: expect.stringContaining('valid host-preflighted asset payload')
			});
			expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
			expect(messages.some((message) => message.harnessFetch)).toBe(false);
		}
	);

	it.each([
		['missing-preflight', 'valid host-preflighted asset payload'],
		['extra-payload', 'valid host-preflighted asset payload'],
		['protocol', 'valid host-preflighted asset payload'],
		['payload-fingerprint', 'valid host-preflighted asset payload'],
		['profile', 'profile, source, or build metadata is invalid or mismatched'],
		['source', 'profile, source, or build metadata is invalid or mismatched'],
		['malformed-manifest', 'not valid UTF-8 JSON'],
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
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
	});
});
