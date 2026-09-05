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
	WASM_CLOJURESCRIPT_RUNNER_RECEIPT,
	WASM_CLOJURESCRIPT_RUNTIME_PROFILE
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
		path: 'compiler.js.gz.bin',
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
const fixtureManifestBytes = Buffer.from(JSON.stringify(fixtureManifest), 'utf8');

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
globalThis.fetch = (...args) => {
  parentPort.postMessage({ harnessFetch: args.map(String) });
  throw new Error('worker network access is forbidden');
};
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
    execute: (source, _filename, context, callback) => {
      context.onStdout('value?\\n');
      const input = source === 'read-all' ? context.stdin : context.stdinLines.shift();
      const output = source === 'read-number' ? String(Number(input) + 5) : String(input ?? '');
      context.onStdout('main=' + output + '\\n');
      callback({ ok: true, stdout: 'value?\\nmain=' + output + '\\n', stderr: '' });
    }
  } };
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => self.onmessage({ data }));
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
				if (code !== 0) reject(new Error(`ClojureScript harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

function runtimePreflight(overrides: Record<string, unknown> = {}) {
	return {
		protocol: 'wasm-idle-clojurescript-preflight',
		protocolVersion: 1,
		profileId: fixtureProfileId,
		sourceRevision: fixtureSource.revision,
		integrationRevision: fixtureSource.integrationRevision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(fixtureManifestBytes),
		compilerBytes: Uint8Array.from(fixtureCompilerBytes),
		...overrides
	};
}

function integrityRequest(overrides: Record<string, unknown> = {}) {
	return {
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: 'read-number',
		stdin: '68\n',
		runtimePreflight: runtimePreflight(),
		...overrides
	};
}

async function runStreamingHarness(code: string, stdinText: string) {
	const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
	let suppliedInput = false;
	const messages = await runHarness(
		integrityRequest({ code, stdin: '', stdinChannel: stdin.descriptor }),
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
	it('keeps the input lock, deployed receipts, aliases, runner pin, and profile current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_CLOJURESCRIPT_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_CLOJURESCRIPT_RUNNER_RECEIPT.sha256
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'compiler.js.gz',
			'compiler.js.gz.bin',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const manifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-clojurescript-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const legacyCompressedCompiler = await readFile(
			new URL('compiler.js.gz', staticRuntimeUrl)
		);
		const compressedCompiler = await readFile(new URL('compiler.js.gz.bin', staticRuntimeUrl));
		expect(compressedCompiler.equals(legacyCompressedCompiler)).toBe(true);
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
		expect(manifest.storage[0].path).toBe('compiler.js.gz.bin');
		expect(compressedCompiler.byteLength).toBe(manifest.storage[0].size);
		expect(createHash('sha256').update(compressedCompiler).digest('hex')).toBe(
			manifest.storage[0].sha256
		);
		for (const receipt of [manifest.license, manifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
		}
		expect(manifest.profileId).toBe(inputLock.profileId);
		expect(manifest.source).toEqual(inputLock.source);
		expect(manifest.build).toEqual(inputLock.build);
		expect(computeClojureScriptRuntimeFingerprint(manifest)).toBe(
			WASM_CLOJURESCRIPT_ASSET_VERSION
		);
		expect(manifest.fingerprint).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION);
		expect(WASM_CLOJURESCRIPT_RUNTIME_PROFILE).toEqual({
			profileId: manifest.profileId,
			sourceRevision: manifest.source.revision,
			integrationRevision: manifest.source.integrationRevision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: manifestBytes.byteLength,
				sha256: createHash('sha256').update(manifestBytes).digest('hex')
			},
			compilerReceipt: {
				bytes: manifest.storage[0].size,
				sha256: manifest.storage[0].sha256,
				uncompressedBytes: manifest.assets[0].size,
				uncompressedSha256: manifest.assets[0].sha256
			}
		});
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.files).toContain('compiler.js.gz');
		expect(legacyManifest.fingerprint).toBe(WASM_CLOJURESCRIPT_ASSET_VERSION.slice(0, 16));
	}, 15_000);

	it('validates and evaluates host-preflighted compiler bytes without worker network access', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
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
		[
			'missing payload',
			undefined,
			'ClojureScript runtime requires a valid host-preflighted asset payload.'
		],
		[
			'extra payload field',
			runtimePreflight({ unexpected: true }),
			'ClojureScript runtime requires a valid host-preflighted asset payload.'
		],
		[
			'protocol drift',
			runtimePreflight({ protocolVersion: 2 }),
			'ClojureScript runtime requires a valid host-preflighted asset payload.'
		],
		[
			'profile drift',
			runtimePreflight({ profileId: 'clojurescript-1.12.134-other' }),
			'ClojureScript runtime manifest profile, source, or build metadata is invalid or mismatched.'
		],
		[
			'source drift',
			runtimePreflight({ sourceRevision: 'r1.12.133' }),
			'ClojureScript runtime requires a valid host-preflighted asset payload.'
		],
		[
			'integration drift',
			runtimePreflight({ integrationRevision: '0'.repeat(40) }),
			'ClojureScript runtime manifest profile, source, or build metadata is invalid or mismatched.'
		],
		[
			'fingerprint drift',
			runtimePreflight({ manifestFingerprint: '0'.repeat(64) }),
			'ClojureScript runtime requires a valid host-preflighted asset payload.'
		]
	])('rejects %s before evaluating the compiler', async (_label, payload, expectedError) => {
		const messages = await runHarness(integrityRequest({ runtimePreflight: payload }));

		expect(messages.at(-1)).toEqual({ error: expectedError });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
	});

	it.each([
		[
			'malformed manifest',
			runtimePreflight({ manifestBytes: Uint8Array.from(Buffer.from('{')) }),
			'not valid UTF-8 JSON'
		],
		[
			'manifest fingerprint mutation',
			runtimePreflight({
				manifestBytes: Uint8Array.from(
					Buffer.from(JSON.stringify({ ...fixtureManifest, fingerprint: '0'.repeat(64) }))
				)
			}),
			'fingerprint does not match'
		],
		[
			'manifest graph mutation',
			runtimePreflight({
				manifestBytes: Uint8Array.from(
					Buffer.from(
						JSON.stringify({
							...fixtureManifest,
							license: { ...fixtureManifest.license, sha256: '0'.repeat(64) }
						})
					)
				)
			}),
			'receipt graph failed fingerprint verification'
		],
		[
			'compiler corruption',
			runtimePreflight({
				compilerBytes: Uint8Array.from(Buffer.from(fixtureCompilerBytes).fill(0, 0, 1))
			}),
			'failed SHA-256 verification'
		]
	])('rejects %s before evaluation', async (_label, payload, error) => {
		const messages = await runHarness(integrityRequest({ runtimePreflight: payload }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
	});

	it('validates the exact preflight payload even for empty source', async () => {
		const missing = await runHarness(
			integrityRequest({ code: '', runtimePreflight: undefined })
		);
		const extra = await runHarness(
			integrityRequest({ code: '', runtimePreflight: runtimePreflight({ unexpected: true }) })
		);

		expect(missing.at(-1)).toEqual({
			error: 'ClojureScript runtime requires a valid host-preflighted asset payload.'
		});
		expect(extra.at(-1)).toEqual({
			error: 'ClojureScript runtime requires a valid host-preflighted asset payload.'
		});
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
		const messages = await runHarness(
			integrityRequest({
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					buffer: new SharedArrayBuffer(32),
					capacity: 16,
					controlBytes: 8
				}
			})
		);

		expect(messages).toEqual([{ error: 'Invalid ClojureScript streaming stdin channel.' }]);
	});
});
