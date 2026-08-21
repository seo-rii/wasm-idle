// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
	computePascalRuntimeFingerprint,
	PASCAL_MANIFEST_FORMAT
} from '../../../scripts/sync-wasm-pascal.mjs';
import { StaticStdinRingHost } from './staticStdinRing';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-pascal-runner-worker.js',
	import.meta.url
);
const staticRuntimeUrl = new URL('../../../static/wasm-pascal/', import.meta.url);
const identity = {
	profileId: 'pascal-pas2js-3.2.1-legacy-2c1edc2d',
	artifactRevision: '2c1edc2d47a221498d6086f62431796012e2f3ca',
	pas2jsVersion: '3.2.1',
	pas2jsRevision: '9ac46614dc82'
};
const artifact = {
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: identity.artifactRevision,
	path: 'static/wasm-pascal',
	provenance: 'legacy-import',
	verifiedBuildInput: false
};
const components = {
	pas2js: {
		version: identity.pas2jsVersion,
		repository: 'https://gitlab.com/freepascal.org/fpc/pas2js.git',
		revision: identity.pas2jsRevision,
		revisionKind: 'recorded-abbreviated',
		verifiedBuildInput: false,
		evidence: 'runtime-build.json; full upstream commit was not recorded'
	}
};
const build = {
	target: 'browser',
	compiler: 'native pas2js',
	entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
	integrationSources: [
		'runtimes/wasm-pascal/src/system.pas',
		'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
		'runtimes/wasm-pascal/src/webfilecache.pp'
	],
	transformations: [
		'strip trailing horizontal whitespace and normalize final newline',
		'gzip compiler.js with Node zlib level 9'
	],
	verifiedBuildInput: false
};
const license = {
	spdx: 'LGPL-2.1-only WITH Independent-modules-exception',
	sourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
	exceptionSourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
	verifiedBuildInput: false,
	evidence: 'upstream license URLs recorded; texts were not vendored with the legacy generation'
};

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const compilerBytes = Buffer.from(
	`var pas = {};
var rtl = { run(name) {
  if (name !== 'program' || globalThis.__wasmIdlePascalCompiler) return;
  globalThis.postMessage({ harnessCompilerBootstrap: name });
  globalThis.__wasmIdlePascalCompiler={
    setFile() {},
    compile() { return "var rtl={run(){}};globalThis.console.log('value?');const value=Number(globalThis.__wasm_idle_pascal_read());globalThis.console.log('main='+(value+5));"; }
  };
} };
`,
	'utf8'
);
const rtlBytes = Buffer.from('globalThis.rtl = globalThis.rtl || {};\n', 'utf8');
const systemBytes = Buffer.from(
	'unit System; interface procedure ReadLn; implementation end.\n',
	'utf8'
);
const metadataBytes = Buffer.from(
	`${JSON.stringify(
		{
			format: 'wasm-pascal-runtime-build-v1',
			runtime: 'pas2js',
			pas2jsVersion: identity.pas2jsVersion,
			pas2jsCommit: identity.pas2jsRevision
		},
		null,
		2
	)}\n`,
	'utf8'
);
const compilerStorage = gzipSync(compilerBytes, { level: 9 });
const assets = [
	{
		path: 'compiler.js',
		mediaType: 'text/javascript',
		size: compilerBytes.length,
		sha256: sha256(compilerBytes)
	},
	{
		path: 'rtl.js',
		mediaType: 'text/javascript',
		size: rtlBytes.length,
		sha256: sha256(rtlBytes)
	},
	{
		path: 'system.pas',
		mediaType: 'text/plain',
		size: systemBytes.length,
		sha256: sha256(systemBytes)
	}
];
const storage: Array<{
	path: string;
	logicalPath: string;
	encoding: 'gzip' | 'identity';
	size: number;
	sha256: string;
}> = [
	{
		path: 'compiler.js.gz.bin',
		logicalPath: 'compiler.js',
		encoding: 'gzip',
		size: compilerStorage.length,
		sha256: sha256(compilerStorage)
	},
	{
		path: 'rtl.js.bin',
		logicalPath: 'rtl.js',
		encoding: 'identity',
		size: rtlBytes.length,
		sha256: sha256(rtlBytes)
	},
	{
		path: 'system.pas.bin',
		logicalPath: 'system.pas',
		encoding: 'identity',
		size: systemBytes.length,
		sha256: sha256(systemBytes)
	}
];
const manifestBase = {
	format: PASCAL_MANIFEST_FORMAT,
	runtime: 'pas2js',
	profileId: identity.profileId,
	licenseExpression: 'LGPL-2.1-only WITH Independent-modules-exception',
	artifact,
	components,
	build,
	license,
	metadata: {
		path: 'runtime-build.json',
		mediaType: 'application/json',
		size: metadataBytes.length,
		sha256: sha256(metadataBytes)
	},
	assets,
	storage
};
const manifestFingerprint = computePascalRuntimeFingerprint(manifestBase);
const manifest = { ...manifestBase, fingerprint: manifestFingerprint };

