// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_TCL_ASSET_VERSION } from './wasmTclVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-tcl-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-tcl/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-tcl/', import.meta.url);
const fixtureBaseUrl = 'https://runtime.example/wasm-tcl/';
const fixtureManifestUrl = `${fixtureBaseUrl}runtime-manifest.v2.json?v=fixture`;
const fixtureArtifact = {
	kind: 'opaque-prebuilt',
	path: 'wacl/releases/wacl.zip',
	repository: 'https://github.com/ecky-l/ecky-l.github.io.git',
	revision: '045aa904c2073eeded1be803cf5416901f6ce8ee',
	sha256: '50d4ecb40c4db0448942332f9562c3cedc8bea38fa89d95ca5e5b9afcc5afb23',
	size: 1350907,
	url: 'https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/045aa904c2073eeded1be803cf5416901f6ce8ee/wacl/releases/wacl.zip'
};
const fixtureComponents = {
	emscripten: {
		revision: 'f1222cc8c315e47ba3541a42ab391bd3b1d9be14',
		verifiedBuildInput: false,
		version: '1.37.9'
	},
	requirejs: {
		revision: 'f2335026867afd80c394247bfe5278d2bd8f32ee',
		verifiedBuildInput: false,
		version: '2.3.3'
	},
	rlJson: {
		revision: '89ae2c67fc6023b3e0886ff5d2850dcde127a1c1',
		verifiedBuildInput: false,
		version: '0.9.7'
	},
	tcl: {
		revision: '27696b490b9b339a869a8f6fe3113d05ebcbf565',
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
		revision: '9daacabb0102a9986f33263261350edfeebdd83b',
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
	{
		path: 'licenses/WACL.txt',
		spdx: 'BSD-3-Clause',
		size: 24,
		sha256: 'a'.repeat(64)
	},
	{
		path: 'licenses/TCL.txt',
		spdx: 'TCL',
		size: 25,
		sha256: 'b'.repeat(64)
	},
	{
		path: 'licenses/REQUIREJS.txt',
		spdx: 'MIT',
		size: 26,
		sha256: 'd'.repeat(64)
	}
];
const fixtureMetadata = {
	path: 'runtime-build.json',
	mediaType: 'application/json',
	size: 64,
	sha256: 'c'.repeat(64)
};
const verifiedWasmGluePatch =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';
const fixtureLogicalBytes = {
	'require.js': Buffer.from('self.__fixtureRequireJs = true;\n', 'utf8'),
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
const fixtureStorageBytes = {
	'require.js': fixtureLogicalBytes['require.js'],
	'tcl/wacl-custom.data': fixtureLogicalBytes['tcl/wacl-custom.data'],
	'tcl/wacl-library.data.gz': gzipSync(fixtureLogicalBytes['tcl/wacl-library.data'], {
		level: 9
	}),
	'tcl/wacl.js': fixtureLogicalBytes['tcl/wacl.js'],
	'tcl/wacl.wasm.gz': gzipSync(fixtureLogicalBytes['tcl/wacl.wasm'], { level: 9 })
};
const fixtureStorageMetadata = {
	'require.js': { logicalPath: 'require.js', encoding: 'identity' as const },
	'tcl/wacl-custom.data': {
		logicalPath: 'tcl/wacl-custom.data',
		encoding: 'identity' as const
	},
	'tcl/wacl-library.data.gz': {
		logicalPath: 'tcl/wacl-library.data',
		encoding: 'gzip' as const
	},
	'tcl/wacl.js': { logicalPath: 'tcl/wacl.js', encoding: 'identity' as const },
	'tcl/wacl.wasm.gz': { logicalPath: 'tcl/wacl.wasm', encoding: 'gzip' as const }
};
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const tclUtf8Expression = (value: string) =>
	`[::encoding convertfrom utf-8 [::binary decode hex {${Buffer.from(value, 'utf8').toString('hex')}}]]`;
const tclArgumentSetup = (activePath: string, args: string[]) => {
	const argv = args.map(tclUtf8Expression);
	return `::set ::argv0 ${tclUtf8Expression(activePath)}; ::set ::argc ${args.length}; ::set ::argv [::list${argv.length ? ` ${argv.join(' ')}` : ''}]`;
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
const fixtureProfileId = 'wacl-pages-045aa904-tcl-8.6.6';

function canonicalValue(kind: string, value: Record<string, unknown> | unknown[]) {
	if (Array.isArray(value)) {
		return [...value]
			.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
			.map((entry) => `${kind}\0${JSON.stringify(entry)}\n`)
			.join('');
	}
	return Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, entry]) => `${kind}\0${name}\0${JSON.stringify(entry)}\n`)
		.join('');
}

