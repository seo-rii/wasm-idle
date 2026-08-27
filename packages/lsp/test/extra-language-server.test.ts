import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AWK_MAX_ASSET_BYTES,
	AWK_RUNTIME_WORKER_PATH,
	HASKELL_RUNTIME_ASSET_RECEIPTS,
	JANET_MAX_ASSET_BYTES,
	PASCAL_MAX_ASSET_BYTES,
	PERL_MAX_ASSET_BYTES,
	PROLOG_MAX_ASSET_BYTES,
	RUBY_RUNTIME_PROFILE,
	TCL_MAX_ASSET_BYTES
} from '@wasm-idle/core';
import {
	BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
	BUNDLED_PROLOG_RUNTIME_PROFILE,
	BUNDLED_PROLOG_RUNNER_RECEIPT
} from '../src/bundledPrologRuntime.js';
import {
	BUNDLED_PERL_RUNTIME_PROFILE,
	BUNDLED_PERL_RUNNER_RECEIPT
} from '../src/bundledPerlRuntime.js';
import {
	BUNDLED_TCL_MANIFEST_FINGERPRINT,
	BUNDLED_TCL_RUNTIME_PROFILE,
	BUNDLED_TCL_RUNNER_RECEIPT
} from '../src/bundledTclRuntime.js';
import {
	BUNDLED_JANET_MANIFEST_FINGERPRINT,
	BUNDLED_JANET_RUNTIME_PROFILE,
	BUNDLED_JANET_RUNNER_RECEIPT
} from '../src/bundledJanetRuntime.js';
import {
	BUNDLED_PASCAL_RUNTIME_PROFILE,
	BUNDLED_PASCAL_RUNNER_RECEIPT
} from '../src/bundledPascalRuntime.js';
import { BUNDLED_LISP_MANIFEST_FINGERPRINT } from '../src/bundledLispRuntime.js';
import { BUNDLED_AWK_RUNTIME_PROFILE } from '../src/bundledAwkRuntime.js';
import { awkTestAssetBytes, createAwkTestAssetResponse } from './awk-fixture.js';
import { createPrologTestAssetResponse } from './prolog-fixture.js';
import { createPerlTestAssetResponse, perlTestAssetBytes } from './perl-fixture.js';
import { createTclTestAssetResponse, tclTestAssetBytes } from './tcl-fixture.js';
import { createJanetTestAssetResponse, janetTestAssetBytes } from './janet-fixture.js';
import { createPascalTestAssetResponse } from './pascal-fixture.js';

const lispStaticDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-lisp'
);
const lispStorageFiles = [
	'index.js.gz',
	'puppyc.core.wasm',
	'puppyc.core2.wasm.gz',
	'puppyc.js'
] as const;
const lispStaticBytes = Object.fromEntries(
	['runtime-manifest.v2.json', ...lispStorageFiles].map((file) => [
		file,
		readFileSync(path.join(lispStaticDir, file))
	])
) as Record<string, Uint8Array>;

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<any>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: any[] = [];
		terminated = false;

		constructor() {
			workers.push(this);
		}

		addEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].add(handler);
		}

		removeEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].delete(handler);
		}

		postMessage(message: any) {
			this.messages.push(message);
			if (message.type !== 'init') return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready' } } as MessageEvent<any>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}

	class MockReader {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	class MockWriter {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	return { workers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

const rubyRuntimeMocks = vi.hoisted(() => ({
	preflightRubyRuntimeAssets: vi.fn(async () => ({
		protocol: 'wasm-idle-ruby-preflight',
		protocolVersion: 1,
		profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4',
		artifactRevision: 'a'.repeat(40),
		rubyVersion: '3.4.1',
		rubyRevision: 'b'.repeat(40),
		rubyWasmVersion: '2.9.3-2.9.4',
		rubyWasmRevision: 'a'.repeat(40),
		wasiSdkVersion: '22.0',
		manifestFingerprint: 'c'.repeat(64),
		manifestBytes: Uint8Array.of(1),
		moduleJavaScriptBytes: Uint8Array.of(2),
		wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
	}))
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	preflightRubyRuntimeAssets: rubyRuntimeMocks.preflightRubyRuntimeAssets
}));

import {
	BUNDLED_ELIXIR_ASSET_RECEIPTS,
	getAssemblyScriptLanguageServer,
	getCssLanguageServer,
	getElixirLanguageServer,
	getErlangLanguageServer,
	getEditorLanguageServer,
	getFortranLanguageServer,
	getGraphqlLanguageServer,
	getHaskellLanguageServer,
	getHtmlLanguageServer,
	getJsonLanguageServer,
	getJanetLanguageServer,
	getLispLanguageServer,
	getLuaLanguageServer,
	getMarkdownLanguageServer,
	getOcamlLanguageServer,
	getOctaveLanguageServer,
	getPrologLanguageServer,
	getAwkLanguageServer,
	getPascalLanguageServer,
	getPerlLanguageServer,
	getRLanguageServer,
	getRubyLanguageServer,
	getDuckDbLanguageServer,
	getDLanguageServer,
	getSqlLanguageServer,
	getTclLanguageServer,
	getTomlLanguageServer,
	getWasmLanguageServer,
	getYamlLanguageServer,
	getZigLanguageServer
} from '../src/index.js';

describe('additional language server workers', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
		rubyRuntimeMocks.preflightRubyRuntimeAssets.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('starts Zig with compiler and stdlib URLs', async () => {
		const handle = await getZigLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				compilerUrl: 'https://static.example.com/repl_20240807/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://static.example.com/repl_20240807/wasm-zig/std.tar.gz',
				targetTriple: undefined,
				compileArgs: undefined
			}
		});

		handle.dispose();
	});

	it('starts Elixir and Erlang with AtomVM bundle and worker URLs', async () => {
		const options = {
			elixir: {
				bundleUrl: '/wasm-elixir/bundle.avm?v=123',
				workerUrl: '/assets/elixir-worker.js'
			},
			erlang: {
				bundleUrl: '/wasm-elixir/bundle.avm?v=123',
				workerUrl: '/assets/elixir-worker.js'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		};

		const elixir = await getElixirLanguageServer(options);
		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				language: 'elixir',
				bundleUrl: '/wasm-elixir/bundle.avm?v=123',
				workerUrl: '/assets/elixir-worker.js',
				integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS
			}
		});
		elixir.dispose();

		const erlang = await getErlangLanguageServer(options);
		expect(mockState.workers[1]?.messages[0]).toEqual({
			type: 'init',
			options: {
				language: 'erlang',
				bundleUrl: '/wasm-elixir/bundle.avm?v=123',
				workerUrl: '/assets/elixir-worker.js',
				integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS
			}
		});
		erlang.dispose();
	});

	it('inherits a shared custom Elixir trust root for the Erlang provider', async () => {
		const integrity = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS);
		integrity['bundle.avm'].uncompressedSha256 = 'a'.repeat(64);
		const erlang = await getErlangLanguageServer({
			elixir: {
				bundleUrl: '/custom-beam/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				language: 'erlang',
				bundleUrl: '/custom-beam/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity
			}
		});
		erlang.dispose();
	});

	it('starts Lua with the wasm-lua module URL', async () => {
		const handle = await getLuaLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-lua/index.js'
			}
		});

		handle.dispose();
	});

	it('starts D with the wasm-d module URL', async () => {
		const moduleBytes = new TextEncoder().encode('export const d = true;');
		const manifestBytes = new TextEncoder().encode('{"manifestVersion":1}');
		const receipt = (bytes: Uint8Array) => ({
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			uncompressedBytes: bytes.byteLength,
			uncompressedSha256: createHash('sha256').update(bytes).digest('hex')
		});
		const integrity = {
			'index.js': receipt(moduleBytes),
			'runtime/runtime-manifest.v1.json': receipt(manifestBytes)
		};
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = input.toString();
			const bytes = url.includes('runtime-manifest') ? manifestBytes : moduleBytes;
			const response = new Response(bytes, {
				headers: { 'Content-Length': String(bytes.byteLength) }
			});
			Object.defineProperty(response, 'url', { value: url });
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getDLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			d: { compileArgs: ['-preview=dip1000'], integrity },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-d/index.js',
				manifestUrl:
					'https://static.example.com/repl_20240807/wasm-d/runtime/runtime-manifest.v1.json',
				integrity,
				moduleBytes,
				manifestBytes,
				compileArgs: ['-preview=dip1000']
			}
		});
		const workerIntegrity = mockState.workers[0]?.messages[0]?.options?.integrity;
		expect(workerIntegrity).not.toBe(integrity);
		expect(workerIntegrity['index.js']).not.toBe(integrity['index.js']);
		expect(Object.isFrozen(workerIntegrity['index.js'])).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}

		handle.dispose();
	});

	it('rejects corrupt D bootstrap assets before creating the language worker', async () => {
		const moduleBytes = Uint8Array.of(1);
		const manifestBytes = Uint8Array.of(2);
		const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
		const onStatus = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const response = new Response(
					input.toString().includes('runtime-manifest') ? manifestBytes : moduleBytes
				);
				Object.defineProperty(response, 'url', { value: input.toString() });
				return response;
			})
		);

		await expect(
			getDLanguageServer({
				rootUrl: 'https://static.example.com/repl_20240807',
				currentUrl: 'https://app.example.com/editor',
				d: {
					integrity: {
						'index.js': {
							bytes: 1,
							sha256: '0'.repeat(64),
							uncompressedBytes: 1,
							uncompressedSha256: '0'.repeat(64)
						},
						'runtime/runtime-manifest.v1.json': {
							bytes: 1,
							sha256: manifestSha256,
							uncompressedBytes: 1,
							uncompressedSha256: manifestSha256
						}
					}
				},
				createWorker: () => new mockState.FakeWorker() as unknown as Worker,
				onStatus
			})
		).rejects.toThrow('Runtime asset index.js compressed SHA-256 mismatch');
		expect(mockState.workers).toHaveLength(0);
		expect(onStatus).toHaveBeenCalledWith(
			expect.objectContaining({ state: 'loading', stage: 'd-assets' })
		);
		expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error' }));
	});

	it('starts Tcl with Wacl worker assets', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const requestUrl = new URL(input.toString());
			const response = createTclTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected Tcl asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getTclLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				workerReceipt: BUNDLED_TCL_RUNNER_RECEIPT,
				runnerWorkerBytes: expect.any(Uint8Array),
				runtimePreflight: expect.objectContaining({
					profileId: BUNDLED_TCL_RUNTIME_PROFILE.profileId,
					manifestFingerprint: BUNDLED_TCL_MANIFEST_FINGERPRINT,
					manifestBytes: expect.any(Uint8Array),
					requireJsBytes: expect.any(Uint8Array),
					customDataBytes: expect.any(Uint8Array),
					libraryDataBytes: expect.any(Uint8Array),
					glueBytes: expect.any(Uint8Array),
					wasmBytes: expect.any(Uint8Array)
				}),
				maxAssetBytes: TCL_MAX_ASSET_BYTES
			}
		});
		expect(fetchMock).toHaveBeenCalledTimes(7);
		for (const [input, init] of fetchMock.mock.calls) {
			expect(input.toString()).not.toMatch(/\.gz(?:\?|$)/u);
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}

		handle.dispose();
	});

	it('rejects corrupted Tcl runtime bytes before creating the language worker', async () => {
		const corruptedWasm = Uint8Array.from(tclTestAssetBytes['tcl/wacl.wasm.gz.bin']);
		corruptedWasm[0] ^= 0xff;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const requestUrl = new URL(input.toString());
				const response = createTclTestAssetResponse(requestUrl, {
					'tcl/wacl.wasm.gz.bin': corruptedWasm
				});
				if (!response) throw new Error(`Unexpected Tcl asset request: ${requestUrl.href}`);
				return response;
			})
		);

		await expect(
			getTclLanguageServer({
				rootUrl: 'https://static.example.com/repl_20240807',
				currentUrl: 'https://app.example.com/editor',
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toMatchObject({ name: 'AssetIntegrityError', runtimeId: 'TCL' });
		expect(mockState.workers).toHaveLength(0);
	});

	it('starts Pascal with pas2js worker assets', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const response = createPascalTestAssetResponse(requestUrl);
				if (!response)
					throw new Error(`Unexpected Pascal asset request: ${requestUrl.href}`);
				return response;
			})
		);
		const handle = await getPascalLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			type: 'init',
			options: {
				maxAssetBytes: PASCAL_MAX_ASSET_BYTES,
				workerReceipt: BUNDLED_PASCAL_RUNNER_RECEIPT,
				runtimePreflight: {
					protocol: 'wasm-idle-pascal-preflight',
					protocolVersion: 1,
					manifestFingerprint: BUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint
				}
			}
		});

		handle.dispose();
	});

	it('starts Janet with folder-backed Janet worker assets', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const response = createJanetTestAssetResponse(requestUrl);
				if (!response)
					throw new Error(`Unexpected Janet asset request: ${requestUrl.href}`);
				return response;
			})
		);
		const handle = await getJanetLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				maxAssetBytes: JANET_MAX_ASSET_BYTES,
				workerReceipt: BUNDLED_JANET_RUNNER_RECEIPT,
				runnerWorkerBytes: janetTestAssetBytes['runner-worker.js'],
				runtimePreflight: expect.objectContaining({
					protocol: 'wasm-idle-janet-preflight',
					protocolVersion: 1,
					profileId: BUNDLED_JANET_RUNTIME_PROFILE.profileId,
					manifestFingerprint: BUNDLED_JANET_MANIFEST_FINGERPRINT
				})
			}
		});

		handle.dispose();
	});

	it('preloads and starts Scheme with the verified wasm-lisp profile', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const file = path.basename(requestUrl.pathname);
				const bytes = lispStaticBytes[file];
				if (!bytes) throw new Error(`Unexpected Scheme asset request: ${requestUrl.href}`);
				const response = new Response(bytes, {
					headers: { 'content-length': String(bytes.byteLength) }
				});
				Object.defineProperty(response, 'url', { value: requestUrl.href });
				return response;
			})
		);
		const handle = await getLispLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			type: 'init',
			options: {
				manifest: {
					fingerprint: BUNDLED_LISP_MANIFEST_FINGERPRINT
				},
				manifestFingerprint: BUNDLED_LISP_MANIFEST_FINGERPRINT,
				storageAssets: expect.any(Object)
			}
		});
		expect(
			Object.keys(mockState.workers[0]?.messages[0]?.options.storageAssets || {}).sort()
		).toEqual([...lispStorageFiles].sort());

		handle.dispose();
	});

	it('rejects a corrupted Scheme asset before creating a worker', async () => {
		const corruptedCompiler = Uint8Array.from(lispStaticBytes['puppyc.js']);
		corruptedCompiler[0] ^= 0xff;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const file = path.basename(requestUrl.pathname);
				const bytes = file === 'puppyc.js' ? corruptedCompiler : lispStaticBytes[file];
				if (!bytes) throw new Error(`Unexpected Scheme asset request: ${requestUrl.href}`);
				const response = new Response(Uint8Array.from(bytes).buffer, {
					headers: { 'content-length': String(bytes.byteLength) }
				});
				Object.defineProperty(response, 'url', { value: requestUrl.href });
				return response;
			})
		);

		await expect(
			getLispLanguageServer({
				rootUrl: 'https://static.example.com/repl_20240807',
				currentUrl: 'https://app.example.com/editor',
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toMatchObject({ name: 'AssetIntegrityError', runtimeId: 'LISP' });
		expect(mockState.workers).toHaveLength(0);
	});

	it('starts Octave with browser Octave runtime assets', async () => {
		const handle = await getOctaveLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-octave/runtime/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-octave/runner-worker.js',
				manifestUrl:
					'https://static.example.com/repl_20240807/wasm-octave/runtime/runtime-manifest.v1.json'
			}
		});

		handle.dispose();
	});

	it('starts OCaml with browser-native compiler assets', async () => {
		const handle = await getOcamlLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl:
					'https://static.example.com/repl_20240807/wasm-of-js-of-ocaml/browser-native/src/index.js',
				manifestUrl:
					'https://static.example.com/repl_20240807/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
				target: undefined,
				effectsMode: undefined,
				wasmBinaryenMode: undefined,
				packages: undefined
			}
		});

		handle.dispose();
	});

	it('starts Haskell with GHC browser runtime assets', async () => {
		const handle = await getHaskellLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			haskell: {
				ghcArgs: '-fno-code -Wall -Wcompat'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-haskell/dyld.mjs',
				rootfsUrl: 'https://static.example.com/repl_20240807/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: 'https://static.example.com/repl_20240807/wasm-haskell/bsdtar.wasm',
				integrity: HASKELL_RUNTIME_ASSET_RECEIPTS,
				mainSoPath: undefined,
				searchDirs: undefined,
				ghcArgs: '-fno-code -Wall -Wcompat'
			}
		});

		handle.dispose();
	});

	it('starts SQL with SQLite wasm assets', async () => {
		const handle = await getSqlLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			sql: { wasmUrl: '/assets/sql-wasm.wasm' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				dialect: 'sqlite',
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-sqlite/runtime.mjs',
				wasmUrl: '/assets/sql-wasm.wasm',
				duckdbBundles: undefined
			}
		});

		handle.dispose();
	});

	it('starts DuckDB with DuckDB wasm bundles', async () => {
		const duckdbBundles = {
			mvp: {
				mainModule: '/duckdb-mvp.wasm',
				mainWorker: '/duckdb-browser-mvp.worker.js'
			}
		};
		const handle = await getDuckDbLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			sql: { duckdbBundles },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				dialect: 'duckdb',
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-duckdb/runtime.mjs',
				wasmUrl: undefined,
				duckdbBundles
			}
		});

		handle.dispose();
	});

	it('starts AssemblyScript with the root-hosted compiler runtime module', async () => {
		const handle = await getAssemblyScriptLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl:
					'https://static.example.com/repl_20240807/wasm-assemblyscript/runtime.mjs',
				extraFiles: undefined
			}
		});

		handle.dispose();
	});

	it('starts GraphQL with an optional schema', async () => {
		const handle = await getGraphqlLanguageServer({
			graphql: { schema: 'type Query { hello: String }' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				schema: 'type Query { hello: String }'
			}
		});

		handle.dispose();
	});

	it('starts Fortran with a configured analyzer URL', async () => {
		const handle = await getFortranLanguageServer({
			fortran: { analyzerUrl: '/wasm-fortran/analyzer.js' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				analyzerUrl: '/wasm-fortran/analyzer.js'
			}
		});

		handle.dispose();
	});

	it('starts Fortran with an analyzer derived from an explicit root', async () => {
		const handle = await getFortranLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				analyzerUrl: 'https://static.example.com/repl_20240807/wasm-fortran/analyzer.js'
			}
		});

		handle.dispose();
	});

	it('registers Fortran through the generic registry with an explicit root', async () => {
		const handle = await getEditorLanguageServer('f90', {
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				analyzerUrl: 'https://static.example.com/repl_20240807/wasm-fortran/analyzer.js'
			}
		});

		handle?.dispose();
	});

	it('starts Prolog with folder-backed SWI-Prolog worker assets', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const requestUrl = new URL(input.toString());
			const response = createPrologTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected Prolog asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getPrologLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				workerReceipt: BUNDLED_PROLOG_RUNNER_RECEIPT,
				runnerWorkerBytes: expect.any(Uint8Array),
				runtimePreflight: expect.objectContaining({
					profileId: BUNDLED_PROLOG_RUNTIME_PROFILE.profileId,
					manifestFingerprint: BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
					manifestBytes: expect.any(Uint8Array),
					javascriptBytes: expect.any(Uint8Array),
					wasmBytes: expect.any(Uint8Array),
					dataBytes: expect.any(Uint8Array)
				}),
				maxAssetBytes: PROLOG_MAX_ASSET_BYTES
			}
		});
		expect(fetchMock).toHaveBeenCalledTimes(5);

		handle.dispose();
	});

	it('starts WASM without external runtime assets', async () => {
		const handle = await getWasmLanguageServer({
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {}
		});

		handle.dispose();
	});

	it('starts Ruby only after a complete custom runtime preflight', async () => {
		const handle = await getRubyLanguageServer({
			currentUrl: 'https://app.example.com/editor',
			ruby: {
				...RUBY_RUNTIME_PROFILE,
				baseUrl: 'https://static.example.com/custom-ruby/',
				manifestUrl: 'https://static.example.com/custom-ruby/runtime-manifest.v2.json',
				moduleUrl: 'https://static.example.com/custom-ruby/runtime.mjs.bin',
				wasmUrl:
					'https://static.example.com/custom-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(rubyRuntimeMocks.preflightRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'https://static.example.com/custom-ruby/',
				manifestUrl: `https://static.example.com/custom-ruby/runtime-manifest.v2.json?v=${RUBY_RUNTIME_PROFILE.manifestFingerprint}`,
				moduleUrl: `https://static.example.com/custom-ruby/runtime.mjs.bin?v=${RUBY_RUNTIME_PROFILE.moduleJavaScriptReceipt.sha256}`,
				wasmUrl: `https://static.example.com/custom-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin?v=${RUBY_RUNTIME_PROFILE.wasmReceipt.sha256}`,
				profile: RUBY_RUNTIME_PROFILE
			})
		);
		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			type: 'init',
			options: {
				runtimePreflight: {
					protocol: 'wasm-idle-ruby-preflight',
					profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4'
				}
			}
		});
		expect(Object.keys(mockState.workers[0]?.messages[0].options)).toEqual([
			'runtimePreflight'
		]);

		handle.dispose();
	});

	it('starts R with bundled WebR assets', async () => {
		const handle = await getRLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			r: { baseUrl: 'https://static.example.com/repl_20240807/webr/0.6.0/' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/webr/0.6.0/'
			}
		});

		handle.dispose();
	});

	it('starts AWK with GoAWK worker assets', async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			const response = createAwkTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected AWK asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getAwkLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			type: 'init',
			options: {
				manifestUrl: `https://static.example.com/repl_20240807/wasm-awk/runtime-manifest.v2.json?v=${BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint}`,
				maxAssetBytes: AWK_MAX_ASSET_BYTES,
				profile: BUNDLED_AWK_RUNTIME_PROFILE,
				workerReceipt: BUNDLED_AWK_RUNTIME_PROFILE.workerReceipt,
				runnerWorkerBytes: awkTestAssetBytes[AWK_RUNTIME_WORKER_PATH],
				runtimePreflight: { protocol: 'wasm-idle-awk-runtime-v2' }
			}
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);

		handle.dispose();
	});

	it('starts Perl with WebPerl worker assets', async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			const response = createPerlTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected Perl asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getPerlLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			type: 'init',
			options: {
				maxAssetBytes: PERL_MAX_ASSET_BYTES,
				workerReceipt: BUNDLED_PERL_RUNNER_RECEIPT,
				runnerWorkerBytes: perlTestAssetBytes['runner-worker.js'],
				runtimePreflight: {
					profileId: BUNDLED_PERL_RUNTIME_PROFILE.profileId,
					manifestFingerprint: BUNDLED_PERL_RUNTIME_PROFILE.manifestFingerprint
				}
			}
		});
		expect(fetchMock).toHaveBeenCalledTimes(5);

		handle.dispose();
	});

	it('starts document language servers with their language id', async () => {
		const load = [
			[getJsonLanguageServer, 'json'],
			[getYamlLanguageServer, 'yaml'],
			[getTomlLanguageServer, 'toml'],
			[getHtmlLanguageServer, 'html'],
			[getCssLanguageServer, 'css'],
			[getMarkdownLanguageServer, 'markdown']
		] as const;

		for (const [getLanguageServer, language] of load) {
			const handle = await getLanguageServer({
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			});
			expect(mockState.workers.at(-1)?.messages[0]).toEqual({
				type: 'init',
				options: { language }
			});
			handle.dispose();
		}
	});
});
