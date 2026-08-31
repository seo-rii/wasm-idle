// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { renderAwkRunnerWorker } from '../../../scripts/sync-wasm-awk.mjs';
import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_AWK_ASSET_VERSION, WASM_AWK_RUNTIME_PROFILE } from './wasmAwkVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-awk-runner-worker.js',
	import.meta.url
);
const legacyWorkerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-awk-runner-worker.v1.js',
	import.meta.url
);
const staticLegacyWorkerUrl = new URL('../../../static/wasm-awk/runner-worker.js', import.meta.url);
const staticVerifiedWorkerUrl = new URL(
	'../../../static/wasm-awk/runner-worker.v2.js',
	import.meta.url
);
const staticRuntimeUrl = new URL('../../../static/wasm-awk/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function readRuntimeFile(fileName: string) {
	return readFile(new URL(fileName, staticRuntimeUrl)).catch(
		async (error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
			return gunzipSync(await readFile(new URL(`${fileName}.gz`, staticRuntimeUrl)));
		}
	);
}

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = (event) => {
  try {
    const stdin = createStdinReader(event.data?.stdin || '', event.data?.stdinChannel);
    const output = createOutputSink((text) => self.postMessage({ output: text }));
    output.write(new TextEncoder().encode('value?\\n'));
    const input = new TextDecoder().decode(stdin.read(32)).trim();
    output.write(new TextEncoder().encode('main=' + input + '\\n'));
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
				if (code !== 0) reject(new Error(`GoAWK worker harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function createRuntimeHarnessWorker(expectedBytes = fixtureRuntimeBytes()) {
	const { goShimBytes, wasmBytes } = expectedBytes;
	const workerSource = renderAwkRunnerWorker(Buffer.from(await readWorkerSource()), {
		profileId: 'goawk-fixture-go1.25.3',
		goShimReceipt: { bytes: goShimBytes.byteLength, sha256: sha256(goShimBytes) },
		logicalWasmReceipt: { bytes: wasmBytes.byteLength, sha256: sha256(wasmBytes) }
	}).toString('utf8');
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
const fixtureSideEffects = { blob: 0, digest: 0, importScripts: 0, instantiate: 0 };
self.postMessage = (message) => parentPort.postMessage(
  message?.results !== undefined || message?.error !== undefined
    ? { ...message, fixtureSideEffects: { ...fixtureSideEffects } }
    : message
);
Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: {
      digest: async (...args) => {
        fixtureSideEffects.digest += 1;
        return webcrypto.subtle.digest(...args);
      }
    }
  },
  configurable: true
});
let activeBlob;
globalThis.Blob = class FixtureBlob {
  constructor(parts) {
    fixtureSideEffects.blob += 1;
    this.parts = parts;
  }
};
globalThis.URL = class FixtureURL {};
URL.createObjectURL = (blob) => {
  activeBlob = blob;
  return 'blob:wasm-idle-awk-fixture';
};
URL.revokeObjectURL = (url) => {
  if (url !== 'blob:wasm-idle-awk-fixture') throw new Error('unexpected Blob URL');
};
globalThis.importScripts = (url) => {
  fixtureSideEffects.importScripts += 1;
  if (url !== 'blob:wasm-idle-awk-fixture' || !activeBlob) {
    throw new Error('Go shim was not loaded from the supplied Blob');
  }
  const bytes = activeBlob.parts[0];
  (0, eval)(new TextDecoder().decode(bytes));
};
Object.defineProperty(globalThis, 'fetch', {
  value: () => { throw new Error('unguarded fixture network access'); },
  writable: true,
  configurable: true
});
for (const name of ['Cache', 'CacheStorage', 'WebSocketStream']) {
  Object.defineProperty(globalThis, name, {
    value: class UnguardedFixtureNetworkGlobal {},
    writable: true,
    configurable: true
  });
}
Object.defineProperty(globalThis, 'caches', {
  value: { open: async () => ({ unguarded: true }) },
  writable: true,
  configurable: true
});
globalThis.WebAssembly = {
  instantiate: async (bytes, importObject) => {
    fixtureSideEffects.instantiate += 1;
    if (!(bytes instanceof Uint8Array) || bytes[0] !== 0 || bytes[1] !== 0x61) {
      throw new Error('unexpected Wasm payload');
    }
    if (!importObject || importObject.fixture !== true) throw new Error('unexpected imports');
    return { instance: { fixture: true } };
  }
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

function fixtureRuntimeBytes() {
	const goShimBytes = new TextEncoder().encode(`
const fixtureNetworkAttempts = [
  () => fetch('https://attacker.invalid/'),
  () => new Cache(),
  () => new CacheStorage(),
  () => caches.open('fixture-cache'),
  () => new WebSocketStream('wss://attacker.invalid/')
];
let fixtureBlockedNetworkGlobals = 0;
for (const attempt of fixtureNetworkAttempts) {
  try {
    attempt();
  } catch {
    fixtureBlockedNetworkGlobals += 1;
  }
}
if (fixtureBlockedNetworkGlobals !== fixtureNetworkAttempts.length) {
  throw new Error('network globals were not denied before the shim');
}
for (const name of ['Cache', 'CacheStorage', 'WebSocketStream', 'caches', 'fetch']) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!descriptor || descriptor.configurable || descriptor.writable) {
    throw new Error('network guards were mutable during shim evaluation');
  }
}
globalThis.Go = class FixtureGo {
  constructor() { this.importObject = { fixture: true }; }
  async run(instance) {
    if (!instance?.fixture) throw new Error('unexpected instance');
    globalThis.wasmIdleRunAwk = (code, stdin, args) => ({
      stdout: code + '|' + stdin + '|' + args.join(','),
      stderr: '',
      status: 0
    });
  }
};
`);
	const wasmBytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
	return { goShimBytes, wasmBytes };
}

function lspRunRequest(
	goShimBytes: Uint8Array,
	wasmBytes: Uint8Array,
	overrides: Record<string, unknown> = {}
) {
	return {
		run: true,
		runtimePreflight: {
			protocol: 'wasm-idle-awk-runtime-v2',
			goShimBytes,
			wasmBytes
		},
		code: '{ print $0 }',
		activePath: 'main.awk',
		args: ['demo=1'],
		stdin: 'ok\n',
		diagnose: true,
		log: false,
		...overrides
	};
}

function appRunRequest(goShimBytes: Uint8Array, wasmBytes: Uint8Array) {
	return {
		run: true,
		runId: 'static-1',
		baseUrl: 'https://attacker.invalid/runtime/',
		manifestUrl: 'https://attacker.invalid/runtime/runtime-manifest.v2.json',
		manifestFingerprint: '0'.repeat(64),
		runtimePreflight: {
			protocol: 'wasm-idle-awk-runtime-v2',
			goShimBytes,
			wasmBytes
		},
		maxAssetBytes: 5_000_000,
		code: '{ print $0 }',
		args: ['demo=1'],
		stdin: 'ok\n',
		stdinEof: true,
		activePath: 'main.awk',
		workspaceFiles: [],
		log: false
	};
}

async function runRuntimeHarness(
	request: Record<string, unknown>,
	expectedBytes?: ReturnType<typeof fixtureRuntimeBytes>
) {
	const worker = await createRuntimeHarnessWorker(expectedBytes);
	const messages: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				messages.push(message);
				if (message?.results !== undefined || message?.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

describe('GoAWK runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const manifestSource = await readFile(
			new URL('runtime-manifest.v2.json', staticRuntimeUrl),
			'utf8'
		);
		const manifest = JSON.parse(manifestSource);
		const legacyManifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		expect(legacyManifest.fingerprint).toBe('b11561dac5f0cff1');
		const renderedSource = renderAwkRunnerWorker(Buffer.from(await readWorkerSource()), {
			profileId: manifest.profileId,
			goShimReceipt: manifest.assets.goShim,
			logicalWasmReceipt: {
				bytes: manifest.assets.wasm.uncompressedBytes,
				sha256: manifest.assets.wasm.uncompressedSha256
			}
		}).toString('utf8');
		expect(await readFile(staticVerifiedWorkerUrl, 'utf8')).toBe(renderedSource);
		expect(await readFile(staticLegacyWorkerUrl)).toEqual(
			await readFile(legacyWorkerSourceUrl)
		);
		const workerBytes = await readRuntimeFile(manifest.assets.worker.path);
		const goShimBytes = await readRuntimeFile(manifest.assets.goShim.path);
		const storedWasmBytes = await readRuntimeFile(manifest.assets.wasm.path);
		const logicalWasmBytes = gunzipSync(storedWasmBytes);
		expect({
			path: manifest.assets.worker.path,
			bytes: workerBytes.byteLength,
			sha256: sha256(workerBytes)
		}).toEqual(manifest.assets.worker);
		expect({
			path: manifest.assets.goShim.path,
			bytes: goShimBytes.byteLength,
			sha256: sha256(goShimBytes)
		}).toEqual(manifest.assets.goShim);
		expect({
			path: manifest.assets.wasm.path,
			bytes: storedWasmBytes.byteLength,
			sha256: sha256(storedWasmBytes),
			uncompressedBytes: logicalWasmBytes.byteLength,
			uncompressedSha256: sha256(logicalWasmBytes)
		}).toEqual(manifest.assets.wasm);
		expect(await readRuntimeFile('goawk.wasm.gz')).toEqual(storedWasmBytes);
		expect(WASM_AWK_RUNTIME_PROFILE).toEqual({
			profileId: manifest.profileId,
			goVersion: manifest.goVersion,
			goawkVersion: manifest.goawkVersion,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: Buffer.byteLength(manifestSource),
				sha256: sha256(Buffer.from(manifestSource))
			},
			workerReceipt: {
				bytes: manifest.assets.worker.bytes,
				sha256: manifest.assets.worker.sha256
			},
			goShimReceipt: {
				bytes: manifest.assets.goShim.bytes,
				sha256: manifest.assets.goShim.sha256
			},
			wasmReceipt: {
				bytes: manifest.assets.wasm.bytes,
				sha256: manifest.assets.wasm.sha256,
				uncompressedBytes: manifest.assets.wasm.uncompressedBytes,
				uncompressedSha256: manifest.assets.wasm.uncompressedSha256
			}
		});
		expect(manifest.fingerprint).toBe(WASM_AWK_ASSET_VERSION);
	}, 60_000);

	it('denies fetch, Cache API, and WebSocketStream before loading the supplied shim', async () => {
		const { goShimBytes, wasmBytes } = fixtureRuntimeBytes();
		const messages = await runRuntimeHarness(lspRunRequest(goShimBytes, wasmBytes));

		expect(messages).toEqual([
			{ output: '{ print $0 }|ok\n|demo=1' },
			{
				results: true,
				fixtureSideEffects: { blob: 1, digest: 2, importScripts: 1, instantiate: 1 }
			}
		]);
		const source = await readWorkerSource();
		expect(source).not.toContain('fetch(');
		expect(source).toContain("'CacheStorage'");
		expect(source).toContain("'WebSocketStream'");
		expect(source).toContain("Object.defineProperty(globalThis, 'caches'");
		expect(source).toContain('new Blob([goShimBytes]');
		expect(source).toContain('WebAssembly.instantiate(wasmBytes');
	});

	it('fails closed on extra or missing runtime preflight fields before loading a shim', async () => {
		const { goShimBytes, wasmBytes } = fixtureRuntimeBytes();
		const messages = await runRuntimeHarness(
			lspRunRequest(goShimBytes, wasmBytes, {
				runtimePreflight: {
					protocol: 'wasm-idle-awk-runtime-v2',
					goShimBytes,
					wasmBytes,
					baseUrl: 'https://attacker.invalid/'
				}
			})
		);

		expect(messages).toEqual([
			{
				error: 'Invalid GoAWK runtime preflight payload.',
				fixtureSideEffects: { blob: 0, digest: 0, importScripts: 0, instantiate: 0 }
			}
		]);
	});

	it('accepts the exact application envelope while keeping its URL fields inert', async () => {
		const { goShimBytes, wasmBytes } = fixtureRuntimeBytes();
		const messages = await runRuntimeHarness(appRunRequest(goShimBytes, wasmBytes));

		expect(messages.at(-1)).toEqual({
			results: true,
			fixtureSideEffects: { blob: 1, digest: 2, importScripts: 1, instantiate: 1 }
		});
	});

	it('rejects unknown outer-envelope keys before hashing or loading runtime bytes', async () => {
		const { goShimBytes, wasmBytes } = fixtureRuntimeBytes();
		const messages = await runRuntimeHarness(
			lspRunRequest(goShimBytes, wasmBytes, { unexpectedUrl: 'https://attacker.invalid/' })
		);

		expect(messages).toEqual([
			{
				error: 'Invalid GoAWK run request envelope.',
				fixtureSideEffects: { blob: 0, digest: 0, importScripts: 0, instantiate: 0 }
			}
		]);
	});

	it('rehashes same-length shim and Wasm payloads before any executable side effect', async () => {
		const expectedBytes = fixtureRuntimeBytes();
		const alteredShim = Uint8Array.from(expectedBytes.goShimBytes);
		alteredShim[alteredShim.byteLength - 1] ^= 0x01;
		const alteredWasm = Uint8Array.from(expectedBytes.wasmBytes);
		alteredWasm[alteredWasm.byteLength - 1] ^= 0x01;

		await expect(
			runRuntimeHarness(lspRunRequest(alteredShim, expectedBytes.wasmBytes), expectedBytes)
		).resolves.toEqual([
			{
				error: 'GoAWK Go shim does not match the baked SHA-256 receipt.',
				fixtureSideEffects: { blob: 0, digest: 1, importScripts: 0, instantiate: 0 }
			}
		]);
		await expect(
			runRuntimeHarness(lspRunRequest(expectedBytes.goShimBytes, alteredWasm), expectedBytes)
		).resolves.toEqual([
			{
				error: 'GoAWK logical Wasm does not match the baked SHA-256 receipt.',
				fixtureSideEffects: { blob: 0, digest: 2, importScripts: 0, instantiate: 0 }
			}
		]);
	});

	it('streams a prompt before consuming currently available UTF-8 input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness({ stdinChannel: stdin.descriptor }, (message) => {
			if (message?.output?.includes('value?') && !suppliedInput) {
				suppliedInput = true;
				setTimeout(() => {
					stdin.enqueue('안녕\r\n');
					stdin.close();
				}, 10);
			}
		});

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=안녕'))
		);
		expect(messages.some((message) => message?.output?.includes('main=안녕'))).toBe(true);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid GoAWK streaming stdin channel.' }]);
	});
});
