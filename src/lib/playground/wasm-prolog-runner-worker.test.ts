// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computePrologRuntimeFingerprint } from '../../../scripts/sync-wasm-prolog.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_PROLOG_ASSET_VERSION,
	WASM_PROLOG_RUNNER_RECEIPT,
	WASM_PROLOG_RUNTIME_PROFILE
} from './wasmPrologVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-prolog-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-prolog/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-prolog/', import.meta.url);
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
	'swipl-web.data.gz.bin': gzipSync(fixtureLogicalBytes['swipl-web.data'], { level: 9 }),
	'swipl-web.js': fixtureLogicalBytes['swipl-web.js'],
	'swipl-web.wasm.gz.bin': gzipSync(fixtureLogicalBytes['swipl-web.wasm'], { level: 9 })
};
const fixtureStorageMetadata = {
	'swipl-web.data.gz.bin': { logicalPath: 'swipl-web.data', encoding: 'gzip' as const },
	'swipl-web.js': { logicalPath: 'swipl-web.js', encoding: 'identity' as const },
	'swipl-web.wasm.gz.bin': { logicalPath: 'swipl-web.wasm', encoding: 'gzip' as const }
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

function runtimePreflight(
	overrides: Partial<{
		protocol: string;
		protocolVersion: number;
		profileId: string;
		packageRevision: string;
		swiplRevision: string;
		manifestFingerprint: string;
		manifestBytes: Uint8Array;
		javascriptBytes: Uint8Array;
		wasmBytes: Uint8Array;
		dataBytes: Uint8Array;
	}> = {}
) {
	return {
		protocol: 'wasm-idle-prolog-preflight',
		protocolVersion: 1,
		profileId: fixtureProfileId,
		packageRevision: fixturePackage.revision,
		swiplRevision: fixtureToolchain.swiplRevision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(fixtureManifest))),
		javascriptBytes: Uint8Array.from(fixtureLogicalBytes['swipl-web.js']),
		wasmBytes: Uint8Array.from(fixtureLogicalBytes['swipl-web.wasm']),
		dataBytes: Uint8Array.from(fixtureLogicalBytes['swipl-web.data']),
		...overrides
	};
}

