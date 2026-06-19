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
	getHaskellLanguageServer,
	getLuaLanguageServer,
	getOcamlLanguageServer,
	getPhpLanguageServer,
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
});
