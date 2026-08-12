import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUBY_RUNTIME_ASSET_PATH } from '@wasm-idle/core';
import {
	BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
	BUNDLED_PROLOG_RUNNER_RECEIPT
} from '../src/bundledPrologRuntime.js';

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
			return new Response(bytes, {
				headers: { 'Content-Length': String(bytes.byteLength) }
			});
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
		const onStatus = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (input: RequestInfo | URL) =>
					new Response(
						input.toString().includes('runtime-manifest') ? manifestBytes : moduleBytes
					)
			)
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
							sha256: '0'.repeat(64),
							uncompressedBytes: 1,
							uncompressedSha256: '0'.repeat(64)
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
		const handle = await getTclLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-tcl/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-tcl/runner-worker.js'
			}
		});

		handle.dispose();
	});

	it('starts Pascal with pas2js worker assets', async () => {
		const handle = await getPascalLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-pascal/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-pascal/runner-worker.js'
			}
		});

		handle.dispose();
	});

	it('starts Janet with folder-backed Janet worker assets', async () => {
		const handle = await getJanetLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-janet/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-janet/runner-worker.js'
			}
		});

		handle.dispose();
	});

	it('starts Scheme with the wasm-lisp module URL', async () => {
		const handle = await getLispLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-lisp/index.js'
			}
		});

		handle.dispose();
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
		const handle = await getPrologLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-prolog/',
				workerUrl: `https://static.example.com/repl_20240807/wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`,
				manifestUrl: `https://static.example.com/repl_20240807/wasm-prolog/runtime-manifest.v2.json?v=${BUNDLED_PROLOG_MANIFEST_FINGERPRINT}`,
				manifestFingerprint: BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
				workerReceipt: BUNDLED_PROLOG_RUNNER_RECEIPT
			}
		});

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

	it('starts Ruby with an explicitly provided Ruby WASM URL', async () => {
		const moduleBytes = new TextEncoder().encode(
			`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url);`
		);
		const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
		const receipt = (bytes: Uint8Array) => ({
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
		const integrity = {
			'runtime.mjs': receipt(moduleBytes),
			[RUBY_RUNTIME_ASSET_PATH]: receipt(wasmBytes)
		};
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = input.toString();
			const bytes = url.endsWith('/assets/ruby+stdlib.wasm') ? wasmBytes : moduleBytes;
			const response = new Response(bytes, {
				headers: { 'Content-Length': String(bytes.byteLength) }
			});
			Object.defineProperty(response, 'url', { value: url });
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const handle = await getRubyLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			ruby: { wasmUrl: '/assets/ruby+stdlib.wasm', integrity },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				moduleUrl: 'https://static.example.com/repl_20240807/wasm-ruby/runtime.mjs',
				wasmUrl: 'https://app.example.com/assets/ruby+stdlib.wasm',
				integrity,
				moduleBytes,
				wasmBytes
			}
		});
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
		const handle = await getAwkLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-awk/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-awk/runner-worker.js'
			}
		});

		handle.dispose();
	});

	it('starts Perl with WebPerl worker assets', async () => {
		const handle = await getPerlLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				baseUrl: 'https://static.example.com/repl_20240807/wasm-perl/',
				workerUrl: 'https://static.example.com/repl_20240807/wasm-perl/runner-worker.js'
			}
		});

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