function computeFingerprint(value: {
	profileId: string;
	artifact: Record<string, unknown>;
	components: Record<string, Record<string, unknown>>;
	patches: Array<{ id: string }>;
	licenses: Array<{
		path: string;
		spdx: string;
		size: number;
		sha256: string;
	}>;
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
		left.path.localeCompare(right.path)
	)) {
		canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	}
	canonical += `metadata\0${value.metadata.path}\0${value.metadata.mediaType}\0${value.metadata.size}\0${value.metadata.sha256}\n`;
	for (const asset of [...value.assets].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...value.storage].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return sha256(canonical);
}

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
const overflowLibraryBytes = Buffer.concat([
	fixtureLogicalBytes['tcl/wacl-library.data'],
	Buffer.of(0)
]);
const overflowStorageBytes = gzipSync(overflowLibraryBytes, { level: 9 });
const overflowStorage = fixtureStorage.map((receipt) =>
	receipt.path === 'tcl/wacl-library.data.gz'
		? {
				...receipt,
				size: overflowStorageBytes.byteLength,
				sha256: sha256(overflowStorageBytes)
			}
		: receipt
);
const overflowFingerprint = computeFingerprint({
	profileId: fixtureProfileId,
	artifact: fixtureArtifact,
	components: fixtureComponents,
	patches: fixturePatches,
	licenses: fixtureLicenses,
	metadata: fixtureMetadata,
	assets: fixtureAssets,
	storage: overflowStorage
});
const overflowManifest = {
	...fixtureManifest,
	fingerprint: overflowFingerprint,
	storage: overflowStorage
};

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createIntegrityHarnessWorker() {
	const workerSource = await readWorkerSource();
	const encodedLogical = Object.fromEntries(
		Object.entries(fixtureLogicalBytes).map(([path, bytes]) => [path, bytes.toString('base64')])
	);
	const encodedStorage = Object.fromEntries(
		Object.entries(fixtureStorageBytes).map(([path, bytes]) => [path, bytes.toString('base64')])
	);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
self.postMessage = (message) => parentPort.postMessage(message);
let harnessMode = '';
let blobCounter = 0;
let blobImportCount = 0;
URL.createObjectURL = () => {
  const url = 'blob:wasm-tcl-fixture-' + ++blobCounter;
  parentPort.postMessage({ harnessBlobCreated: url });
  return url;
};
URL.revokeObjectURL = (url) => parentPort.postMessage({ harnessBlobRevoked: url });
const logicalBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedLogical)}).map(([path, base64]) => [path, Buffer.from(base64, 'base64')])
);
const storageBytes = Object.fromEntries(
  Object.entries(${JSON.stringify(encodedStorage)}).map(([path, base64]) => [path, Buffer.from(base64, 'base64')])
);
const storageLogicalPaths = ${JSON.stringify(
		Object.fromEntries(
			Object.entries(fixtureStorageMetadata).map(([path, metadata]) => [
				path,
				metadata.logicalPath
			])
		)
	)};