function runtimePreflight(overrides: Record<string, unknown> = {}) {
	return {
		protocol: 'wasm-idle-pascal-preflight',
		protocolVersion: 1,
		...identity,
		manifestFingerprint,
		manifestBytes: Uint8Array.from(Buffer.from(JSON.stringify(manifest), 'utf8')),
		compilerJavaScriptBytes: Uint8Array.from(compilerBytes),
		rtlJavaScriptBytes: Uint8Array.from(rtlBytes),
		systemPascalBytes: Uint8Array.from(systemBytes),
		...overrides
	};
}

async function injectedWorkerSource(fingerprint = manifestFingerprint) {
	let source = await readFile(workerSourceUrl, 'utf8');
	for (const [placeholder, value] of [
		['__WASM_IDLE_PASCAL_PROFILE_ID__', identity.profileId],
		['__WASM_IDLE_PASCAL_ARTIFACT_REVISION__', identity.artifactRevision],
		['__WASM_IDLE_PASCAL_VERSION__', identity.pas2jsVersion],
		['__WASM_IDLE_PASCAL_REVISION__', identity.pas2jsRevision],
		['__WASM_IDLE_PASCAL_MANIFEST_FINGERPRINT__', fingerprint]
	] as const) {
		expect(source.split(placeholder)).toHaveLength(2);
		source = source.replace(placeholder, value);
	}
	return source;
}

