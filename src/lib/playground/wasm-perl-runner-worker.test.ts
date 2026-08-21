// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
	computePerlRuntimeFingerprint,
	PERL_FINGERPRINT_DOMAIN,
	PERL_MANIFEST_FORMAT
} from '../../../scripts/sync-wasm-perl.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_PERL_ASSET_VERSION,
	WASM_PERL_RUNNER_RECEIPT,
	WASM_PERL_RUNTIME_PROFILE
} from './wasmPerlVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-perl-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-perl/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-perl/', import.meta.url);
const deployedManifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
const deployedManifest = JSON.parse(deployedManifestBytes.toString('utf8'));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const fixtureLogicalBytes = {
	'emperl.data': Buffer.from('fixture WebPerl data\n', 'utf8'),
	'emperl.js': Buffer.from(
		'/* var Module=typeof Module!=="undefined"?Module:{}; Module["getPreloadedPackage"]; Module["wasmBinary"]; */\n',
		'utf8'
	),
	'emperl.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes = {
	'emperl.data': 'application/octet-stream',
	'emperl.js': 'text/javascript',
	'emperl.wasm': 'application/wasm'
};
const fixtureStorageMetadata = {
	'emperl.data.gz.bin': { logicalPath: 'emperl.data', encoding: 'gzip' },
	'emperl.js.gz.bin': { logicalPath: 'emperl.js', encoding: 'gzip' },
	'emperl.wasm.gz.bin': { logicalPath: 'emperl.wasm', encoding: 'gzip' }
} as const;
const fixtureStorageBytes = Object.fromEntries(
	Object.entries(fixtureStorageMetadata).map(([storagePath, metadata]) => [
		storagePath,
		gzipSync(fixtureLogicalBytes[metadata.logicalPath as keyof typeof fixtureLogicalBytes], {
			level: 9
		})
	])
);
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

function createRuntimePreflight(
	overrides: Record<string, unknown> = {},
	manifest: Record<string, unknown> = fixtureManifest
) {
	return {
		protocol: 'wasm-idle-perl-preflight',
		protocolVersion: 1,
		profileId: WASM_PERL_RUNTIME_PROFILE.profileId,
		artifactRevision: WASM_PERL_RUNTIME_PROFILE.artifactRevision,
		webperlRevision: WASM_PERL_RUNTIME_PROFILE.webperlRevision,
		perlRevision: WASM_PERL_RUNTIME_PROFILE.perlRevision,
		emscriptenRevision: WASM_PERL_RUNTIME_PROFILE.emscriptenRevision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		javascriptBytes: Uint8Array.from(fixtureLogicalBytes['emperl.js']),
		wasmBytes: Uint8Array.from(fixtureLogicalBytes['emperl.wasm']),
		dataBytes: Uint8Array.from(fixtureLogicalBytes['emperl.data']),
		...overrides
	};
}

async function readWorkerSource(manifestFingerprint: string = WASM_PERL_ASSET_VERSION) {
	const source = await readFile(workerSourceUrl, 'utf8');
	if (manifestFingerprint === WASM_PERL_ASSET_VERSION) return source;
	const bundledIdentity = `manifestFingerprint: '${WASM_PERL_ASSET_VERSION}'`;
	if (
		source.indexOf(bundledIdentity) < 0 ||
		source.indexOf(bundledIdentity) !== source.lastIndexOf(bundledIdentity)
	) {
		throw new Error('Perl runner must contain exactly one bundled manifest fingerprint');
	}
	return source.replace(bundledIdentity, `manifestFingerprint: '${manifestFingerprint}'`);
}

