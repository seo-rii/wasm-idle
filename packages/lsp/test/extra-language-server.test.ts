import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	getCssLanguageServer,
	getFortranLanguageServer,
	getGraphqlLanguageServer,
	getHaskellLanguageServer,
	getHtmlLanguageServer,
	getJsonLanguageServer,
	getLuaLanguageServer,
	getMarkdownLanguageServer,
	getOcamlLanguageServer,
	getPhpLanguageServer,
	getPrologLanguageServer,
	getAwkLanguageServer,
	getPerlLanguageServer,
	getRLanguageServer,
	getRubyLanguageServer,
	getDuckDbLanguageServer,
	getSqlLanguageServer,
	getTomlLanguageServer,
	getYamlLanguageServer,
	getZigLanguageServer
} from '../src/index.js';

describe('additional language server workers', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
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
				stdlibUrl: 'https://static.example.com/repl_20240807/wasm-zig/std.zip',
				targetTriple: undefined,
				compileArgs: undefined
			}
		});

		handle.dispose();
	});

	it('starts PHP with its configured version', async () => {
		const handle = await getPhpLanguageServer({
			php: { version: '8.5' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				version: '8.5'
			}
		});

		handle.dispose();
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
			sql: { wasmUrl: '/assets/sql-wasm.wasm' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				dialect: 'sqlite',
				wasmUrl: '/assets/sql-wasm.wasm'
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
			sql: { duckdbBundles },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				dialect: 'duckdb',
				wasmUrl: undefined,
				duckdbBundles
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

	it('starts Fortran with an optional analyzer URL', async () => {
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
				workerUrl: 'https://static.example.com/repl_20240807/wasm-prolog/runner-worker.js'
			}
		});

		handle.dispose();
	});

	it('starts Ruby with an explicitly provided Ruby WASM URL', async () => {
		const handle = await getRubyLanguageServer({
			ruby: { wasmUrl: '/assets/ruby+stdlib.wasm' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				wasmUrl: '/assets/ruby+stdlib.wasm'
			}
		});

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
