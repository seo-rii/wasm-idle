// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeNimRuntimeFingerprint } from '../../../scripts/sync-wasm-nim.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_NIM_ASSET_VERSION,
	WASM_NIM_RUNNER_RECEIPT,
	WASM_NIM_RUNTIME_BUNDLE,
	WASM_NIM_RUNTIME_PROFILE
} from './wasmNimVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-nim-runner-worker.js',
	import.meta.url
);
const lockUrl = new URL('../../../scripts/wasm-nim-assets.lock.json', import.meta.url);
const staticWorkerUrl = new URL('../../../static/wasm-nim/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-nim/', import.meta.url);
const deployedManifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
const deployedManifest = JSON.parse(deployedManifestBytes.toString('utf8'));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

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
const storageConfig = {
	'nim/nim-bundle.js': { path: 'nim/nim-bundle.js.gz.bin', encoding: 'gzip' },
	'nim/nim.wasm': { path: 'nim/nim.wasm.gz.bin', encoding: 'gzip' },
	'nim/nimbase.h': { path: 'nim/nimbase.h.bin', encoding: 'identity' },
	'clang/clang.js': { path: 'clang/clang.js.bin', encoding: 'identity' },
	'clang/clang.wasm': { path: 'clang/clang.wasm.gz.bin', encoding: 'gzip' },
	'clang/lld.wasm': { path: 'clang/lld.wasm.gz.bin', encoding: 'gzip' },
	'clang/memfs.wasm': { path: 'clang/memfs.wasm.gz.bin', encoding: 'gzip' },
	'clang/sysroot.tar': { path: 'clang/sysroot.tar.gz.bin', encoding: 'gzip' }
} as const;
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorageBytes = Object.fromEntries(
	Object.entries(fixtureLogicalBytes).map(([logicalPath, bytes]) => {
		const config = storageConfig[logicalPath as keyof typeof storageConfig];
		return [config.path, config.encoding === 'gzip' ? gzipSync(bytes, { level: 9 }) : bytes];
	})
) as Record<string, Buffer>;
const fixtureStorage = Object.entries(storageConfig).map(([logicalPath, config]) => {
	const bytes = fixtureStorageBytes[config.path];
	return {
		path: config.path,
		logicalPath,
		encoding: config.encoding,
		size: bytes.byteLength,
		sha256: sha256(bytes)
	};
});
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

function createRuntimePreflight(
	overrides: Record<string, unknown> = {},
	manifest: Record<string, unknown> = fixtureManifest
) {
	return {
		protocol: 'wasm-idle-nim-preflight',
		protocolVersion: 1,
		profileId: WASM_NIM_RUNTIME_PROFILE.profileId,
		artifactRevision: WASM_NIM_RUNTIME_PROFILE.artifactRevision,
		nimRevision: WASM_NIM_RUNTIME_PROFILE.nimRevision,
		llvmRevision: WASM_NIM_RUNTIME_PROFILE.llvmRevision,
		memfsRevision: WASM_NIM_RUNTIME_PROFILE.memfsRevision,
		emscriptenRevision: WASM_NIM_RUNTIME_PROFILE.emscriptenRevision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		nimJavaScriptBytes: Uint8Array.from(fixtureLogicalBytes['nim/nim-bundle.js']),
		nimWasmBytes: Uint8Array.from(fixtureLogicalBytes['nim/nim.wasm']),
		nimbaseBytes: Uint8Array.from(fixtureLogicalBytes['nim/nimbase.h']),
		clangJavaScriptBytes: Uint8Array.from(fixtureLogicalBytes['clang/clang.js']),
		clangWasmBytes: Uint8Array.from(fixtureLogicalBytes['clang/clang.wasm']),
		lldWasmBytes: Uint8Array.from(fixtureLogicalBytes['clang/lld.wasm']),
		memfsWasmBytes: Uint8Array.from(fixtureLogicalBytes['clang/memfs.wasm']),
		sysrootBytes: Uint8Array.from(fixtureLogicalBytes['clang/sysroot.tar']),
		...overrides
	};
}

async function readPublishedWorkerSource(manifestFingerprint = fixtureFingerprint) {
	const source = await readFile(staticWorkerUrl, 'utf8');
	if (manifestFingerprint === WASM_NIM_ASSET_VERSION) return source;
	const bundledIdentity = `manifestFingerprint: '${WASM_NIM_ASSET_VERSION}'`;
	if (
		source.indexOf(bundledIdentity) < 0 ||
		source.indexOf(bundledIdentity) !== source.lastIndexOf(bundledIdentity)
	) {
		throw new Error('Nim runner must contain exactly one bundled manifest fingerprint');
	}
	return source.replace(bundledIdentity, `manifestFingerprint: '${manifestFingerprint}'`);
}

