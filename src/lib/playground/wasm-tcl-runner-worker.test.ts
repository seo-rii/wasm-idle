// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_TCL_ASSET_VERSION,
	WASM_TCL_RUNNER_RECEIPT,
	WASM_TCL_RUNTIME_PROFILE
} from './wasmTclVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-tcl-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-tcl/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-tcl/', import.meta.url);
const verifiedWasmGluePatch =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';
const fixtureArtifact = {
	kind: 'opaque-prebuilt',
	path: 'wacl/releases/wacl.zip',
	repository: 'https://github.com/ecky-l/ecky-l.github.io.git',
	revision: WASM_TCL_RUNTIME_PROFILE.artifactRevision,
	sha256: '50d4ecb40c4db0448942332f9562c3cedc8bea38fa89d95ca5e5b9afcc5afb23',
	size: 1350907,
	url: 'https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/045aa904c2073eeded1be803cf5416901f6ce8ee/wacl/releases/wacl.zip'
};
const fixtureComponents = {
	emscripten: {
		revision: WASM_TCL_RUNTIME_PROFILE.emscriptenRevision,
		verifiedBuildInput: false,
		version: '1.37.9'
	},
	requirejs: {
		revision: WASM_TCL_RUNTIME_PROFILE.requireJsRevision,
		verifiedBuildInput: false,
		version: '2.3.3'
	},
	rlJson: {
		revision: '89ae2c67fc6023b3e0886ff5d2850dcde127a1c1',
		verifiedBuildInput: false,
		version: '0.9.7'
	},
	tcl: {
		revision: WASM_TCL_RUNTIME_PROFILE.tclRevision,
		verifiedBuildInput: false,
		version: '8.6.6'
	},
	tcllib: {
		revision: '700ee122b5c26243929831b242897ea7170c7015',
		verifiedBuildInput: false,
		version: '1.18'
	},
	tdom: {
		revision: '5a0a14aeb9321e50532af6c18ef4d05e44b158c8',
		verifiedBuildInput: false,
		version: '0.8.3'
	},
	wacl: {
		repository: 'https://github.com/ecky-l/wacl.git',
		revision: WASM_TCL_RUNTIME_PROFILE.waclRevision,
		verifiedBuildInput: false,
		version: '2017-05-29'
	}
};
const fixturePatches = [
	{ id: 'inject-verified-wasm' },
	{ id: 'inject-host-module' },
	{ id: 'preserve-host-output' },
	{ id: 'preserve-host-error-output' },
	{ id: 'guard-window-cleanup' }
];
const fixtureLicenses = [
	{ path: 'licenses/WACL.txt', spdx: 'BSD-3-Clause', size: 24, sha256: 'a'.repeat(64) },
	{ path: 'licenses/TCL.txt', spdx: 'TCL', size: 25, sha256: 'b'.repeat(64) },
	{ path: 'licenses/REQUIREJS.txt', spdx: 'MIT', size: 26, sha256: 'd'.repeat(64) }
];
const fixtureMetadata = {
	path: 'runtime-build.json',
	mediaType: 'application/json',
	size: 64,
	sha256: 'c'.repeat(64)
};
const fixtureLogicalBytes = {
	'require.js': Buffer.from('/* verified RequireJS fixture */\n', 'utf8'),
	'tcl/wacl-custom.data': Buffer.from('fixture custom package\n', 'utf8'),
	'tcl/wacl-library.data': Buffer.from('fixture Tcl library package\n', 'utf8'),
	'tcl/wacl.js': Buffer.from(
		`define("tcl/wacl",function(){${verifiedWasmGluePatch}return {};});\n`,
		'utf8'
	),
	'tcl/wacl.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
};
const fixtureMediaTypes = {
	'require.js': 'text/javascript',
	'tcl/wacl-custom.data': 'application/octet-stream',
	'tcl/wacl-library.data': 'application/octet-stream',
	'tcl/wacl.js': 'text/javascript',
	'tcl/wacl.wasm': 'application/wasm'
};
const fixtureStorageMetadata = {
	'require.js': { logicalPath: 'require.js', encoding: 'identity' },
	'tcl/wacl-custom.data.bin': {
		logicalPath: 'tcl/wacl-custom.data',
		encoding: 'identity'
	},
	'tcl/wacl-library.data.gz.bin': {
		logicalPath: 'tcl/wacl-library.data',
		encoding: 'gzip'
	},
	'tcl/wacl.js': { logicalPath: 'tcl/wacl.js', encoding: 'identity' },
	'tcl/wacl.wasm.gz.bin': { logicalPath: 'tcl/wacl.wasm', encoding: 'gzip' }
};
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fixtureAssets = Object.entries(fixtureLogicalBytes).map(([path, bytes]) => ({
	path,
	mediaType: fixtureMediaTypes[path as keyof typeof fixtureMediaTypes],
	size: bytes.byteLength,
	sha256: sha256(bytes)
}));
const fixtureStorage = Object.entries(fixtureStorageMetadata).map(([path, metadata]) => {
	const logical = fixtureLogicalBytes[metadata.logicalPath as keyof typeof fixtureLogicalBytes];
	return {
		path,
		...metadata,
		size: logical.byteLength,
		sha256: sha256(logical)
	};
});