function mutatedManifestBytes(mutate: (manifest: any) => void) {
	const manifest = JSON.parse(JSON.stringify(fixtureManifest));
	mutate(manifest);
	return Uint8Array.from(Buffer.from(JSON.stringify(manifest)));
}

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
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
globalThis.importScripts = (url) => {
  parentPort.postMessage({ harnessImported: url });
  parentPort.postMessage({ harnessFactoryBeforeImport: typeof globalThis.SWIPL });
  if (harnessMode === 'stale-global-no-factory') return;
  if (harnessMode === 'import-failure') {
    globalThis.SWIPL = () => Promise.reject(new Error('partial fixture factory'));
    throw new Error('fixture import failure');
  }
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
	  _PL_cleanup(status) {
		parentPort.postMessage({ harnessCleanup: status });
		if (harnessMode === 'cleanup-failure') throw new Error('fixture cleanup failure');
		if (harnessMode === 'cleanup-canceled') return 0;
		return 1;
	  },
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
globalThis.fetch = async (...args) => {
  parentPort.postMessage({ harnessFetch: args.map(String) });
  throw new Error('runner worker attempted a forbidden fetch');
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  if (harnessMode === 'stale-global-no-factory') {
    globalThis.SWIPL = async () => {
      parentPort.postMessage({ harnessStaleFactoryCalled: true });
      throw new Error('stale global SWIPL factory was called');
    };
  }
  if (harnessMode === 'mutate-global-factory') {
    globalThis.SWIPL = async () => {
      parentPort.postMessage({ harnessMutatedFactoryCalled: true });
      throw new Error('mutated global SWIPL factory was called');
    };
  }
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
		runtimePreflight: runtimePreflight(),
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
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toContain('DecompressionStream');
		expect(source).not.toContain('new URL(');
		expect(Buffer.byteLength(source)).toBe(WASM_PROLOG_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_PROLOG_RUNNER_RECEIPT.sha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v2.json',
			'swipl-web.data.gz',
			'swipl-web.data.gz.bin',
			'swipl-web.js',
			'swipl-web.wasm.gz',
			'swipl-web.wasm.gz.bin'
		]);

		const manifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
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
		const assetByPath = new Map<string, { path: string; size: number; sha256: string }>(
			manifest.assets.map(
				(asset: { path: string; size: number; sha256: string }) =>
					[asset.path, asset] as const
			)
		);
		const storageByLogicalPath = new Map<
			string,
			{ logicalPath: string; size: number; sha256: string }
		>(
			manifest.storage.map(
				(asset: { logicalPath: string; size: number; sha256: string }) =>
					[asset.logicalPath, asset] as const
			)
		);
		const javascriptReceipt = assetByPath.get('swipl-web.js')!;
		const wasmAssetReceipt = assetByPath.get('swipl-web.wasm')!;
		const wasmStorageReceipt = storageByLogicalPath.get('swipl-web.wasm')!;
		const dataAssetReceipt = assetByPath.get('swipl-web.data')!;
		const dataStorageReceipt = storageByLogicalPath.get('swipl-web.data')!;
		expect(WASM_PROLOG_RUNTIME_PROFILE).toEqual({
			profileId: manifest.profileId,
			packageRevision: manifest.package.revision,
			swiplRevision: manifest.toolchain.swiplRevision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: manifestBytes.byteLength,
				sha256: sha256(manifestBytes)
			},
			javascriptReceipt: {
				bytes: javascriptReceipt.size,
				sha256: javascriptReceipt.sha256
			},
			wasmReceipt: {
				bytes: wasmStorageReceipt.size,
				sha256: wasmStorageReceipt.sha256,
				uncompressedBytes: wasmAssetReceipt.size,
				uncompressedSha256: wasmAssetReceipt.sha256
			},
			dataReceipt: {
				bytes: dataStorageReceipt.size,
				sha256: dataStorageReceipt.sha256,
				uncompressedBytes: dataAssetReceipt.size,
				uncompressedSha256: dataAssetReceipt.sha256
			}
		});

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
			if (storageReceipt.path.endsWith('.gz.bin')) {
				const legacy = await readFile(
					new URL(storageReceipt.path.slice(0, -4), staticRuntimeUrl)
				);
				expect(legacy).toEqual(stored);
			}
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
	}, 60_000);

	it('accepts only host-preflighted logical bytes and never fetches or decompresses assets', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('received=68');
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
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

	it('rejects missing, extra, or version-mismatched preflight fields before evaluation', async () => {
		const missing = runtimePreflight() as Record<string, unknown>;
		delete missing.dataBytes;
		for (const [payload, error] of [
			[missing, 'invalid shape'],
			[{ ...runtimePreflight(), unexpected: true }, 'invalid shape'],
			[runtimePreflight({ protocol: 'wasm-idle-prolog-preflight-v2' }), 'payload is invalid'],
			[runtimePreflight({ protocolVersion: 2 }), 'payload is invalid']
		] as const) {
			const messages = await runHarness(integrityRequest({ runtimePreflight: payload }));
			expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
			expect(messages.some((message) => message.harnessImported)).toBe(false);
			expect(messages.some((message) => message.harnessFetch)).toBe(false);
		}
	});

	it.each([
		[
			'extra top-level manifest field',
			mutatedManifestBytes((manifest) => {
				manifest.unexpected = true;
			}),
			'manifest format is unsupported'
		],
		[
			'manifest identity',
			mutatedManifestBytes((manifest) => {
				manifest.fingerprint = '0'.repeat(64);
			}),
			'manifest identity is invalid'
		],
		[
			'unknown logical asset',
			mutatedManifestBytes((manifest) => {
				manifest.assets[2].path = 'unexpected.bin';
			}),
			'unexpected or duplicate logical asset'
		],
		[
			'duplicate logical asset',
			mutatedManifestBytes((manifest) => {
				manifest.assets[2] = { ...manifest.assets[0] };
			}),
			'unexpected or duplicate logical asset'
		],
		[
			'missing storage asset',
			mutatedManifestBytes((manifest) => {
				manifest.storage.pop();
			}),
			'exactly three storage assets'
		],
		[
			'package provenance',
			mutatedManifestBytes((manifest) => {
				manifest.package.revision = '0'.repeat(40);
			}),
			'package metadata is invalid'
		],
		[
			'extra license receipt field',
			mutatedManifestBytes((manifest) => {
				manifest.license.unexpected = true;
			}),
			'license receipt is invalid'
		],
		[
			'metadata receipt graph',
			mutatedManifestBytes((manifest) => {
				manifest.metadata.sha256 = 'e'.repeat(64);
			}),
			'receipt graph failed fingerprint verification'
		],
		[
			'storage receipt graph',
			mutatedManifestBytes((manifest) => {
				manifest.storage[0].sha256 = 'f'.repeat(64);
			}),
			'receipt graph failed fingerprint verification'
		]
	])('rejects %s before evaluating the runtime glue', async (_label, manifestBytes, error) => {
		const messages = await runHarness(
			integrityRequest({ runtimePreflight: runtimePreflight({ manifestBytes }) })
		);

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it.each([
		['JavaScript', 'javascriptBytes', fixtureLogicalBytes['swipl-web.js']],
		['Wasm', 'wasmBytes', fixtureLogicalBytes['swipl-web.wasm']],
		['data', 'dataBytes', fixtureLogicalBytes['swipl-web.data']]
	])('rejects corrupted logical %s bytes before evaluation', async (_label, key, source) => {
		const bytes = Uint8Array.from(source);
		bytes[bytes.byteLength - 1] ^= 1;
		const messages = await runHarness(
			integrityRequest({ runtimePreflight: runtimePreflight({ [key]: bytes }) })
		);

		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('failed SHA-256 verification')
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('rejects invalid manifest bytes and validates caps without reconsuming warm payload bytes', async () => {
		const invalidManifest = await runHarness(
			integrityRequest({
				runtimePreflight: runtimePreflight({ manifestBytes: Uint8Array.from([0xff]) })
			})
		);
		expect(invalidManifest.at(-1)).toEqual({
			error: 'SWI-Prolog runtime manifest is not valid UTF-8 JSON.'
		});

		const payload = runtimePreflight();
		const ignoredWarmWasmBytes = Uint8Array.from(fixtureLogicalBytes['swipl-web.wasm']);
		ignoredWarmWasmBytes[ignoredWarmWasmBytes.byteLength - 1] ^= 1;
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ runtimePreflight: payload }),
			integrityRequest({
				runtimePreflight: runtimePreflight({ wasmBytes: ignoredWarmWasmBytes }),
				maxAssetBytes: payload.manifestBytes.byteLength
			}),
			integrityRequest({ runtimePreflight: runtimePreflight(), maxAssetBytes: 1 })
		]);
		expect(terminals).toEqual([
			{ results: true },
			{ results: true },
			{ error: 'SWI-Prolog runtime manifest exceeds its byte limit.' }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessInjected)).toEqual([
			expect.objectContaining({
				harnessInjected: expect.objectContaining({
					wasmSha256: sha256(fixtureLogicalBytes['swipl-web.wasm'])
				})
			}),
			expect.objectContaining({
				harnessInjected: expect.objectContaining({
					wasmSha256: sha256(fixtureLogicalBytes['swipl-web.wasm'])
				})
			})
		]);
	});

	it('verifies an empty source before running and cleans each warm SWI-Prolog instance', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ code: '' }),
			integrityRequest({
				code: 'main :- writeln(second).',
				harnessMode: 'mutate-global-factory'
			}),
			integrityRequest({ code: 'main :- writeln(third).' })
		]);

		expect(terminals).toEqual([{ results: true }, { results: true }, { results: true }]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessInjected)).toHaveLength(3);
		expect(messages.some((message) => message.harnessMutatedFactoryCalled)).toBe(false);
		expect(messages.filter((message) => 'harnessCleanup' in message)).toEqual([
			{ harnessCleanup: 0 },
			{ harnessCleanup: 0 },
			{ harnessCleanup: 0 }
		]);
	});

	it.each([
		['cleanup-failure', 'fixture cleanup failure'],
		['cleanup-canceled', 'SWI-Prolog cleanup returned status 0 instead of 1.']
	])('fails the run when %s prevents a clean reset', async (harnessMode, error) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error });
		expect(messages).not.toContainEqual({ results: true });
	});

	it('clears a failed initialization generation and partial global factory before retry', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ harnessMode: 'import-failure' }),
			integrityRequest()
		]);

		expect(terminals).toEqual([{ error: 'fixture import failure' }, { results: true }]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
		expect(messages.filter((message) => message.harnessFactoryBeforeImport)).toEqual([
			{ harnessFactoryBeforeImport: 'undefined' },
			{ harnessFactoryBeforeImport: 'undefined' }
		]);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(2);
	});

	it('requires evaluated JavaScript to publish a fresh factory instead of capturing a stale global', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ harnessMode: 'stale-global-no-factory' }),
			integrityRequest()
		]);

		expect(terminals).toEqual([
			{ error: 'SWI-Prolog runtime JavaScript did not initialize.' },
			{ results: true }
		]);
		expect(messages.some((message) => message.harnessStaleFactoryCalled)).toBe(false);
		expect(messages.filter((message) => message.harnessFactoryBeforeImport)).toEqual([
			{ harnessFactoryBeforeImport: 'undefined' },
			{ harnessFactoryBeforeImport: 'undefined' }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
	});

	it('rejects a warm identity mismatch without discarding the verified profile', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest(),
			integrityRequest({
				runtimePreflight: runtimePreflight({ profileId: 'swipl-wasm-other-profile' })
			}),
			integrityRequest()
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'SWI-Prolog worker cannot replace an initialized runtime profile.' },
			{ results: true }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessInjected)).toHaveLength(2);
	});

	it('prints a prompt before consuming shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		const supplyInput = setTimeout(() => {
			stdin.enqueue('안녕\n');
			stdin.close();
		}, 10);
		const messages = await runHarness(
			integrityRequest({ stdin: undefined, stdinChannel: stdin.descriptor })
		).finally(() => clearTimeout(supplyInput));

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