async function createIntegrityHarnessWorker(
	manifestFingerprint = fixtureFingerprint,
	aggregateLimit = 96 * 1024 * 1024
) {
	const publishedWorkerSource = await readPublishedWorkerSource(manifestFingerprint);
	const workerSource = publishedWorkerSource.replace(
		'const hardMaxTotalLogicalBytes = 96 * 1024 * 1024;',
		`const hardMaxTotalLogicalBytes = ${aggregateLimit};`
	);
	const handler = `
self.onmessage = async (event) => {
  try {
    const verified = await verifyRuntimePreflight(
      event.data?.runtimePreflight,
      event.data?.maxAssetBytes
    );
    const assetPath = event.data?.assetPath || 'nim/nim.wasm';
    const bytes = verified.take(assetPath);
    if (event.data?.takeTwice) verified.take(assetPath);
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
self.close = () => parentPort.postMessage({ harnessClosed: true });
globalThis.fetch = () => {
  parentPort.postMessage({ harnessFetch: true });
  throw new Error('Nim worker attempted a network request');
};
globalThis.DecompressionStream = class {
  constructor() {
    parentPort.postMessage({ harnessDecompression: true });
    throw new Error('Nim worker attempted decompression');
  }
};
(0, eval)(${JSON.stringify(workerSource + handler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function createStdinHarnessWorker() {
	const workerSource = await readFile(workerSourceUrl, 'utf8');
	const handler = `
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
(0, eval)(${JSON.stringify(workerSource + handler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function createGlobalCleanupHarnessWorker() {
	const workerSource = await readFile(workerSourceUrl, 'utf8');
	const handler = `
self.onmessage = () => {
  try {
    const stale = { stale: true };
    for (const name of runtimeGlobalNames) {
      Object.defineProperty(globalThis, name, {
        value: stale,
        configurable: true,
        writable: true
      });
    }
    const snapshot = snapshotRuntimeGlobals();
    clearRuntimeGlobals();
    const cleared = runtimeGlobalNames.every((name) => globalThis[name] === undefined);
    for (const name of runtimeGlobalNames) globalThis[name] = { replacement: true };
    restoreRuntimeGlobals(snapshot);
    const restored = runtimeGlobalNames.every((name) => globalThis[name] === stale);
    self.postMessage({ results: true, cleared, restored });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource + handler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function createOneShotHarnessWorker() {
	const workerSource = await readPublishedWorkerSource();
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.close = () => parentPort.postMessage({ harnessClosed: true });
(0, eval)(${JSON.stringify(workerSource)});
verifyRuntimePreflight = async () => {
  parentPort.postMessage({ harnessVerificationStarted: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {};
};
runVerifiedNim = async () => ({ code: 0 });
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

type HarnessMessage = Record<string, any>;
const isTerminal = (message: HarnessMessage) =>
	message?.results !== undefined || message?.error !== undefined;
const terminalMessage = (messages: HarnessMessage[]) => messages.findLast(isTerminal);

async function runHarness(
	createWorker: () => Promise<NodeWorker>,
	request: Record<string, unknown>,
	onMessage: (message: HarnessMessage) => void = () => {}
) {
	const worker = await createWorker();
	const messages: HarnessMessage[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				onMessage(message);
				if (isTerminal(message)) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (!messages.some(isTerminal) || code !== 0) {
					reject(new Error(`Nim worker harness exited with code ${code}`));
				}
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
		runtimePreflight: createRuntimePreflight(),
		maxAssetBytes: 40 * 1024 * 1024,
		assetPath: 'nim/nim.wasm',
		...overrides
	};
}

async function runOneShotHarness() {
	const worker = await createOneShotHarnessWorker();
	const messages: HarnessMessage[] = [];
	let sentSecond = false;
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message: HarnessMessage) => {
				messages.push(message);
				if (message.harnessVerificationStarted && !sentSecond) {
					sentSecond = true;
					worker.postMessage({ code: 'second', stdin: '', activePath: 'main.nim' });
				}
				if (
					messages.filter(isTerminal).length === 2 &&
					messages.some((candidate) => candidate.harnessClosed)
				) {
					resolve();
				}
			});
			worker.once('error', reject);
			worker.postMessage({ code: 'first', stdin: '', activePath: 'main.nim' });
		});
		return messages;
	} finally {
		await worker.terminate();
	}
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

describe('Nim runner worker', () => {
	it('keeps the canonical graph, legacy aliases, full profile, and runner pin current', async () => {
		const source = await readFile(workerSourceUrl, 'utf8');
		const publishedWorker = await readFile(staticWorkerUrl, 'utf8');
		expect(Buffer.byteLength(publishedWorker)).toBe(WASM_NIM_RUNNER_RECEIPT.bytes);
		expect(sha256(publishedWorker)).toBe(WASM_NIM_RUNNER_RECEIPT.sha256);
		expect(WASM_NIM_RUNTIME_BUNDLE).toEqual({
			profile: WASM_NIM_RUNTIME_PROFILE,
			workerReceipt: WASM_NIM_RUNNER_RECEIPT
		});
		for (const [key, value] of Object.entries({
			profileId: WASM_NIM_RUNTIME_PROFILE.profileId,
			artifactRevision: WASM_NIM_RUNTIME_PROFILE.artifactRevision,
			nimRevision: WASM_NIM_RUNTIME_PROFILE.nimRevision,
			llvmRevision: WASM_NIM_RUNTIME_PROFILE.llvmRevision,
			memfsRevision: WASM_NIM_RUNTIME_PROFILE.memfsRevision,
			emscriptenRevision: WASM_NIM_RUNTIME_PROFILE.emscriptenRevision,
			manifestFingerprint: WASM_NIM_RUNTIME_PROFILE.manifestFingerprint
		})) {
			expect(publishedWorker).toContain(`${key}: '${value}'`);
		}
		expect(source).toContain('__WASM_IDLE_NIM_MANIFEST_FINGERPRINT__');
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toContain('DecompressionStream');
		expect(await listFiles(staticRuntimeUrl)).toEqual([
			'LICENSE',
			'README.md',
			'THIRD_PARTY_NOTICES.md',
			'clang/clang.js',
			'clang/clang.js.bin',
			'clang/clang.wasm.gz',
			'clang/clang.wasm.gz.bin',
			'clang/lld.wasm.gz',
			'clang/lld.wasm.gz.bin',
			'clang/memfs.wasm.gz',
			'clang/memfs.wasm.gz.bin',
			'clang/sysroot.tar.gz',
			'clang/sysroot.tar.gz.bin',
			'nim/nim-bundle.js.gz',
			'nim/nim-bundle.js.gz.bin',
			'nim/nim.wasm.gz',
			'nim/nim.wasm.gz.bin',
			'nim/nimbase.h',
			'nim/nimbase.h.bin',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(deployedManifest.fingerprint).toBe(WASM_NIM_ASSET_VERSION);
		expect(computeNimRuntimeFingerprint(deployedManifest)).toBe(WASM_NIM_ASSET_VERSION);
		const receiptNames = {
			'nim/nim-bundle.js': 'nimJavaScriptReceipt',
			'nim/nim.wasm': 'nimWasmReceipt',
			'nim/nimbase.h': 'nimbaseReceipt',
			'clang/clang.js': 'clangJavaScriptReceipt',
			'clang/clang.wasm': 'clangWasmReceipt',
			'clang/lld.wasm': 'lldWasmReceipt',
			'clang/memfs.wasm': 'memfsWasmReceipt',
			'clang/sysroot.tar': 'sysrootReceipt'
		} as const;
		for (const storage of deployedManifest.storage) {
			expect(storage.path.endsWith('.bin')).toBe(true);
			const stored = await readFile(new URL(storage.path, staticRuntimeUrl));
			const legacy = await readFile(
				new URL(storage.path.replace(/\.bin$/u, ''), staticRuntimeUrl)
			);
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			expect(legacy.byteLength).toBe(stored.byteLength);
			expect(sha256(legacy)).toBe(sha256(stored));
			const logical = storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = deployedManifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
			const profileReceipt =
				WASM_NIM_RUNTIME_PROFILE[
					receiptNames[storage.logicalPath as keyof typeof receiptNames]
				];
			expect(profileReceipt).toEqual(
				storage.encoding === 'gzip'
					? {
							bytes: storage.size,
							sha256: storage.sha256,
							uncompressedBytes: receipt.size,
							uncompressedSha256: receipt.sha256
						}
					: { bytes: receipt.size, sha256: receipt.sha256 }
			);
		}
		expect(WASM_NIM_RUNTIME_PROFILE.manifestReceipt).toEqual({
			bytes: deployedManifestBytes.byteLength,
			sha256: sha256(deployedManifestBytes)
		});
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		expect(WASM_NIM_RUNTIME_PROFILE.artifactRevision).toBe(lock.artifact.revision);
		expect(WASM_NIM_RUNTIME_PROFILE.nimRevision).toBe(lock.components.nim.revision);
		expect(WASM_NIM_RUNTIME_PROFILE.llvmRevision).toBe(lock.components.llvm.revision);
		expect(WASM_NIM_RUNTIME_PROFILE.memfsRevision).toBe(lock.components.memfs.revision);
		expect(WASM_NIM_RUNTIME_PROFILE.emscriptenRevision).toBe(
			lock.components.emscripten.revision
		);
	}, 30_000);

	it('verifies only preflighted logical bytes without worker fetch or decompression', async () => {
		const messages = await runHarness(createIntegrityHarnessWorker, integrityRequest());
		expect(terminalMessage(messages)).toEqual({
			results: true,
			assetPath: 'nim/nim.wasm',
			bytes: fixtureLogicalBytes['nim/nim.wasm'].byteLength,
			sha256: sha256(fixtureLogicalBytes['nim/nim.wasm'])
		});
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages.some((message) => message.harnessDecompression)).toBe(false);
	});

	it.each([
		['extra payload key', { unexpected: true }, 'invalid shape'],
		['profile identity drift', { llvmRevision: '0'.repeat(40) }, 'payload is invalid'],
		[
			'manifest fingerprint drift',
			{ manifestFingerprint: '0'.repeat(64) },
			'payload is invalid'
		],
		['missing Nim bytes', { nimWasmBytes: undefined }, 'payload is invalid']
	])('rejects %s before asset consumption', async (_label, overrides, expectedMessage) => {
		const messages = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ runtimePreflight: createRuntimePreflight(overrides) })
		);
		expect(String(terminalMessage(messages)?.error)).toContain(expectedMessage);
	});

	it.each([
		['unexpected manifest field', { unexpected: true }, 'schema'],
		[
			'component metadata drift',
			{
				components: {
					...fixtureManifest.components,
					nim: { ...fixtureManifest.components.nim, revision: '0'.repeat(40) }
				}
			},
			'component'
		],
		[
			'legacy storage paths',
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
			createIntegrityHarnessWorker,
			integrityRequest({ runtimePreflight: createRuntimePreflight({}, manifest) })
		);
		expect(String(terminalMessage(messages)?.error)).toContain(expectedMessage);
	});

	it('rejects logical replacement and repeated asset consumption', async () => {
		const replacement = Uint8Array.from(fixtureLogicalBytes['nim/nim.wasm']);
		replacement[replacement.byteLength - 1] ^= 1;
		const tampered = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({
				runtimePreflight: createRuntimePreflight({ nimWasmBytes: replacement })
			})
		);
		expect(String(terminalMessage(tampered)?.error)).toContain('SHA-256');

		const repeated = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ takeTwice: true })
		);
		expect(String(terminalMessage(repeated)?.error)).toContain('already consumed');
	});

	it('enforces the manifest, per-asset, and aggregate hard caps', async () => {
		const manifestLimited = await runHarness(
			createIntegrityHarnessWorker,
			integrityRequest({ maxAssetBytes: 1 })
		);
		expect(String(terminalMessage(manifestLimited)?.error)).toContain('byte limit');

		const aggregateLimited = await runHarness(
			() => createIntegrityHarnessWorker(fixtureFingerprint, 1),
			integrityRequest()
		);
		expect(String(terminalMessage(aggregateLimited)?.error)).toContain('aggregate');
	});

	it('reserves the one-shot request before verification awaits and closes after the run', async () => {
		const messages = await runOneShotHarness();
		expect(messages.filter(isTerminal)).toEqual(
			expect.arrayContaining([
				{ error: 'Nim worker accepts exactly one run.' },
				{ results: true }
			])
		);
		expect(messages).toContainEqual({ harnessClosed: true });
	});

	it('clears stale runtime globals and restores them after verified evaluation', async () => {
		const messages = await runHarness(createGlobalCleanupHarnessWorker, {});
		expect(terminalMessage(messages)).toEqual({
			results: true,
			cleared: true,
			restored: true
		});
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
		expect(terminalMessage(messages)).toEqual({ results: true });
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