const overflowStorageBytes = Buffer.from(${JSON.stringify(overflowStorageBytes.toString('base64'))}, 'base64');
const manifestTemplate = ${JSON.stringify(fixtureManifest)};
const overflowManifestTemplate = ${JSON.stringify(overflowManifest)};
const modules = new Map();
globalThis.importScripts = (url) => {
  parentPort.postMessage({ harnessImported: String(url) });
  if (!String(url).startsWith('blob:wasm-tcl-fixture-')) {
    parentPort.postMessage({ harnessUnverifiedImport: String(url) });
    throw new Error('unverified follow-up import rejected');
  }
  blobImportCount += 1;
  if (blobImportCount === 1) {
    const requirejs = (names, resolve, reject) => {
      const value = modules.get(names[0]);
      if (value) resolve(value);
      else {
        try { requirejs.load(null, names[0], (requirejs.baseUrl || '') + names[0] + '.js'); }
        catch (error) { reject(error); }
      }
    };
    requirejs.config = (options) => { requirejs.baseUrl = options.baseUrl; };
    requirejs.load = (_context, _moduleName, url) => importScripts(url);
    globalThis.requirejs = requirejs;
    globalThis.require = { toUrl: (path) => (requirejs.baseUrl || '') + path };
    return;
  }
  if (blobImportCount !== 2) throw new Error('unexpected verified script import');
  const customPath = Module.locateFile('wacl-custom.data');
  const libraryPath = Module.locateFile('wacl-library.data');
  let undeclaredRejected = false;
  let wrongPackageRejected = false;
  try { Module.locateFile('wacl.wasm'); } catch { undeclaredRejected = true; }
  try { Module.getPreloadedPackage(libraryPath, logicalBytes['tcl/wacl-library.data'].byteLength + 1); }
  catch { wrongPackageRejected = true; }
  const custom = Buffer.from(
    Module.getPreloadedPackage(customPath, logicalBytes['tcl/wacl-custom.data'].byteLength)
  );
  const library = Buffer.from(
    Module.getPreloadedPackage(libraryPath, logicalBytes['tcl/wacl-library.data'].byteLength)
  );
  const injectionReady = Promise.all([
    webcrypto.subtle.digest('SHA-256', Module.wasmBinary),
    webcrypto.subtle.digest('SHA-256', custom),
    webcrypto.subtle.digest('SHA-256', library)
  ]).then(([wasm, customHash, libraryHash]) => parentPort.postMessage({
    harnessInjected: {
      initialArguments: [...Module.arguments],
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
    Eval: (script) => {
      parentPort.postMessage({ harnessEval: script });
      if (script.startsWith('::set ::argv0 ')) return '';
      interp.stdout('value?');
      const input = [];
      while (true) {
        const value = Module.stdin();
        if (value === null) break;
        input.push(value);
      }
      const parsed = Number(Buffer.from(input).toString('utf8').trim());
      interp.stdout('main=' + (parsed + 5));
      return '';
    }
  };
  if (harnessMode !== 'missing-module') {
    modules.set('tcl/wacl', {
      onReady: (callback) => { void injectionReady.then(() => callback(interp)); }
    });
  }
};
globalThis.fetch = async (url, init = {}) => {
  const requestedUrl = String(url);
  const pathname = new URL(requestedUrl).pathname;
  const isManifest = pathname.endsWith('/runtime-manifest.v2.json');
  const storageName = Object.keys(storageBytes).find((name) => pathname.endsWith('/' + name));
  parentPort.postMessage({
    harnessFetch: requestedUrl,
    harnessFetchOptions: {
      cache: init.cache,
      credentials: init.credentials,
      redirect: init.redirect,
      referrerPolicy: init.referrerPolicy
    }
  });
  const manifest = JSON.parse(JSON.stringify(
    harnessMode === 'gzip-overflow' ? overflowManifestTemplate : manifestTemplate
  ));
  if (harnessMode === 'manifest-fingerprint') manifest.fingerprint = '0'.repeat(64);
  if (harnessMode === 'invalid-manifest-json') manifest.__invalidJson = true;
  if (harnessMode === 'unknown-asset') {
    manifest.assets.push({
      path: 'unexpected.bin', mediaType: 'application/octet-stream', size: 1, sha256: 'd'.repeat(64)
    });
  }
  if (harnessMode === 'duplicate-asset') manifest.assets[4] = { ...manifest.assets[0] };
  if (harnessMode === 'missing-storage') manifest.storage.pop();
  if (harnessMode === 'extra-manifest-field') manifest.untrusted = true;
  if (harnessMode === 'artifact-metadata') manifest.artifact.revision = '0'.repeat(40);
  if (harnessMode === 'component-metadata') manifest.components.tcl.version = '8.6.7';
  if (harnessMode === 'patch-metadata') manifest.patches[0] = 'untrusted-patch';
  if (harnessMode === 'license-metadata') {
    manifest.licenses[0].sourceUrl = 'https://untrusted.example/LICENSE';
  }
  if (harnessMode === 'asset-schema') manifest.assets[0].untrusted = true;
  if (harnessMode === 'license-receipt') manifest.licenses[0].sha256 = 'e'.repeat(64);
  if (harnessMode === 'metadata-receipt') manifest.metadata.sha256 = 'f'.repeat(64);
  if (harnessMode === 'storage-receipt') manifest.storage[0].sha256 = '1'.repeat(64);
  let bytes = isManifest
    ? Buffer.from(harnessMode === 'invalid-manifest-json' ? '{' : JSON.stringify(manifest))
    : storageName
      ? Buffer.from(
          harnessMode === 'gzip-overflow' && storageName === 'tcl/wacl-library.data.gz'
            ? overflowStorageBytes
            : storageBytes[storageName]
        )
      : Buffer.alloc(0);
  const targetedStorage = storageName === 'tcl/wacl.wasm.gz';
  const transportDecoded =
    storageName?.endsWith('.gz') &&
    (harnessMode === 'transport-decoded' || harnessMode === 'corrupt-decoded');
  if (transportDecoded) bytes = Buffer.from(logicalBytes[storageLogicalPaths[storageName]]);
  if (harnessMode === 'corrupt-storage' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'corrupt-decoded' && targetedStorage) bytes[bytes.length - 1] ^= 1;
  if (harnessMode === 'redirect-storage' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: 'https://untrusted.example/wacl.wasm.gz',
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  if (harnessMode === 'reader-failure' && targetedStorage) {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: {
        getReader() { throw new Error('fixture reader failure'); },
        cancel: () => parentPort.postMessage({ harnessCancelled: 'response' })
      }
    };
  }
  if ((harnessMode === 'truncated-storage' || harnessMode === 'overflow-storage') && targetedStorage) {
    const streamedBytes = harnessMode === 'truncated-storage'
      ? bytes.subarray(0, bytes.byteLength - 1)
      : Buffer.concat([bytes, Buffer.of(0)]);
    let cancelled = false;
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers(),
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: streamedBytes };
            },
            cancel() {
              cancelled = true;
              parentPort.postMessage({ harnessCancelled: 'reader' });
            },
            releaseLock() {
              parentPort.postMessage({ harnessReleased: true, harnessWasCancelled: cancelled });
            }
          };
        }
      }
    };
  }
  if (
    targetedStorage &&
    (harnessMode === 'wrong-content-length' || harnessMode === 'invalid-content-length')
  ) {
    return {
      ok: true,
      status: 200,
      url: requestedUrl,
      headers: new Headers({
        'content-length':
          harnessMode === 'invalid-content-length' ? '1e2' : String(bytes.byteLength + 1)
      }),
      body: { cancel: () => parentPort.postMessage({ harnessCancelled: 'response' }) }
    };
  }
  const responseHeaders = {
    'content-length': String(
      transportDecoded ? storageBytes[storageName].byteLength : bytes.byteLength
    )
  };
  if (transportDecoded) responseHeaders['content-encoding'] = 'gzip';
  const response = new Response(bytes, { status: 200, headers: responseHeaders });
  Object.defineProperty(response, 'url', { value: requestedUrl });
  return response;
};
(0, eval)(${JSON.stringify(workerSource)});
parentPort.on('message', (data) => {
  harnessMode = data.harnessMode || '';
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
				if (code !== 0) reject(new Error(`Wacl Tcl harness exited with code ${code}`));
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
				if (code !== 0) reject(new Error(`Wacl Tcl harness exited with code ${code}`));
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
		baseUrl: fixtureBaseUrl,
		manifestUrl: fixtureManifestUrl,
		manifestFingerprint: fixtureFingerprint,
		maxAssetBytes: 1_000_000,
		code: 'gets stdin line; puts $line',
		stdin: '68\n',
		...overrides
	};
}