function canonicalValue(kind: string, value: Record<string, unknown> | unknown[]) {
	if (Array.isArray(value)) {
		return [...value]
			.sort((left, right) => {
				const leftValue = JSON.stringify(left);
				const rightValue = JSON.stringify(right);
				return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
			})
			.map((entry) => `${kind}\0${JSON.stringify(entry)}\n`)
			.join('');
	}
	return Object.entries(value)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([name, entry]) => `${kind}\0${name}\0${JSON.stringify(entry)}\n`)
		.join('');
}

function computeFingerprint(value: {
	profileId: string;
	artifact: Record<string, unknown>;
	components: Record<string, Record<string, unknown>>;
	patches: Array<{ id: string }>;
	licenses: Array<{ path: string; spdx: string; size: number; sha256: string }>;
	metadata: { path: string; mediaType: string; size: number; sha256: string };
	assets: Array<{ path: string; mediaType: string; size: number; sha256: string }>;
	storage: Array<{
		path: string;
		logicalPath: string;
		encoding: string;
		size: number;
		sha256: string;
	}>;
}) {
	let canonical = `wasm-idle:tcl-runtime-manifest:v2\nformat\0wasm-tcl-runtime-manifest-v2\nruntime\0wacl\nprofileId\0${value.profileId}\n`;
	canonical += canonicalValue('artifact', value.artifact);
	canonical += canonicalValue('component', value.components);
	canonical += canonicalValue('patch', value.patches);
	for (const license of [...value.licenses].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	}
	canonical += `metadata\0${value.metadata.path}\0${value.metadata.mediaType}\0${value.metadata.size}\0${value.metadata.sha256}\n`;
	for (const asset of [...value.assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...value.storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return sha256(canonical);
}

const fixtureProfileId = WASM_TCL_RUNTIME_PROFILE.profileId;
const fixtureFingerprint = computeFingerprint({
	profileId: fixtureProfileId,
	artifact: fixtureArtifact,
	components: fixtureComponents,
	patches: fixturePatches,
	licenses: fixtureLicenses,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
});
const fixtureManifest = {
	format: 'wasm-tcl-runtime-manifest-v2',
	runtime: 'wacl',
	profileId: fixtureProfileId,
	fingerprint: fixtureFingerprint,
	artifact: fixtureArtifact,
	components: fixtureComponents,
	patches: fixturePatches,
	licenses: fixtureLicenses,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: fixtureStorage
};

function createRuntimePreflight(
	overrides: Record<string, unknown> = {},
	manifest: Record<string, unknown> = fixtureManifest
) {
	return {
		protocol: 'wasm-idle-tcl-preflight',
		protocolVersion: 1,
		profileId: fixtureProfileId,
		artifactRevision: WASM_TCL_RUNTIME_PROFILE.artifactRevision,
		waclRevision: WASM_TCL_RUNTIME_PROFILE.waclRevision,
		tclRevision: WASM_TCL_RUNTIME_PROFILE.tclRevision,
		requireJsRevision: WASM_TCL_RUNTIME_PROFILE.requireJsRevision,
		emscriptenRevision: WASM_TCL_RUNTIME_PROFILE.emscriptenRevision,
		manifestFingerprint: fixtureFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		requireJsBytes: Uint8Array.from(fixtureLogicalBytes['require.js']),
		customDataBytes: Uint8Array.from(fixtureLogicalBytes['tcl/wacl-custom.data']),
		libraryDataBytes: Uint8Array.from(fixtureLogicalBytes['tcl/wacl-library.data']),
		glueBytes: Uint8Array.from(fixtureLogicalBytes['tcl/wacl.js']),
		wasmBytes: Uint8Array.from(fixtureLogicalBytes['tcl/wacl.wasm']),
		...overrides
	};
}

const tclUtf8Expression = (value: string) =>
	`[::encoding convertfrom utf-8 [::binary decode hex {${Buffer.from(value, 'utf8').toString('hex')}}]]`;
const tclArgumentSetup = (activePath: string, args: string[]) => {
	const argv = args.map(tclUtf8Expression);
	return `::set ::argv0 ${tclUtf8Expression(activePath)}; ::set ::argc ${args.length}; ::set ::argv [::list${argv.length ? ` ${argv.join(' ')}` : ''}]`;
};

async function readWorkerSource(manifestFingerprint: string = WASM_TCL_ASSET_VERSION) {
	const source = await readFile(workerSourceUrl, 'utf8');
	if (manifestFingerprint === WASM_TCL_ASSET_VERSION) return source;
	const bundledIdentity = `manifestFingerprint: '${WASM_TCL_ASSET_VERSION}'`;
	if (
		source.indexOf(bundledIdentity) < 0 ||
		source.indexOf(bundledIdentity) !== source.lastIndexOf(bundledIdentity)
	) {
		throw new Error('Tcl runner must contain exactly one bundled manifest fingerprint');
	}
	return source.replace(bundledIdentity, `manifestFingerprint: '${manifestFingerprint}'`);
}

async function createIntegrityHarnessWorker(manifestFingerprint = fixtureFingerprint) {
	const workerSource = await readWorkerSource(manifestFingerprint);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
let harnessMode = '';
let blobCounter = 0;
let blobImportCount = 0;
let modules = new Map();
let staleInstalled = false;
let warmMutationInstalled = false;
const staleModule = { stale: 'module' };
const staleRequireJs = function staleRequireJs() {};
const staleRequire = function staleRequire() {};
const staleDefine = function staleDefine() {};
staleDefine.amd = {};
function installStaleGlobals(warm = false) {
  globalThis.Module = staleModule;
  globalThis.requirejs = staleRequireJs;
  globalThis.require = staleRequire;
  globalThis.define = staleDefine;
  if (warm) warmMutationInstalled = true;
  else staleInstalled = true;
}
function globalsMatchStale() {
  return globalThis.Module === staleModule && globalThis.requirejs === staleRequireJs &&
    globalThis.require === staleRequire && globalThis.define === staleDefine;
}
self.postMessage = (message) => {
  if (message && (message.results !== undefined || message.error !== undefined)) {
    if (staleInstalled || warmMutationInstalled) {
      parentPort.postMessage({ harnessGlobalsRestored: globalsMatchStale(), warmMutationInstalled });
    }
  }
  parentPort.postMessage(message);
};
self.close = () => parentPort.postMessage({ harnessClosed: true });
URL.createObjectURL = () => {
  const value = 'blob:wasm-tcl-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: value });
  return value;
};
URL.revokeObjectURL = (value) => parentPort.postMessage({ harnessBlobRevoked: value });
globalThis.importScripts = (value) => {
  parentPort.postMessage({
    harnessImported: String(value),
    harnessGlobalsCleared: globalThis.Module === undefined && globalThis.requirejs === undefined &&
      globalThis.require === undefined && globalThis.define === undefined
  });
  blobImportCount += 1;
  if (blobImportCount === 1) {
    if (harnessMode === 'require-import-failure') throw new Error('fixture RequireJS import failure');
    if (harnessMode === 'missing-fresh-require') return;
    modules = new Map();
    const requireJs = (names, resolve, reject) => {
      const record = modules.get(names[0]);
      if (!record) {
        try { requireJs.load(null, names[0], (requireJs.baseUrl || '') + names[0] + '.js'); }
        catch (error) { reject(error); }
        return;
      }
      try {
        if (!record.realized) {
          record.value = record.factory();
          record.realized = true;
        }
        resolve(record.value);
      } catch (error) {
        reject(error);
      }
    };
    requireJs.config = (options) => { requireJs.baseUrl = options.baseUrl; };
    requireJs.load = () => { throw new Error('unverified RequireJS load'); };
    requireJs.toUrl = (path) => (requireJs.baseUrl || '') + path;
    const define = (name, factory) => modules.set(name, { factory, realized: false, value: undefined });
    define.amd = {};
    globalThis.requirejs = requireJs;
    globalThis.require = requireJs;
    globalThis.define = define;
    return;
  }
  if (blobImportCount !== 2) throw new Error('unexpected verified script import');
  if (harnessMode === 'glue-import-failure') throw new Error('fixture glue import failure');
  if (harnessMode === 'missing-module') return;
  globalThis.define('tcl/wacl', () => {
    const hostModule = globalThis.Module;
    const activeRequire = globalThis.require;
    parentPort.postMessage({
      harnessFreshGlobals: hostModule !== staleModule && globalThis.requirejs !== staleRequireJs &&
        activeRequire !== staleRequire && globalThis.define !== staleDefine,
      harnessRequireBase: activeRequire.toUrl('tcl/')
    });
    const customPath = hostModule.locateFile('wacl-custom.data');
    const libraryPath = hostModule.locateFile('wacl-library.data');
    let undeclaredRejected = false;
    let wrongPackageRejected = false;
    try { hostModule.locateFile('wacl.wasm'); } catch { undeclaredRejected = true; }
    try { hostModule.getPreloadedPackage(libraryPath, ${fixtureLogicalBytes['tcl/wacl-library.data'].byteLength + 1}); }
    catch { wrongPackageRejected = true; }
    const custom = Buffer.from(hostModule.getPreloadedPackage(customPath, ${fixtureLogicalBytes['tcl/wacl-custom.data'].byteLength}));
    const library = Buffer.from(hostModule.getPreloadedPackage(libraryPath, ${fixtureLogicalBytes['tcl/wacl-library.data'].byteLength}));
    const injectionReady = Promise.all([
      webcrypto.subtle.digest('SHA-256', hostModule.wasmBinary),
      webcrypto.subtle.digest('SHA-256', custom),
      webcrypto.subtle.digest('SHA-256', library)
    ]).then(([wasm, customHash, libraryHash]) => parentPort.postMessage({
      harnessInjected: {
        initialArguments: [...hostModule.arguments],
        customPath,
        libraryPath,
        undeclaredRejected,
        wrongPackageRejected,
        wasmSha256: Buffer.from(wasm).toString('hex'),
        customSha256: Buffer.from(customHash).toString('hex'),
        librarySha256: Buffer.from(libraryHash).toString('hex')
      }
    }));
    const interp = {
      stdout: null,
      stderr: null,
      Eval(script) {
        parentPort.postMessage({ harnessEval: script });
        if (script.startsWith('::set ::argv0 ')) return '';
        interp.stdout('value?');
        const input = [];
        while (true) {
          const value = hostModule.stdin();
          if (value === null) break;
          input.push(value);
        }
        const parsed = Number(Buffer.from(input).toString('utf8').trim());
        interp.stdout('main=' + (parsed + 5));
        return '';
      }
    };
    return {
      onReady(callback) {
        const ready = () => void injectionReady.then(() => callback(interp));
        if (harnessMode === 'delayed-ready') setTimeout(ready, 50);
        else ready();
      }
    };
  });
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
  if (harnessMode === 'stale-globals' || harnessMode === 'missing-fresh-require' ||
      harnessMode === 'glue-import-failure') {
    installStaleGlobals(false);
  }
  if (harnessMode === 'mutate-warm-globals') installStaleGlobals(true);
  self.onmessage({ data });
});
`;
	return new NodeWorker(harness, { eval: true });
}

function executionRequest(overrides: Record<string, unknown> = {}) {
	return {
		runtimePreflight: createRuntimePreflight(),
		maxAssetBytes: 4 * 1024 * 1024,
		code: 'gets stdin line; puts $line',
		stdin: '68\n',
		...overrides
	};
}

async function runHarness(
	request: Record<string, unknown>,
	onMessage?: (message: any) => void,
	manifestFingerprint = fixtureFingerprint
) {
	const worker = await createIntegrityHarnessWorker(manifestFingerprint);
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
				if (message?.results !== undefined || message?.error !== undefined) terminal = true;
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
			worker.postMessage(requests[0]);
		});
		return { messages, terminals };
	} finally {
		await worker.terminate();
	}
}

async function runConcurrentHarness(requests: Record<string, unknown>[]) {
	const worker = await createIntegrityHarnessWorker();
	const terminals: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				if (message?.results === undefined && message?.error === undefined) return;
				terminals.push(message);
				if (terminals.length === requests.length) resolve();
			});
			worker.once('error', reject);
			for (const request of requests) worker.postMessage(request);
		});
		return terminals;
	} finally {
		await worker.terminate();
	}
}

const terminalMessage = (messages: any[]) =>
	messages.findLast((message) => message?.results !== undefined || message?.error !== undefined);

describe('Wacl Tcl runner worker', { timeout: 20_000 }, () => {
	it('keeps the deployed canonical graph, legacy aliases, generated profile, and runner pin current', async () => {
		const source = await readWorkerSource();
		const staticSource = await readFile(staticWorkerUrl, 'utf8');
		const manifestBytes = await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl));
		const manifest = JSON.parse(manifestBytes.toString('utf8'));

		expect(staticSource).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_TCL_RUNNER_RECEIPT.bytes);
		expect(sha256(source)).toBe(WASM_TCL_RUNNER_RECEIPT.sha256);
		expect(source).toContain(`manifestFingerprint: '${WASM_TCL_ASSET_VERSION}'`);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'licenses',
			'require.js',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'tcl'
		]);
		expect((await readdir(new URL('tcl/', staticRuntimeUrl))).sort()).toEqual([
			'wacl-custom.data',
			'wacl-custom.data.bin',
			'wacl-library.data.gz',
			'wacl-library.data.gz.bin',
			'wacl.js',
			'wacl.wasm.gz',
			'wacl.wasm.gz.bin'
		]);
		expect(manifest.fingerprint).toBe(WASM_TCL_ASSET_VERSION);
		expect(computeFingerprint(manifest)).toBe(WASM_TCL_ASSET_VERSION);
		expect(manifest.storage.map((receipt: { path: string }) => receipt.path)).toEqual([
			'require.js',
			'tcl/wacl-custom.data.bin',
			'tcl/wacl-library.data.gz.bin',
			'tcl/wacl.js',
			'tcl/wacl.wasm.gz.bin'
		]);
		expect(manifestBytes.byteLength).toBe(WASM_TCL_RUNTIME_PROFILE.manifestReceipt.bytes);
		expect(sha256(manifestBytes)).toBe(WASM_TCL_RUNTIME_PROFILE.manifestReceipt.sha256);

		for (const storageReceipt of manifest.storage) {
			const stored = await readFile(new URL(storageReceipt.path, staticRuntimeUrl));
			expect(stored.byteLength).toBe(storageReceipt.size);
			expect(sha256(stored)).toBe(storageReceipt.sha256);
			const logical = storageReceipt.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const logicalReceipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storageReceipt.logicalPath
			);
			expect(logical.byteLength).toBe(logicalReceipt.size);
			expect(sha256(logical)).toBe(logicalReceipt.sha256);
		}
		for (const [canonical, legacy] of [
			['tcl/wacl-custom.data.bin', 'tcl/wacl-custom.data'],
			['tcl/wacl-library.data.gz.bin', 'tcl/wacl-library.data.gz'],
			['tcl/wacl.wasm.gz.bin', 'tcl/wacl.wasm.gz']
		]) {
			expect(await readFile(new URL(legacy, staticRuntimeUrl))).toEqual(
				await readFile(new URL(canonical, staticRuntimeUrl))
			);
		}
	});

	it('contains no runtime fetch, URL parsing, or decompression path', async () => {
		const source = await readWorkerSource();
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toContain('new URL(');
		expect(source).not.toContain('DecompressionStream');
		expect(source).not.toContain('manifestUrl');
		expect(source).not.toContain('assetUrl');
	});

	it('verifies the payload before injecting captured Wasm and both data packages', async () => {
		const messages = await runHarness(executionRequest());

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages).toContainEqual({ harnessClosed: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(2);
		expect(messages).toContainEqual({
			harnessInjected: {
				initialArguments: ['main.tcl'],
				customPath: 'wasm-idle-verified:tcl/wacl-custom.data',
				libraryPath: 'wasm-idle-verified:tcl/wacl-library.data',
				undeclaredRejected: true,
				wrongPackageRejected: true,
				wasmSha256: sha256(fixtureLogicalBytes['tcl/wacl.wasm']),
				customSha256: sha256(fixtureLogicalBytes['tcl/wacl-custom.data']),
				librarySha256: sha256(fixtureLogicalBytes['tcl/wacl-library.data'])
			}
		});
		expect(messages).toContainEqual({
			harnessFreshGlobals: true,
			harnessRequireBase: 'wasm-idle-verified:tcl/tcl/'
		});
	});

	it.each([
		[
			'extra manifest field',
			(manifest: any) => {
				manifest.untrusted = true;
			},
			'schema is invalid'
		],
		[
			'artifact metadata',
			(manifest: any) => {
				manifest.artifact.revision = '0'.repeat(40);
			},
			'artifact metadata is invalid'
		],
		[
			'component metadata',
			(manifest: any) => {
				manifest.components.tcl.version = '8.6.7';
			},
			'component tcl metadata is invalid'
		],
		[
			'patch metadata',
			(manifest: any) => {
				manifest.patches[0] = { id: 'untrusted' };
			},
			'patch metadata is invalid'
		],
		[
			'license metadata',
			(manifest: any) => {
				manifest.licenses[0].sourceUrl = 'https://untrusted.example/';
			},
			'license receipt is invalid'
		],
		[
			'metadata receipt',
			(manifest: any) => {
				manifest.metadata.sha256 = 'f'.repeat(64);
			},
			'receipt graph failed fingerprint verification'
		],
		[
			'unknown logical asset',
			(manifest: any) => manifest.assets.push({ ...manifest.assets[0], path: 'other' }),
			'exactly five logical assets'
		],
		[
			'duplicate logical asset',
			(manifest: any) => {
				manifest.assets[4] = { ...manifest.assets[0] };
			},
			'unexpected or duplicate logical asset'
		],
		[
			'legacy storage path',
			(manifest: any) => {
				manifest.storage[2].path = 'tcl/wacl-library.data.gz';
			},
			'unexpected or duplicate storage asset'
		],
		[
			'legacy custom-data storage path',
			(manifest: any) => {
				manifest.storage[1].path = 'tcl/wacl-custom.data';
			},
			'unexpected or duplicate storage asset'
		],
		[
			'storage receipt',
			(manifest: any) => {
				manifest.storage[2].sha256 = '1'.repeat(64);
			},
			'receipt graph failed fingerprint verification'
		],
		[
			'identity storage mismatch',
			(manifest: any) => {
				manifest.storage[0].size += 1;
			},
			'identity storage receipt does not match'
		]
	] as const)('rejects %s before evaluating scripts', async (_label, mutate, error) => {
		const manifest = structuredClone(fixtureManifest) as any;
		mutate(manifest);
		const messages = await runHarness(
			executionRequest({ runtimePreflight: createRuntimePreflight({}, manifest) })
		);

		expect(terminalMessage(messages)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it.each([
		['RequireJS', 'requireJsBytes'],
		['custom data', 'customDataBytes'],
		['library data', 'libraryDataBytes'],
		['glue', 'glueBytes'],
		['Wasm', 'wasmBytes']
	] as const)('rejects corrupt %s logical bytes before evaluation', async (_label, key) => {
		const original = createRuntimePreflight()[key];
		const corrupt = Uint8Array.from(original);
		corrupt[corrupt.byteLength - 1] ^= 1;
		const messages = await runHarness(
			executionRequest({ runtimePreflight: createRuntimePreflight({ [key]: corrupt }) })
		);

		expect(terminalMessage(messages)).toEqual({
			error: expect.stringContaining('SHA-256 verification')
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('rejects a self-consistent executable replacement that changes the manifest fingerprint', async () => {
		const requireJsBytes = Buffer.concat([
			Buffer.from('globalThis.__forgedRequireJs = true;\n', 'utf8'),
			fixtureLogicalBytes['require.js']
		]);
		const assets = fixtureAssets.map((asset) =>
			asset.path === 'require.js'
				? { ...asset, size: requireJsBytes.byteLength, sha256: sha256(requireJsBytes) }
				: asset
		);
		const storage = fixtureStorage.map((receipt) =>
			receipt.logicalPath === 'require.js'
				? { ...receipt, size: requireJsBytes.byteLength, sha256: sha256(requireJsBytes) }
				: receipt
		);
		const manifest = { ...fixtureManifest, assets, storage };
		const manifestFingerprint = computeFingerprint(manifest);
		manifest.fingerprint = manifestFingerprint;

		const messages = await runHarness(
			executionRequest({
				runtimePreflight: createRuntimePreflight(
					{ manifestFingerprint, requireJsBytes: Uint8Array.from(requireJsBytes) },
					manifest
				)
			})
		);

		expect(messages).toContainEqual({
			error: 'Wacl Tcl runtime preflight payload is invalid.'
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it.each([
		[
			'extra payload field',
			() => createRuntimePreflight({ extra: true }),
			'invalid shape',
			undefined
		],
		[
			'wrong protocol',
			() => createRuntimePreflight({ protocol: 'untrusted' }),
			'payload is invalid',
			undefined
		],
		[
			'wrong byte type',
			() => createRuntimePreflight({ wasmBytes: new ArrayBuffer(8) }),
			'payload is invalid',
			undefined
		],
		['asset cap', () => createRuntimePreflight(), 'exceeds its byte limit', 8],
		[
			'invalid UTF-8 RequireJS',
			() => {
				const bytes = Uint8Array.from([0xff]);
				const assets = fixtureAssets.map((asset) =>
					asset.path === 'require.js'
						? { ...asset, size: bytes.byteLength, sha256: sha256(bytes) }
						: asset
				);
				const storage = fixtureStorage.map((receipt) =>
					receipt.logicalPath === 'require.js'
						? { ...receipt, size: bytes.byteLength, sha256: sha256(bytes) }
						: receipt
				);
				const manifest = { ...fixtureManifest, assets, storage };
				const fingerprint = computeFingerprint(manifest);
				manifest.fingerprint = fingerprint;
				return createRuntimePreflight(
					{ manifestFingerprint: fingerprint, requireJsBytes: bytes },
					manifest
				);
			},
			'not valid UTF-8 JavaScript',
			undefined
		]
	] as const)('rejects %s before evaluation', async (_label, create, error, cap) => {
		const runtimePreflight = create();
		const messages = await runHarness(
			executionRequest({
				runtimePreflight,
				...(cap === undefined ? {} : { maxAssetBytes: cap })
			}),
			undefined,
			String(runtimePreflight.manifestFingerprint)
		);

		expect(terminalMessage(messages)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('clears stale AMD and Module globals, captures fresh globals, and restores the prior values', async () => {
		const messages = await runHarness(executionRequest({ harnessMode: 'stale-globals' }));

		expect(terminalMessage(messages)).toEqual({ results: true });
		expect(messages.filter((message) => message.harnessImported)).toEqual([
			expect.objectContaining({ harnessGlobalsCleared: true }),
			expect.objectContaining({ harnessGlobalsCleared: false })
		]);
		expect(messages).toContainEqual({
			harnessGlobalsRestored: true,
			warmMutationInstalled: false
		});
		expect(messages).toContainEqual(expect.objectContaining({ harnessFreshGlobals: true }));
	});

	it('does not fall back to stale RequireJS and refuses reuse after evaluation fails', async () => {
		const { messages, terminals } = await runHarnessSequence([
			executionRequest({ harnessMode: 'missing-fresh-require' }),
			executionRequest()
		]);

		expect(terminals).toEqual([
			{ error: 'Verified RequireJS did not initialize its AMD globals.' },
			{ error: 'Wacl Tcl worker accepts exactly one run.' }
		]);
		expect(messages).toContainEqual({
			harnessGlobalsRestored: true,
			warmMutationInstalled: false
		});
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(1);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(1);
	});

	it('revokes evaluated script URLs, restores globals, and refuses reuse after glue fails', async () => {
		const { messages, terminals } = await runHarnessSequence([
			executionRequest({ harnessMode: 'glue-import-failure' }),
			executionRequest()
		]);

		expect(terminals).toEqual([
			{ error: 'fixture glue import failure' },
			{ error: 'Wacl Tcl worker accepts exactly one run.' }
		]);
		expect(messages.filter((message) => message.harnessBlobCreated)).toHaveLength(2);
		expect(messages.filter((message) => message.harnessBlobRevoked)).toHaveLength(2);
		expect(messages).toContainEqual({
			harnessGlobalsRestored: true,
			warmMutationInstalled: false
		});
	});

	it('refuses reuse after a failed pre-evaluation verification', async () => {
		const corrupt = Uint8Array.from(fixtureLogicalBytes['tcl/wacl.wasm']);
		corrupt[corrupt.byteLength - 1] ^= 1;
		const { messages, terminals } = await runHarnessSequence([
			executionRequest({
				runtimePreflight: createRuntimePreflight({ wasmBytes: corrupt })
			}),
			executionRequest()
		]);

		expect(terminals).toEqual([
			{ error: expect.stringContaining('SHA-256 verification') },
			{ error: 'Wacl Tcl worker accepts exactly one run.' }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(0);
	});

	it('refuses a second run after the first succeeds', async () => {
		const firstPath = 'src/$first [bad];\n한국어.tcl';
		const firstArgs = ['hello world', '$evil [exec nope];\n한국어', ''];
		const { messages, terminals } = await runHarnessSequence([
			executionRequest({ activePath: firstPath, args: firstArgs }),
			executionRequest()
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'Wacl Tcl worker accepts exactly one run.' }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
		expect(
			messages
				.filter((message) => message.harnessEval?.startsWith('::set ::argv0 '))
				.map((message) => message.harnessEval)
		).toEqual([tclArgumentSetup(firstPath, firstArgs)]);
	});

	it('refuses a different profile identity in a warm worker', async () => {
		const { terminals } = await runHarnessSequence([
			executionRequest(),
			executionRequest({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'e'.repeat(64) })
			})
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'Wacl Tcl worker accepts exactly one run.' }
		]);
	});

	it('rejects overlapping execution before shared stdin or output state can be replaced', async () => {
		const terminals = await runConcurrentHarness([
			executionRequest({ harnessMode: 'delayed-ready' }),
			executionRequest()
		]);

		expect(terminals).toContainEqual({ error: 'Wacl Tcl worker accepts exactly one run.' });
		expect(terminals).toContainEqual({ results: true });
	});

	it('prints a prompt before consuming live shared-ring input', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			executionRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
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

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=73'))
		);
		expect(terminalMessage(messages)).toEqual({ results: true });
	});

	it('fails closed on malformed shared stdin before runtime evaluation', async () => {
		const messages = await runHarness(
			executionRequest({
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

		expect(terminalMessage(messages)).toEqual({
			error: 'Invalid Wacl Tcl streaming stdin channel.'
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});
});