async function createHarnessWorker(fingerprint = manifestFingerprint) {
	const source = await injectedWorkerSource(fingerprint);
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const stale = {
  rtl: { stale: 'rtl' },
  pas: { stale: 'pas' },
  compiler: { stale: 'compiler' }
};
globalThis.rtl = stale.rtl;
globalThis.pas = stale.pas;
globalThis.__wasmIdlePascalCompiler = stale.compiler;
self.fetch = () => { throw new Error('network access is forbidden'); };
self.importScripts = () => { throw new Error('importScripts is forbidden'); };
self.close = () => parentPort.postMessage({ harnessClosed: true });
self.postMessage = (message) => {
  if (message && (message.results !== undefined || message.error !== undefined)) {
    parentPort.postMessage({
      harnessRestored:
        globalThis.rtl === stale.rtl &&
        globalThis.pas === stale.pas &&
        globalThis.__wasmIdlePascalCompiler === stale.compiler
    });
  }
  parentPort.postMessage(message);
};
(0, eval)(${JSON.stringify(source)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

const isTerminal = (message: any) => message?.results !== undefined || message?.error !== undefined;

async function runHarness(
	request: Record<string, unknown>,
	onMessage?: (message: any) => void,
	fingerprint = manifestFingerprint
) {
	const worker = await createHarnessWorker(fingerprint);
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

function executionRequest(overrides: Record<string, unknown> = {}) {
	return {
		runtimePreflight: runtimePreflight(),
		maxAssetBytes: 8 * 1024 * 1024,
		code: 'ReadLn(value);',
		stdin: '68\n',
		...overrides
	};
}

describe('pas2js runner worker', { timeout: 30_000 }, () => {
	it('contains no URL, fetch, importScripts, or decompression path', async () => {
		const source = await readFile(workerSourceUrl, 'utf8');
		expect(source).not.toMatch(/\bfetch\s*\(/u);
		expect(source).not.toMatch(/\bimportScripts\s*\(/u);
		expect(source).not.toContain('DecompressionStream');
		expect(source).not.toMatch(/new\s+URL\s*\(/u);
	});

	it('executes only the exact verified logical payload and restores stale globals', async () => {
		const messages = await runHarness(executionRequest());
		expect(messages.filter((message) => message?.harnessCompilerBootstrap)).toEqual([
			{ harnessCompilerBootstrap: 'program' }
		]);
		expect(messages.some((message) => message?.output?.includes('main=73'))).toBe(true);
		expect(messages.find((message) => message?.harnessRestored)).toEqual({
			harnessRestored: true
		});
		expect(messages.find(isTerminal)).toEqual({ results: true });
		expect(messages.at(-1)).toEqual({ harnessClosed: true });
	});

	it('boots and executes the checked-in compiler with its deferred program export', async () => {
		const productionManifestBytes = await readFile(
			new URL('runtime-manifest.v2.json', staticRuntimeUrl)
		);
		const productionManifest = JSON.parse(productionManifestBytes.toString('utf8'));
		const productionCompilerBytes = gunzipSync(
			await readFile(new URL('compiler.js.gz.bin', staticRuntimeUrl))
		);
		const messages = await runHarness(
			{
				runtimePreflight: {
					protocol: 'wasm-idle-pascal-preflight',
					protocolVersion: 1,
					profileId: productionManifest.profileId,
					artifactRevision: productionManifest.artifact.revision,
					pas2jsVersion: productionManifest.components.pas2js.version,
					pas2jsRevision: productionManifest.components.pas2js.revision,
					manifestFingerprint: productionManifest.fingerprint,
					manifestBytes: Uint8Array.from(productionManifestBytes),
					compilerJavaScriptBytes: Uint8Array.from(productionCompilerBytes),
					rtlJavaScriptBytes: Uint8Array.from(
						await readFile(new URL('rtl.js.bin', staticRuntimeUrl))
					),
					systemPascalBytes: Uint8Array.from(
						await readFile(new URL('system.pas.bin', staticRuntimeUrl))
					)
				},
				maxAssetBytes: 8 * 1024 * 1024,
				code: "program Main; begin WriteLn('checked-in compiler ok'); end."
			},
			undefined,
			productionManifest.fingerprint
		);
		expect(messages.find(isTerminal)).toEqual({ results: true });
		expect(
			messages.some((message) => message?.output?.includes('checked-in compiler ok'))
		).toBe(true);
	});

	it('streams a prompt before reading a UTF-8 line from the shared ring', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness(
			executionRequest({ stdin: undefined, stdinChannel: stdin.descriptor }),
			(message) => {
				if (message?.output?.includes('value?') && !suppliedInput) {
					suppliedInput = true;
					setTimeout(() => {
						stdin.enqueue('68\r\n');
						stdin.close();
					}, 10);
				}
			}
		);
		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=73'))
		);
	});

	it('fails closed on corrupt logical bytes', async () => {
		const tampered = Uint8Array.from(compilerBytes);
		tampered[0] ^= 1;
		const messages = await runHarness(
			executionRequest({
				runtimePreflight: runtimePreflight({ compilerJavaScriptBytes: tampered })
			})
		);
		expect(messages.find(isTerminal)).toEqual({
			error: 'Pascal runtime asset compiler.js failed SHA-256 verification.'
		});
	});

	it('rejects extra payload fields and malformed UTF-8', async () => {
		const extra = await runHarness(
			executionRequest({ runtimePreflight: runtimePreflight({ unexpected: true }) })
		);
		expect(extra.find(isTerminal)).toEqual({
			error: 'Pascal runtime preflight payload has an invalid shape.'
		});
		const invalidUtf8 = await runHarness(
			executionRequest({
				runtimePreflight: runtimePreflight({
					rtlJavaScriptBytes: new Uint8Array([0xc3, 0x28])
				})
			})
		);
		expect(invalidUtf8.find(isTerminal)?.error).toMatch(/SHA-256|UTF-8|unexpected byte size/u);
	});

	it('enforces manifest and per-asset caps', async () => {
		const oversizedManifest = new Uint8Array(64 * 1024 + 1);
		const manifestMessages = await runHarness(
			executionRequest({
				runtimePreflight: runtimePreflight({ manifestBytes: oversizedManifest })
			})
		);
		expect(manifestMessages.find(isTerminal)?.error).toBe(
			'Pascal runtime manifest exceeds its byte limit.'
		);
		const assetMessages = await runHarness(executionRequest({ maxAssetBytes: 1 }));
		expect(assetMessages.find(isTerminal)?.error).toContain('exceeds its byte limit');
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness(
			executionRequest({
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1,
					buffer: new SharedArrayBuffer(32),
					capacity: 16,
					controlBytes: 8
				}
			})
		);
		expect(messages.find(isTerminal)).toEqual({
			error: 'Invalid pas2js streaming stdin channel.'
		});
	});

	it('reserves its one-shot request before awaiting integrity work', async () => {
		const worker = await createHarnessWorker();
		const messages: any[] = [];
		try {
			await new Promise<void>((resolve, reject) => {
				worker.on('message', (message) => {
					messages.push(message);
					if (messages.filter(isTerminal).length === 2) resolve();
				});
				worker.once('error', reject);
				worker.postMessage(executionRequest());
				worker.postMessage(executionRequest());
			});
			expect(messages.filter(isTerminal)).toContainEqual({
				error: 'Pascal runner accepts exactly one run request.'
			});
		} finally {
			await worker.terminate();
		}
	});
});