async function createHarnessWorker(manifestFingerprint = fixtureFingerprint) {
	const workerSource = await readWorkerSource(manifestFingerprint);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
let harnessMode = '';
let blobCounter = 0;
let staleInstalled = false;
const staleModule = { stale: 'module' };
self.postMessage = (message) => {
  if (staleInstalled && message && (message.results !== undefined || message.error !== undefined)) {
    parentPort.postMessage({ harnessModuleRestored: globalThis.Module === staleModule });
  }
  parentPort.postMessage(message);
};
self.close = () => parentPort.postMessage({ harnessClosed: true });
URL.createObjectURL = () => {
  const value = 'blob:wasm-perl-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: value });
  return value;
};
URL.revokeObjectURL = (value) => parentPort.postMessage({ harnessBlobRevoked: value });
globalThis.importScripts = (value) => {
  const hostModule = globalThis.Module;
  parentPort.postMessage({
    harnessImported: String(value),
    harnessFreshModule: hostModule !== staleModule && hostModule &&
      hostModule.wasmBinary instanceof Uint8Array
  });
  if (harnessMode === 'import-failure') throw new Error('fixture import failure');
  if (harnessMode === 'module-replacement') {
    globalThis.Module = { replaced: true };
    return;
  }
  const wasmPath = hostModule.locateFile('emperl.wasm');
  const dataPath = hostModule.locateFile('emperl.data');
  let undeclaredRejected = false;
  let wrongPackageRejected = false;
  try { hostModule.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
  try { hostModule.getPreloadedPackage(dataPath, ${fixtureLogicalBytes['emperl.data'].byteLength + 1}); }
  catch { wrongPackageRejected = true; }
  const data = Buffer.from(
    hostModule.getPreloadedPackage(dataPath, ${fixtureLogicalBytes['emperl.data'].byteLength})
  );
	const injectionReady = Promise.all([
    webcrypto.subtle.digest('SHA-256', hostModule.wasmBinary),
    webcrypto.subtle.digest('SHA-256', data)
  ]).then(([wasmHash, dataHash]) => parentPort.postMessage({
    harnessInjected: {
      wasmPath,
      dataPath,
      undeclaredRejected,
      wrongPackageRejected,
      wasmSha256: Buffer.from(wasmHash).toString('hex'),
      dataSha256: Buffer.from(dataHash).toString('hex')
    }
  }));
  hostModule.FS_createPath = () => {};
  hostModule.FS_createDataFile = () => {};
  hostModule.callMain = () => {
    hostModule.print('value?');
    const input = [];
    while (true) {
      const byte = hostModule.stdin();
      if (byte === null) break;
      input.push(byte);
    }
    hostModule.print('main=' + (Number(Buffer.from(input).toString('utf8').trim()) + 5));
    return 0;
  };
	const initialize = () => void injectionReady.then(() => hostModule.onRuntimeInitialized());
  if (harnessMode === 'delayed-initialize') setTimeout(initialize, 50);
  else initialize();
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  if (harnessMode === 'stale-module' || harnessMode === 'import-failure' ||
      harnessMode === 'module-replacement') {
    globalThis.Module = staleModule;
    staleInstalled = true;
  }
  self.onmessage({ data });
});
`;
	return new NodeWorker(harness, { eval: true });
}

function executionRequest(overrides: Record<string, unknown> = {}) {
	return {
		runtimePreflight: createRuntimePreflight(),
		maxAssetBytes: 16 * 1024 * 1024,
		code: 'my $value = <STDIN>; print $value + 5;',
		stdin: '68\n',
		...overrides
	};
}

const isTerminal = (message: any) => message?.results !== undefined || message?.error !== undefined;
const terminalMessage = (messages: any[]) => messages.findLast(isTerminal);

async function runHarness(
	request: Record<string, unknown>,
	onMessage?: (message: any) => void,
	manifestFingerprint = fixtureFingerprint
) {
	const worker = await createHarnessWorker(manifestFingerprint);
	const messages: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			let terminal = false;
			let closed = false;
			worker.on('message', (message) => {
				messages.push(message);
				try {
					onMessage?.(message);
				} catch (error) {
					reject(error);
					return;
				}
				if (isTerminal(message)) terminal = true;
				if (message?.harnessClosed) closed = true;
				if (terminal && closed) resolve();
			});
			worker.once('error', reject);
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runSequence(requests: Record<string, unknown>[]) {
	const worker = await createHarnessWorker();
	const terminals: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				if (!isTerminal(message)) return;
				terminals.push(message);
				if (terminals.length === requests.length) {
					resolve();
					return;
				}
				worker.postMessage(requests[terminals.length]);
			});
			worker.once('error', reject);
			worker.postMessage(requests[0]);
		});
		return terminals;
	} finally {
		await worker.terminate();
	}
}

async function runConcurrent(requests: Record<string, unknown>[]) {
	const worker = await createHarnessWorker();
	const messages: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			let closed = false;
			worker.on('message', (message) => {
				messages.push(message);
				if (message?.harnessClosed) closed = true;
				if (messages.filter(isTerminal).length === requests.length && closed) resolve();
			});
			worker.once('error', reject);
			for (const request of requests) worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('WebPerl runner worker', { timeout: 60_000 }, () => {
	it('keeps the canonical graph, aliases, full generated profile, and runner pin current', async () => {
		const source = await readWorkerSource();
		const staticSource = await readFile(staticWorkerUrl, 'utf8');
		const manifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
		const manifest = JSON.parse(manifestBytes.toString('utf8'));

		expect(staticSource).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_PERL_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_PERL_RUNNER_RECEIPT.sha256);
		expect(source).toContain(`manifestFingerprint: '${WASM_PERL_ASSET_VERSION}'`);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'emperl.data.gz',
			'emperl.data.gz.bin',
			'emperl.js.gz',
			'emperl.js.gz.bin',
			'emperl.wasm.gz',
			'emperl.wasm.gz.bin',
			'licenses',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(PERL_MANIFEST_FORMAT).toBe('wasm-perl-runtime-manifest-v2');
		expect(PERL_FINGERPRINT_DOMAIN).toBe('wasm-idle:perl-runtime-manifest:v2');
		expect(manifest.fingerprint).toBe(WASM_PERL_ASSET_VERSION);
		expect(computePerlRuntimeFingerprint(manifest)).toBe(WASM_PERL_ASSET_VERSION);
		expect(manifest.storage.map((receipt: { path: string }) => receipt.path)).toEqual([
			'emperl.js.gz.bin',
			'emperl.wasm.gz.bin',
			'emperl.data.gz.bin'
		]);
		expect(manifestBytes.byteLength).toBe(WASM_PERL_RUNTIME_PROFILE.manifestReceipt.bytes);
		expect(sha256(manifestBytes)).toBe(WASM_PERL_RUNTIME_PROFILE.manifestReceipt.sha256);

		const profileReceipts = {
			'emperl.js': WASM_PERL_RUNTIME_PROFILE.javascriptReceipt,
			'emperl.wasm': WASM_PERL_RUNTIME_PROFILE.wasmReceipt,
			'emperl.data': WASM_PERL_RUNTIME_PROFILE.dataReceipt
		};
		for (const storageReceipt of manifest.storage) {
			const stored = await readFile(new URL(storageReceipt.path, staticRuntimeUrl));
			const logical = gunzipSync(stored);
			const logicalReceipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storageReceipt.logicalPath
			);
			expect(stored.byteLength).toBe(storageReceipt.size);
			expect(sha256(stored)).toBe(storageReceipt.sha256);
			expect(logical.byteLength).toBe(logicalReceipt.size);
			expect(sha256(logical)).toBe(logicalReceipt.sha256);
			expect(
				profileReceipts[storageReceipt.logicalPath as keyof typeof profileReceipts]
			).toEqual({
				bytes: storageReceipt.size,
				sha256: storageReceipt.sha256,
				uncompressedBytes: logicalReceipt.size,
				uncompressedSha256: logicalReceipt.sha256
			});
			const legacyPath = storageReceipt.path.replace(/\.bin$/u, '');
			expect(await readFile(new URL(legacyPath, staticRuntimeUrl))).toEqual(stored);
		}
	});

	it('contains no runtime fetch, URL parsing, or decompression path', async () => {
		const source = await readWorkerSource();
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toContain('new URL(');
		expect(source).not.toContain('DecompressionStream');
		expect(source).not.toContain('manifestUrl');
		expect(source).not.toContain('baseUrl');
	});

	it('verifies the payload before injecting local Wasm and data references', async () => {
		const messages = await runHarness(executionRequest());

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({ harnessClosed: true });
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
		expect(messages).toContainEqual({
			harnessInjected: {
				wasmPath: 'wasm-idle-verified:emperl.wasm',
				dataPath: 'wasm-idle-verified:emperl.data',
				undeclaredRejected: true,
				wrongPackageRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['emperl.wasm']),
				dataSha256: sha256(fixtureLogicalBytes['emperl.data'])
			}
		});
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
	});

	it.each([
		[
			'extra preflight field',
			() => createRuntimePreflight({ untrusted: true }),
			'invalid shape'
		],
		[
			'profile revision drift',
			() => createRuntimePreflight({ perlRevision: '0'.repeat(40) }),
			'payload is invalid'
		],
		[
			'invalid manifest JSON',
			() => createRuntimePreflight({ manifestBytes: Uint8Array.from(Buffer.from('{')) }),
			'not valid UTF-8 JSON'
		],
		[
			'extra manifest field',
			() => createRuntimePreflight({}, { ...fixtureManifest, untrusted: true }),
			'schema is invalid'
		],
		[
			'artifact drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						artifact: { ...fixtureManifest.artifact, revision: '0'.repeat(40) }
					}
				),
			'artifact metadata is invalid'
		],
		[
			'component drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						components: {
							...fixtureManifest.components,
							perl: { ...fixtureManifest.components.perl, revision: '0'.repeat(40) }
						}
					}
				),
			'component metadata is invalid'
		],
		[
			'license receipt drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						licenses: fixtureManifest.licenses.map((license: any, index: number) =>
							index === 0 ? { ...license, sha256: '0'.repeat(64) } : license
						)
					}
				),
			'receipt graph failed fingerprint verification'
		],
		[
			'legacy canonical storage path',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						storage: fixtureManifest.storage.map((storage: any, index: number) =>
							index === 0
								? { ...storage, path: storage.path.replace(/\.bin$/u, '') }
								: storage
						)
					}
				),
			'unexpected or duplicate storage asset'
		],
		[
			'logical JavaScript corruption',
			() => {
				const bytes = Uint8Array.from(fixtureLogicalBytes['emperl.js']);
				bytes[bytes.byteLength - 1] ^= 1;
				return createRuntimePreflight({ javascriptBytes: bytes });
			},
			'failed SHA-256 verification'
		]
	] as const)('rejects %s before evaluation', async (_label, buildPayload, error) => {
		const messages = await runHarness(executionRequest({ runtimePreflight: buildPayload() }));

		expect(terminalMessage(messages)?.error).toContain(error);
		expect(messages.some((message) => message.harnessImported)).toBe(false);
		expect(messages).toContainEqual({ harnessClosed: true });
	});

	it('rejects a self-consistent executable replacement against the embedded fingerprint pin', async () => {
		const javascriptBytes = Buffer.from('/* replacement WebPerl executable */\n', 'utf8');
		const replacementAssets = fixtureAssets.map((receipt) =>
			receipt.path === 'emperl.js'
				? { ...receipt, size: javascriptBytes.byteLength, sha256: sha256(javascriptBytes) }
				: receipt
		);
		const replacementStorage = fixtureStorage.map((receipt) => {
			if (receipt.logicalPath !== 'emperl.js') return receipt;
			const stored = gzipSync(javascriptBytes, { level: 9 });
			return { ...receipt, size: stored.byteLength, sha256: sha256(stored) };
		});
		const replacementFingerprint = computePerlRuntimeFingerprint({
			profileId: fixtureManifest.profileId,
			licenseExpression: fixtureManifest.licenseExpression,
			artifact: fixtureManifest.artifact,
			components: fixtureManifest.components,
			licenses: fixtureManifest.licenses,
			metadata: fixtureManifest.metadata,
			assets: replacementAssets,
			storage: replacementStorage
		});
		const replacementManifest = {
			...fixtureManifest,
			fingerprint: replacementFingerprint,
			assets: replacementAssets,
			storage: replacementStorage
		};
		const messages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight(
					{
						manifestFingerprint: replacementFingerprint,
						javascriptBytes: Uint8Array.from(javascriptBytes)
					},
					replacementManifest
				)
			})
		);

		expect(terminalMessage(messages)?.error).toContain('payload is invalid');
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('enforces the hard per-asset and aggregate logical byte limits', async () => {
		const perAsset = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					javascriptBytes: new Uint8Array(16 * 1024 * 1024 + 1)
				})
			})
		);
		expect(terminalMessage(perAsset)?.error).toContain('exceeds its byte limit');

		const aggregateSize = 11 * 1024 * 1024;
		const aggregate = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					javascriptBytes: new Uint8Array(aggregateSize),
					wasmBytes: new Uint8Array(aggregateSize),
					dataBytes: new Uint8Array(aggregateSize)
				})
			})
		);
		expect(terminalMessage(aggregate)?.error).toContain('aggregate byte limit');
	});

	it('clears a stale Module, captures the verified Module, and restores the prior value', async () => {
		const messages = await runHarness(executionRequest({ harnessMode: 'stale-module' }));

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({
			harnessImported: expect.any(String),
			harnessFreshModule: true
		});
		expect(messages).toContainEqual({ harnessModuleRestored: true });
	});

	it.each(['import-failure', 'module-replacement'])(
		'revokes evaluated scripts, restores Module, and closes after %s',
		async (harnessMode) => {
			const messages = await runHarness(executionRequest({ harnessMode }));

			expect(terminalMessage(messages)?.error).toMatch(
				/fixture import failure|Module changed/u
			);
			expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
			expect(messages).toContainEqual({ harnessModuleRestored: true });
			expect(messages).toContainEqual({ harnessClosed: true });
		}
	);

	it('reserves the one-shot request before awaiting verification', async () => {
		const terminals = await runSequence([
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					manifestBytes: Uint8Array.from(Buffer.from('{'))
				})
			}),
			executionRequest()
		]);

		expect(terminals[0].error).toContain('not valid UTF-8 JSON');
		expect(terminals[1].error).toContain('accepts exactly one run');
	});

	it('rejects overlapping execution before shared state can be replaced', async () => {
		const messages = await runConcurrent([
			executionRequest({ harnessMode: 'delayed-initialize' }),
			executionRequest({ stdin: '99\n' })
		]);
		const terminals = messages.filter(isTerminal);

		expect(terminals).toContainEqual({ results: true });
		expect(
			terminals.some((message) => message.error?.includes('accepts exactly one run'))
		).toBe(true);
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
	});

	it('prints a prompt before consuming shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 64, maxBufferedBytes: 64 });
		const supplyInput = setTimeout(() => {
			stdin.enqueue('68\n');
			stdin.close();
		}, 10);
		const messages = await runHarness(
			executionRequest({ stdin: undefined, stdinChannel: stdin.descriptor })
		).finally(() => clearTimeout(supplyInput));

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages.findIndex((message) => message.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message.output?.includes('main=73'))
		);
	});

	it('fails closed on malformed shared stdin before runtime evaluation', async () => {
		const messages = await runHarness(
			executionRequest({
				stdin: undefined,
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					controlBytes: 16,
					capacity: 32,
					buffer: new SharedArrayBuffer(24)
				}
			})
		);

		expect(terminalMessage(messages)?.error).toContain(
			'Invalid WebPerl streaming stdin channel'
		);
		expect(messages.some((message) => message.harnessImported)).toBe(false);
		expect(messages).toContainEqual({ harnessClosed: true });
	});
});
