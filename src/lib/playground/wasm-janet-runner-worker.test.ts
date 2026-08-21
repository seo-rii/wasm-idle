// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
	computeJanetRuntimeFingerprint,
	JANET_FINGERPRINT_DOMAIN,
	JANET_MANIFEST_FORMAT
} from '../../../scripts/sync-wasm-janet.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_JANET_ASSET_VERSION,
	WASM_JANET_RUNNER_RECEIPT,
	WASM_JANET_RUNTIME_PROFILE
} from './wasmJanetVersion';

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
const deployedManifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
const deployedManifest = JSON.parse(deployedManifestBytes.toString('utf8'));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const fixtureLogicalBytes = {
	'janet.js': Buffer.from(
		'/* export default Module; callMain; FS.init; Module["wasmBinary"]; */\n',
		'utf8'
	),
	'janet.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes = {
	'janet.js': 'text/javascript',
	'janet.wasm': 'application/wasm'
};
const fixtureStorageMetadata = {
	'janet.js': { logicalPath: 'janet.js', encoding: 'identity' },
	'janet.wasm.gz.bin': { logicalPath: 'janet.wasm', encoding: 'gzip' }
} as const;
const fixtureStorageBytes = {
	'janet.js': fixtureLogicalBytes['janet.js'],
	'janet.wasm.gz.bin': gzipSync(fixtureLogicalBytes['janet.wasm'], { level: 9 })
};
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

function createRuntimePreflight(
	overrides: Record<string, unknown> = {},
	manifest: Record<string, unknown> = fixtureManifest
) {
	return {
		protocol: 'wasm-idle-janet-preflight',
		protocolVersion: 1,
		profileId: WASM_JANET_RUNTIME_PROFILE.profileId,
		artifactRevision: WASM_JANET_RUNTIME_PROFILE.artifactRevision,
		janetVersion: WASM_JANET_RUNTIME_PROFILE.janetVersion,
		emscriptenVersion: WASM_JANET_RUNTIME_PROFILE.emscriptenVersion,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		javascriptBytes: Uint8Array.from(fixtureLogicalBytes['janet.js']),
		wasmBytes: Uint8Array.from(fixtureLogicalBytes['janet.wasm']),
		...overrides
	};
}

async function readWorkerSource(manifestFingerprint: string = WASM_JANET_ASSET_VERSION) {
	const source = await readFile(workerSourceUrl, 'utf8');
	if (manifestFingerprint === WASM_JANET_ASSET_VERSION) return source;
	const bundledIdentity = `manifestFingerprint: '${WASM_JANET_ASSET_VERSION}'`;
	if (
		source.indexOf(bundledIdentity) < 0 ||
		source.indexOf(bundledIdentity) !== source.lastIndexOf(bundledIdentity)
	) {
		throw new Error('Janet runner must contain exactly one bundled manifest fingerprint');
	}
	return source.replace(bundledIdentity, `manifestFingerprint: '${manifestFingerprint}'`);
}

async function createHarnessWorker(manifestFingerprint = fixtureFingerprint) {
	const workerSource = await readWorkerSource(manifestFingerprint);
	const importSeam = 'return await import(moduleUrl);';
	if (!workerSource.includes(importSeam)) {
		throw new Error('Janet verified module import seam was not found');
	}
	const harnessWorkerSource = workerSource.replace(
		importSeam,
		`
parentPort.postMessage({
  harnessImported: String(moduleUrl),
  harnessModuleCleared: globalThis.Module === undefined
});
if (harnessMode === 'import-failure') throw new Error('fixture import failure');
if (harnessMode === 'module-replacement') globalThis.Module = { replaced: true };
return { default: globalThis.__createJanetModule };`.trim()
	);
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
  const value = 'blob:wasm-janet-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: value });
  return value;
};
URL.revokeObjectURL = (value) => parentPort.postMessage({ harnessBlobRevoked: value });
globalThis.__createJanetModule = async (options) => {
  parentPort.postMessage({ harnessFactoryModuleCleared: globalThis.Module === undefined });
  if (harnessMode === 'delayed-initialize') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
    for (const value of Buffer.from(
      'main=' + (Number(Buffer.from(input).toString('utf8').trim()) + 5) + '\\n'
    )) {
      writeStdout(value);
    }
    return 0;
  };
  return module;
};
(0, eval)(${JSON.stringify(harnessWorkerSource)});
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
		maxAssetBytes: 8 * 1024 * 1024,
		code: '(getline)',
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
	let closed = false;
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				if (message?.harnessClosed) {
					closed = true;
					if (terminals.length === requests.length) resolve();
					return;
				}
				if (!isTerminal(message)) return;
				terminals.push(message);
				if (terminals.length < requests.length) {
					worker.postMessage(requests[terminals.length]);
				} else if (closed) {
					resolve();
				}
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