describe('Wacl Tcl runner worker', () => {
	it('keeps the deployed receipt graph and runner pin current', async () => {
		const source = await readWorkerSource();
		const versionModule = await readFile(
			new URL('./wasmTclVersion.ts', import.meta.url),
			'utf8'
		);
		const runnerBytes = Number(
			versionModule.match(/WASM_TCL_RUNNER_RECEIPT\s*=\s*\{\s*bytes:\s*(\d+)/u)?.[1]
		);
		const runnerSha256 = versionModule.match(
			/WASM_TCL_RUNNER_RECEIPT[\s\S]*?sha256:\s*'([a-f0-9]{64})'/u
		)?.[1];
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(runnerBytes);
		expect(sha256(source)).toBe(runnerSha256);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'licenses',
			'require.js',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'tcl'
		]);
		const manifest = JSON.parse(
			await readFile(new URL('runtime-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: 'wasm-tcl-runtime-manifest-v2',
			runtime: 'wacl',
			fingerprint: WASM_TCL_ASSET_VERSION
		});
		expect(computeFingerprint(manifest)).toBe(WASM_TCL_ASSET_VERSION);
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
	});

	it('loads only declared storage and injects verified Wasm and both data packages', async () => {
		const messages = await runHarness(integrityRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.map((message) => message.output || '').join('')).toContain('main=73');
		const fetches = messages.filter((message) => message.harnessFetch);
		expect(fetches).toHaveLength(6);
		expect(fetches.map((message) => new URL(message.harnessFetch).pathname)).toEqual([
			'/wasm-tcl/runtime-manifest.v2.json',
			'/wasm-tcl/require.js',
			'/wasm-tcl/tcl/wacl-custom.data',
			'/wasm-tcl/tcl/wacl-library.data.gz',
			'/wasm-tcl/tcl/wacl.js',
			'/wasm-tcl/tcl/wacl.wasm.gz'
		]);
		for (const message of fetches) {
			expect(message.harnessFetchOptions).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
		expect(messages.some((message) => message.harnessUnverifiedImport)).toBe(false);
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
	});

	it('accepts transparent gzip decoding only after the logical receipt matches', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'transport-decoded' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(messages.some((message) => message.harnessUnverifiedImport)).toBe(false);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessInjected: expect.objectContaining({
					wasmSha256: sha256(fixtureLogicalBytes['tcl/wacl.wasm']),
					librarySha256: sha256(fixtureLogicalBytes['tcl/wacl-library.data'])
				})
			})
		);
	});

	it('refuses RequireJS network fallback when verified glue does not register its module', async () => {
		const messages = await runHarness(integrityRequest({ harnessMode: 'missing-module' }));

		expect(messages.at(-1)).toEqual({
			error: 'Wacl Tcl runtime refused an undeclared RequireJS module load.'
		});
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
		expect(messages.some((message) => message.harnessUnverifiedImport)).toBe(false);
	});

	it('sets argv0, argc, and argv on every run without interpolating argument source', async () => {
		const firstPath = 'src/$first [bad];\n한국어.tcl';
		const firstArgs = ['hello world', '$evil [exec nope];\n한국어', ''];
		const secondPath = 'second/main.tcl';
		const secondArgs = ['warm', 'worker'];
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ activePath: firstPath, args: firstArgs }),
			integrityRequest({ activePath: secondPath, args: secondArgs })
		]);

		expect(terminals).toEqual([{ results: true }, { results: true }]);
		expect(
			messages
				.filter((message) => message.harnessEval?.startsWith('::set ::argv0 '))
				.map((message) => message.harnessEval)
		).toEqual([
			tclArgumentSetup(firstPath, firstArgs),
			tclArgumentSetup(secondPath, secondArgs)
		]);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessInjected: expect.objectContaining({
					initialArguments: [firstPath, ...firstArgs]
				})
			})
		);
		expect(
			messages
				.filter((message) => message.harnessEval?.startsWith('::set ::argv0 '))
				.map((message) => message.harnessEval)
				.join('\n')
		).not.toContain('$evil');
	});

	it.each([
		['manifest-fingerprint', 'fingerprint does not match'],
		['invalid-manifest-json', 'not valid UTF-8 JSON'],
		['unknown-asset', 'exactly five logical assets'],
		['duplicate-asset', 'unexpected or duplicate logical asset'],
		['missing-storage', 'exactly five storage assets'],
		['extra-manifest-field', 'manifest schema is invalid'],
		['artifact-metadata', 'artifact metadata is invalid'],
		['component-metadata', 'component tcl metadata is invalid'],
		['patch-metadata', 'patch metadata is invalid'],
		['license-metadata', 'license receipt is invalid'],
		['asset-schema', 'receipt is invalid'],
		['license-receipt', 'receipt graph failed fingerprint verification'],
		['metadata-receipt', 'receipt graph failed fingerprint verification'],
		['storage-receipt', 'receipt graph failed fingerprint verification'],
		['corrupt-storage', 'failed SHA-256 verification'],
		['corrupt-decoded', 'failed SHA-256 verification']
	])('rejects %s before evaluating verified scripts', async (harnessMode, error) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it.each([
		['redirect-storage', 'response URL does not match', 'response'],
		['reader-failure', 'fixture reader failure', 'response'],
		['wrong-content-length', 'Content-Length does not match', 'response'],
		['invalid-content-length', 'invalid Content-Length', 'response'],
		['truncated-storage', 'is truncated', undefined],
		['overflow-storage', 'exceeds its receipt size', 'reader']
	])('rejects %s with bounded stream cleanup', async (harnessMode, error, cancellation) => {
		const messages = await runHarness(integrityRequest({ harnessMode }));

		expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
		if (cancellation) expect(messages).toContainEqual({ harnessCancelled: cancellation });
		if (cancellation === 'reader') {
			expect(messages).toContainEqual({ harnessReleased: true, harnessWasCancelled: true });
		}
	});

	it('rejects gzip expansion beyond the logical receipt before script evaluation', async () => {
		const messages = await runHarness(
			integrityRequest({
				harnessMode: 'gzip-overflow',
				manifestFingerprint: overflowFingerprint
			})
		);

		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('gzip exceeds its logical receipt size')
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});

	it('clears a failed verification generation so the same worker can retry', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest({ harnessMode: 'corrupt-storage' }),
			integrityRequest()
		]);

		expect(terminals).toEqual([
			{ error: expect.stringContaining('failed SHA-256 verification') },
			{ results: true }
		]);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
	});

	it('refuses to replace a verified runtime profile in a warm worker', async () => {
		const { messages, terminals } = await runHarnessSequence([
			integrityRequest(),
			integrityRequest({ baseUrl: 'https://runtime.example/other-tcl/' })
		]);

		expect(terminals).toEqual([
			{ results: true },
			{ error: 'Wacl Tcl worker cannot replace an initialized runtime profile.' }
		]);
		expect(messages.filter((message) => message.harnessFetch)).toHaveLength(6);
		expect(messages.filter((message) => message.harnessImported)).toHaveLength(2);
	});

	it('prints a prompt before consuming live shared-ring input after verification', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			integrityRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
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
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('fails closed on malformed shared stdin after runtime verification', async () => {
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

		expect(messages.at(-1)).toEqual({ error: 'Invalid Wacl Tcl streaming stdin channel.' });
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	});
});
