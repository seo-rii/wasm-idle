// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeJuliaRuntimeFingerprint } from '../../../scripts/sync-wasm-julia.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_JULIA_ASSET_VERSION,
	WASM_JULIA_RUNNER_RECEIPT,
	WASM_JULIA_RUNTIME_PROFILE
} from './wasmJuliaVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-julia-runner-worker.js',
	import.meta.url
);
const lockUrl = new URL('../../../scripts/wasm-julia-assets.lock.json', import.meta.url);
const staticWorkerUrl = new URL('../../../static/wasm-julia/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-julia/', import.meta.url);
const deployedManifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
const deployedManifest = JSON.parse(deployedManifestBytes.toString('utf8'));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const fixtureLogicalBytes = {
	'julia.js': Buffer.from(
		'/* _jl_eval_string; WebAssembly.instantiate; getPreloadedPackage; julia-wasm/julia.wasm; /npm/@chriskoch/julia-wasm/julia.data */\n',
		'utf8'
	),
	'julia.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
	'julia.data': Buffer.from('verified Julia data\n')
};
const fixtureMediaTypes = {
	'julia.js': 'text/javascript',
	'julia.wasm': 'application/wasm',
	'julia.data': 'application/octet-stream'
};
const fixtureStorageBytes = Object.fromEntries(
	Object.entries(fixtureLogicalBytes).map(([logicalPath, bytes]) => [
		`${logicalPath}.gz.bin`,
		gzipSync(bytes, { level: 9 })
	])
) as Record<string, Buffer>;
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path as keyof typeof fixtureMediaTypes],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorage = Object.entries(fixtureStorageBytes).map(([path, bytes]) => ({
	path,
	logicalPath: path.slice(0, -'.gz.bin'.length),
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

function createRuntimePreflight(
	overrides: Record<string, unknown> = {},
	manifest: Record<string, unknown> = fixtureManifest
) {
	return {
		protocol: 'wasm-idle-julia-preflight',
		protocolVersion: 1,
		profileId: WASM_JULIA_RUNTIME_PROFILE.profileId,
		packageRevision: WASM_JULIA_RUNTIME_PROFILE.packageRevision,
		importedByCommit: WASM_JULIA_RUNTIME_PROFILE.importedByCommit,
		juliaVersion: WASM_JULIA_RUNTIME_PROFILE.juliaVersion,
		emscriptenVersion: WASM_JULIA_RUNTIME_PROFILE.emscriptenVersion,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		javascriptBytes: Uint8Array.from(fixtureLogicalBytes['julia.js']),
		wasmBytes: Uint8Array.from(fixtureLogicalBytes['julia.wasm']),
		dataBytes: Uint8Array.from(fixtureLogicalBytes['julia.data']),
		...overrides
	};
}

async function readPublishedWorkerSource(manifestFingerprint = fixtureFingerprint) {
	const source = await readFile(staticWorkerUrl, 'utf8');
	if (manifestFingerprint === WASM_JULIA_ASSET_VERSION) return source;
	const bundledIdentity = `manifestFingerprint: '${WASM_JULIA_ASSET_VERSION}'`;
	if (
		source.indexOf(bundledIdentity) < 0 ||
		source.indexOf(bundledIdentity) !== source.lastIndexOf(bundledIdentity)
	) {
		throw new Error('Julia runner must contain exactly one bundled manifest fingerprint');
	}
	return source.replace(bundledIdentity, `manifestFingerprint: '${manifestFingerprint}'`);
}

async function createHarnessWorker(
	manifestFingerprint = fixtureFingerprint,
	aggregateLimit = 64 * 1024 * 1024
) {
	const publishedWorkerSource = await readPublishedWorkerSource(manifestFingerprint);
	const workerSource = publishedWorkerSource.replace(
		'const hardMaxTotalLogicalBytes = 64 * 1024 * 1024;',
		`const hardMaxTotalLogicalBytes = ${aggregateLimit};`
	);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { createHash, webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
let harnessMode = '';
let blobCounter = 0;
let lastBlob = null;
let staleInstalled = false;
const staleModule = { stale: 'module' };
self.postMessage = (message) => {
  if (staleInstalled && message && (message.results !== undefined || message.error !== undefined)) {
    parentPort.postMessage({ harnessModuleRestored: globalThis.Module === staleModule });
  }
  parentPort.postMessage(message);
};
self.close = () => parentPort.postMessage({ harnessClosed: true });
globalThis.fetch = () => {
  parentPort.postMessage({ harnessFetch: true });
  throw new Error('Julia worker attempted a network request');
};
globalThis.DecompressionStream = class {
  constructor() {
    parentPort.postMessage({ harnessDecompression: true });
    throw new Error('Julia worker attempted decompression');
  }
};
URL.createObjectURL = (blob) => {
  lastBlob = blob;
  const value = 'blob:wasm-julia-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: value, harnessBlobBytes: blob.size, harnessBlobType: blob.type });
  return value;
};
URL.revokeObjectURL = (value) => parentPort.postMessage({ harnessBlobRevoked: value });
globalThis.importScripts = (scriptUrl) => {
  if (!String(scriptUrl).startsWith('blob:wasm-julia-fixture-') || !lastBlob) {
    throw new Error('fixture received an unverified script URL');
  }
  if (harnessMode === 'import-failure') throw new Error('fixture import failure');
  const module = globalThis.Module;
  parentPort.postMessage({ harnessRuntimeModuleIsLocal: module !== staleModule && module !== undefined });
  const wasmPath = module.locateFile('julia-wasm/julia.wasm');
  const dataPath = module.locateFile('https://cdn.jsdelivr.net');
  let undeclaredRejected = false;
  try { module.locateFile('undeclared.bin'); } catch { undeclaredRejected = true; }
  const data = module.getPreloadedPackage(dataPath, ${fixtureLogicalBytes['julia.data'].byteLength});
  parentPort.postMessage({
    harnessInjected: {
      wasmPath,
      dataPath,
      undeclaredRejected,
      wasmSha256: createHash('sha256').update(module.wasmBinary).digest('hex'),
      dataSha256: createHash('sha256').update(Buffer.from(data)).digest('hex')
    }
  });
  if (harnessMode === 'module-replacement') globalThis.Module = { replaced: true };
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
    for (const value of Buffer.from('value?\\n')) module.stdout(value);
    const input = [];
    while (true) {
      const value = module.stdin();
      if (value === null) break;
      if (value !== undefined) input.push(value);
    }
    const parsed = Number(Buffer.from(input).toString('utf8').trim());
    for (const value of Buffer.from('main=' + parsed + '\\n')) module.stdout(value);
  };
  module.onRuntimeInitialized();
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
		maxAssetBytes: 64 * 1024 * 1024,
		code: 'println(readline())',
		stdin: '68\n',
		activePath: 'main.jl',
		...overrides
	};
}

type HarnessMessage = Record<string, any>;
const isTerminal = (message: HarnessMessage) =>
	message?.results !== undefined || message?.error !== undefined;
const terminalMessage = (messages: HarnessMessage[]) => messages.findLast(isTerminal);

async function runHarness(
	request: Record<string, unknown>,
	onMessage: (message: HarnessMessage) => void = () => {},
	aggregateLimit = 64 * 1024 * 1024
) {
	const worker = await createHarnessWorker(fixtureFingerprint, aggregateLimit);
	const messages: HarnessMessage[] = [];
	let terminal = false;
	let closed = false;
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				onMessage(message);
				if (isTerminal(message)) terminal = true;
				if (message.harnessClosed) closed = true;
				if (terminal && closed) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (!terminal || code !== 0)
					reject(new Error(`Julia harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runConcurrent(requests: Record<string, unknown>[]) {
	const worker = await createHarnessWorker();
	const messages: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				if (messages.filter(isTerminal).length === requests.length) resolve();
			});
			worker.once('error', reject);
			for (const request of requests) worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('Julia runner worker', () => {
	it('keeps the canonical graph, legacy aliases, full generated profile, and runner pin current', async () => {
		const source = await readFile(workerSourceUrl, 'utf8');
		const publishedWorker = await readFile(staticWorkerUrl, 'utf8');
		expect(Buffer.byteLength(publishedWorker)).toBe(WASM_JULIA_RUNNER_RECEIPT.bytes);
		expect(sha256(publishedWorker)).toBe(WASM_JULIA_RUNNER_RECEIPT.sha256);
		for (const [key, value] of Object.entries({
			profileId: WASM_JULIA_RUNTIME_PROFILE.profileId,
			packageRevision: WASM_JULIA_RUNTIME_PROFILE.packageRevision,
			importedByCommit: WASM_JULIA_RUNTIME_PROFILE.importedByCommit,
			juliaVersion: WASM_JULIA_RUNTIME_PROFILE.juliaVersion,
			emscriptenVersion: WASM_JULIA_RUNTIME_PROFILE.emscriptenVersion,
			manifestFingerprint: WASM_JULIA_RUNTIME_PROFILE.manifestFingerprint
		})) {
			expect(publishedWorker).toContain(`${key}: '${value}'`);
		}
		expect(source).toContain('__WASM_IDLE_JULIA_MANIFEST_FINGERPRINT__');
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.md',
			'julia.data.gz',
			'julia.data.gz.bin',
			'julia.js.gz',
			'julia.js.gz.bin',
			'julia.wasm.gz',
			'julia.wasm.gz.bin',
			'readme.md',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(deployedManifest.fingerprint).toBe(WASM_JULIA_ASSET_VERSION);
		expect(computeJuliaRuntimeFingerprint(deployedManifest)).toBe(WASM_JULIA_ASSET_VERSION);
		expect(
			deployedManifest.storage.map((entry: { path: string }) => entry.path).sort()
		).toEqual(['julia.data.gz.bin', 'julia.js.gz.bin', 'julia.wasm.gz.bin']);
		const receiptNames = {
			'julia.js': 'javascriptReceipt',
			'julia.wasm': 'wasmReceipt',
			'julia.data': 'dataReceipt'
		} as const;
		for (const storage of deployedManifest.storage) {
			const stored = await readFile(new URL(storage.path, staticRuntimeUrl));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const legacy = await readFile(
				new URL(storage.path.replace(/\.bin$/u, ''), staticRuntimeUrl)
			);
			expect(legacy.byteLength).toBe(stored.byteLength);
			expect(sha256(legacy)).toBe(sha256(stored));
			const logical = gunzipSync(stored);
			const receipt = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
			expect(
				WASM_JULIA_RUNTIME_PROFILE[
					receiptNames[storage.logicalPath as keyof typeof receiptNames]
				]
			).toEqual({
				bytes: storage.size,
				sha256: storage.sha256,
				uncompressedBytes: receipt.size,
				uncompressedSha256: receipt.sha256
			});
		}
		expect(WASM_JULIA_RUNTIME_PROFILE.manifestReceipt).toEqual({
			bytes: deployedManifestBytes.byteLength,
			sha256: sha256(deployedManifestBytes)
		});
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		expect(WASM_JULIA_RUNTIME_PROFILE.packageRevision).toBe(lock.artifact.npmShasum);
		expect(WASM_JULIA_RUNTIME_PROFILE.importedByCommit).toBe(lock.artifact.importedByCommit);
	});

	it('uses only preflighted logical bytes and injects local Wasm/data into verified glue', async () => {
		const messages = await runHarness(executionRequest());

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages.some((message) => message.harnessDecompression)).toBe(false);
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
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
		expect(messages).toContainEqual({ harnessRuntimeModuleIsLocal: true });
		expect(
			String(messages.find((message) => message.harnessRunnerSource)?.harnessRunnerSource)
		).toContain('Base.include_string(Main, "println(readline())", "main.jl")');
		expect(messages.map((message) => message.output || '').join('')).toContain('main=68');
		expect(messages).toContainEqual({ harnessClosed: true });
	});

	it.each([
		['extra payload key', { unexpected: true }, 'invalid shape'],
		['profile identity drift', { packageRevision: '0'.repeat(40) }, 'payload is invalid'],
		[
			'manifest fingerprint drift',
			{ manifestFingerprint: '0'.repeat(64) },
			'payload is invalid'
		],
		['missing JavaScript bytes', { javascriptBytes: undefined }, 'payload is invalid']
	])('rejects %s before runtime evaluation', async (_label, overrides, expectedMessage) => {
		const messages = await runHarness(
			executionRequest({ runtimePreflight: createRuntimePreflight(overrides) })
		);
		expect(String(terminalMessage(messages)?.error)).toContain(expectedMessage);
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it.each([
		['unexpected manifest field', { unexpected: true }, 'schema'],
		[
			'component metadata drift',
			{
				components: {
					...fixtureManifest.components,
					julia: { ...fixtureManifest.components.julia, revision: '0'.repeat(40) }
				}
			},
			'component'
		],
		[
			'legacy canonical storage path',
			{
				storage: fixtureManifest.storage.map((entry: Record<string, unknown>) => ({
					...entry,
					path: String(entry.path).replace(/\.bin$/u, '')
				}))
			},
			'unexpected or duplicate'
		]
	])('rejects %s in the full receipt graph', async (_label, patch, expectedMessage) => {
		const manifest = { ...fixtureManifest, ...patch };
		const messages = await runHarness(
			executionRequest({ runtimePreflight: createRuntimePreflight({}, manifest) })
		);
		expect(String(terminalMessage(messages)?.error)).toContain(expectedMessage);
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it('rejects logical asset replacement before runtime evaluation', async () => {
		const replacement = Uint8Array.from(fixtureLogicalBytes['julia.wasm']);
		replacement[replacement.byteLength - 1] ^= 1;
		const messages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({ wasmBytes: replacement })
			})
		);
		expect(String(terminalMessage(messages)?.error)).toContain('SHA-256');
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it('rejects a self-consistent executable replacement against the embedded fingerprint pin', async () => {
		const replacementLogicalBytes = {
			...fixtureLogicalBytes,
			'julia.js': Buffer.from(
				`${fixtureLogicalBytes['julia.js'].toString('utf8')}/* replacement */\n`,
				'utf8'
			)
		};
		const replacementAssets = Object.entries(replacementLogicalBytes).map(([path, bytes]) => ({
			path,
			mediaType: fixtureMediaTypes[path as keyof typeof fixtureMediaTypes],
			size: bytes.byteLength,
			sha256: sha256(bytes)
		}));
		const replacementStorage = Object.entries(replacementLogicalBytes).map(
			([logicalPath, bytes]) => {
				const stored = gzipSync(bytes, { level: 9 });
				return {
					path: `${logicalPath}.gz.bin`,
					logicalPath,
					encoding: 'gzip' as const,
					size: stored.byteLength,
					sha256: sha256(stored)
				};
			}
		);
		const replacementFingerprint = computeJuliaRuntimeFingerprint({
			profileId: deployedManifest.profileId,
			licenseExpression: deployedManifest.licenseExpression,
			artifact: deployedManifest.artifact,
			components: deployedManifest.components,
			license: deployedManifest.license,
			documentation: deployedManifest.documentation,
			metadata: deployedManifest.metadata,
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
						javascriptBytes: Uint8Array.from(replacementLogicalBytes['julia.js'])
					},
					replacementManifest
				)
			})
		);
		expect(String(terminalMessage(messages)?.error)).toContain('payload is invalid');
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
	});

	it('enforces independent manifest and aggregate logical byte caps', async () => {
		const manifestMessages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					manifestBytes: new Uint8Array(64 * 1024 + 1)
				})
			})
		);
		expect(String(terminalMessage(manifestMessages)?.error)).toContain(
			'exceeds its byte limit'
		);

		const aggregateMessages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					dataBytes: new Uint8Array(256)
				})
			}),
			undefined,
			256
		);
		expect(String(terminalMessage(aggregateMessages)?.error)).toContain('aggregate byte limit');
	});

	it('clears stale Module, retains a verified local reference, and restores it', async () => {
		const messages = await runHarness(executionRequest({ harnessMode: 'stale-module' }));
		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({ harnessRuntimeModuleIsLocal: true });
		expect(messages).toContainEqual({ harnessModuleRestored: true });
	});

	it.each(['import-failure', 'module-replacement'])(
		'revokes the Blob URL, restores Module, and closes after %s',
		async (harnessMode) => {
			const messages = await runHarness(executionRequest({ harnessMode }));
			expect(String(terminalMessage(messages)?.error)).toMatch(
				/fixture import failure|Module changed/u
			);
			expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
			expect(messages).toContainEqual({ harnessModuleRestored: true });
			expect(messages).toContainEqual({ harnessClosed: true });
		}
	);

	it('reserves the one-shot request before awaiting verification', async () => {
		const messages = await runConcurrent([
			executionRequest({
				runtimePreflight: createRuntimePreflight({
					manifestBytes: Uint8Array.from(Buffer.from('{'))
				})
			}),
			executionRequest()
		]);
		const terminals = messages.filter(isTerminal);
		expect(
			terminals.some((message) => String(message.error).includes('not valid UTF-8 JSON'))
		).toBe(true);
		expect(
			terminals.some((message) => String(message.error).includes('accepts exactly one run'))
		).toBe(true);
	});

	it('prints before consuming live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 64, maxBufferedBytes: 64 });
		let output = '';
		let requestedAfterPrompt = false;
		let supplied = false;
		const messages = await runHarness(
			executionRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
			(message) => {
				output += String(message.output || '');
				if (message.type !== 'stdin-request' || supplied) return;
				supplied = true;
				requestedAfterPrompt = output.includes('value?');
				stdin.enqueue('68\n');
				stdin.close();
			}
		);
		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(requestedAfterPrompt).toBe(true);
		expect(output).toContain('main=68');
	});

	it('fails malformed shared stdin before runtime evaluation', async () => {
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
		expect(String(terminalMessage(messages)?.error)).toContain(
			'Invalid Julia streaming stdin channel'
		);
		expect(messages.some((message) => message.harnessBlobCreated)).toBe(false);
		expect(messages).toContainEqual({ harnessClosed: true });
	});
});