describe('Janet runner worker', { timeout: 60_000 }, () => {
	it('keeps the canonical graph, alias, full generated profile, and runner pin current', async () => {
		const source = await readWorkerSource();
		const staticSource = await readFile(staticWorkerUrl, 'utf8');
		const manifest = JSON.parse(deployedManifestBytes.toString('utf8'));

		expect(staticSource).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_JANET_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_JANET_RUNNER_RECEIPT.sha256);
		expect(source).toContain(`profileId: '${WASM_JANET_RUNTIME_PROFILE.profileId}'`);
		expect(source).toContain(
			`artifactRevision: '${WASM_JANET_RUNTIME_PROFILE.artifactRevision}'`
		);
		expect(source).toContain(`janetVersion: '${WASM_JANET_RUNTIME_PROFILE.janetVersion}'`);
		expect(source).toContain(
			`emscriptenVersion: '${WASM_JANET_RUNTIME_PROFILE.emscriptenVersion}'`
		);
		expect(source).toContain(`manifestFingerprint: '${WASM_JANET_ASSET_VERSION}'`);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'janet.js',
			'janet.wasm.gz',
			'janet.wasm.gz.bin',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(JANET_MANIFEST_FORMAT).toBe('wasm-janet-runtime-manifest-v2');
		expect(JANET_FINGERPRINT_DOMAIN).toBe('wasm-idle:janet-runtime-manifest:v2');
		expect(manifest.fingerprint).toBe(WASM_JANET_ASSET_VERSION);
		expect(computeJanetRuntimeFingerprint(manifest)).toBe(WASM_JANET_ASSET_VERSION);
		expect(manifest.storage.map((receipt: { path: string }) => receipt.path)).toEqual([
			'janet.js',
			'janet.wasm.gz.bin'
		]);
		expect(deployedManifestBytes.byteLength).toBe(
			WASM_JANET_RUNTIME_PROFILE.manifestReceipt.bytes
		);
		expect(sha256(deployedManifestBytes)).toBe(
			WASM_JANET_RUNTIME_PROFILE.manifestReceipt.sha256
		);
		const profileReceipts = {
			'janet.js': WASM_JANET_RUNTIME_PROFILE.javascriptReceipt,
			'janet.wasm': WASM_JANET_RUNTIME_PROFILE.wasmReceipt
		};
		for (const storageReceipt of manifest.storage) {
			const stored = await readFile(new URL(storageReceipt.path, staticRuntimeUrl));
			const logical = storageReceipt.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const logicalReceipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storageReceipt.logicalPath
			);
			expect(stored.byteLength).toBe(storageReceipt.size);
			expect(sha256(stored)).toBe(storageReceipt.sha256);
			expect(logical.byteLength).toBe(logicalReceipt.size);
			expect(sha256(logical)).toBe(logicalReceipt.sha256);
			const profileReceipt =
				profileReceipts[storageReceipt.logicalPath as keyof typeof profileReceipts];
			expect(profileReceipt).toEqual(
				storageReceipt.encoding === 'identity'
					? {
							bytes: storageReceipt.size,
							sha256: storageReceipt.sha256
						}
					: {
							bytes: storageReceipt.size,
							sha256: storageReceipt.sha256,
							uncompressedBytes: logicalReceipt.size,
							uncompressedSha256: logicalReceipt.sha256
						}
			);
			if (storageReceipt.path.endsWith('.gz.bin')) {
				expect(
					await readFile(
						new URL(storageReceipt.path.replace(/\.bin$/u, ''), staticRuntimeUrl)
					)
				).toEqual(stored);
			}
		}
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		const runner = await readFile(runnerSourceUrl);
		expect(runner.byteLength).toBe(lock.build.runner.bytes);
		expect(sha256(runner)).toBe(lock.build.runner.sha256);
	});

	it('contains no runtime fetch, URL parsing, or decompression path', async () => {
		const source = await readWorkerSource();
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toContain('new URL(');
		expect(source).not.toContain('DecompressionStream');
		expect(source).not.toContain('manifestUrl');
		expect(source).not.toContain('baseUrl');
	});

	it('verifies the payload before injecting local Wasm into the ESM factory', async () => {
		const messages = await runHarness(executionRequest());

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({ harnessClosed: true });
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
		expect(messages).toContainEqual({
			harnessInjected: {
				wasmPath: 'wasm-idle-verified:janet.wasm',
				undeclaredRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['janet.wasm'])
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
			'profile identity drift',
			() => createRuntimePreflight({ janetVersion: '1.41.2' }),
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
							janet: { ...fixtureManifest.components.janet, version: '1.41.2' }
						}
					}
				),
			'component metadata is invalid'
		],
		[
			'build receipt drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						build: { ...fixtureManifest.build, options: [] }
					}
				),
			'build metadata is invalid'
		],
		[
			'license receipt drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						license: { ...fixtureManifest.license, sha256: '0'.repeat(64) }
					}
				),
			'receipt graph failed fingerprint verification'
		],
		[
			'metadata receipt drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						metadata: { ...fixtureManifest.metadata, sha256: '0'.repeat(64) }
					}
				),
			'receipt graph failed fingerprint verification'
		],
		[
			'storage receipt drift',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						storage: fixtureManifest.storage.map((storage: any, index: number) =>
							index === 0 ? { ...storage, sha256: '0'.repeat(64) } : storage
						)
					}
				),
			'receipt graph failed fingerprint verification'
		],
		[
			'unpinned license field',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						license: { ...fixtureManifest.license, untrusted: true }
					}
				),
			'license receipt is invalid'
		],
		[
			'legacy canonical storage path',
			() =>
				createRuntimePreflight(
					{},
					{
						...fixtureManifest,
						storage: fixtureManifest.storage.map((storage: any) =>
							storage.path === 'janet.wasm.gz.bin'
								? { ...storage, path: 'janet.wasm.gz' }
								: storage
						)
					}
				),
			'unexpected or duplicate storage asset'
		],
		[
			'logical JavaScript corruption',
			() => {
				const bytes = Uint8Array.from(fixtureLogicalBytes['janet.js']);
				bytes[bytes.byteLength - 1] ^= 1;
				return createRuntimePreflight({ javascriptBytes: bytes });
			},
			'failed SHA-256 verification'
		],
		[
			'logical Wasm corruption',
			() => {
				const bytes = Uint8Array.from(fixtureLogicalBytes['janet.wasm']);
				bytes[bytes.byteLength - 1] ^= 1;
				return createRuntimePreflight({ wasmBytes: bytes });
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
		const javascriptBytes = Buffer.from(
			'/* export default Module; callMain; FS.init; Module["wasmBinary"]; replacement */\n',
			'utf8'
		);
		const replacementAssets = fixtureAssets.map((receipt) =>
			receipt.path === 'janet.js'
				? { ...receipt, size: javascriptBytes.byteLength, sha256: sha256(javascriptBytes) }
				: receipt
		);
		const replacementStorage = fixtureStorage.map((receipt) =>
			receipt.logicalPath === 'janet.js'
				? { ...receipt, size: javascriptBytes.byteLength, sha256: sha256(javascriptBytes) }
				: receipt
		);
		const replacementFingerprint = computeJanetRuntimeFingerprint({
			profileId: fixtureManifest.profileId,
			licenseExpression: fixtureManifest.licenseExpression,
			artifact: fixtureManifest.artifact,
			components: fixtureManifest.components,
			build: fixtureManifest.build,
			license: fixtureManifest.license,
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

	it('enforces the hard per-asset byte limit', async () => {
		const messages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					javascriptBytes: new Uint8Array(8 * 1024 * 1024 + 1)
				})
			})
		);
		expect(terminalMessage(messages)?.error).toContain('exceeds its byte limit');
	});

	it('enforces the independent manifest byte limit', async () => {
		const messages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					manifestBytes: new Uint8Array(64 * 1024 + 1)
				})
			})
		);
		expect(terminalMessage(messages)?.error).toContain('exceeds its byte limit');
	});

	it('clears a stale Module while using the local ESM factory and restores it', async () => {
		const messages = await runHarness(executionRequest({ harnessMode: 'stale-module' }));

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({
			harnessImported: expect.any(String),
			harnessModuleCleared: true
		});
		expect(messages).toContainEqual({ harnessFactoryModuleCleared: true });
		expect(messages).toContainEqual({ harnessModuleRestored: true });
	});

	it.each(['import-failure', 'module-replacement'])(
		'revokes the module URL, restores Module, and closes after %s',
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

	it('prints a prompt before consuming live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 64, maxBufferedBytes: 64 });
		let prompted = false;
		let suppliedInput = false;
		const messages = await runHarness(
			executionRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
			(message) => {
				if (message.output?.includes('value?')) prompted = true;
				if (message.type !== 'stdin-request' || suppliedInput) return;
				suppliedInput = true;
				expect(prompted).toBe(true);
				stdin.enqueue('68\n');
				stdin.close();
			}
		);

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
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

		expect(terminalMessage(messages)?.error).toContain('Invalid Janet streaming stdin channel');
		expect(messages.some((message) => message.harnessImported)).toBe(false);
		expect(messages).toContainEqual({ harnessClosed: true });
	});
});
