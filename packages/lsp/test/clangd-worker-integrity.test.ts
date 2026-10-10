import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	decompressGzip: vi.fn(),
	verifyRuntimeAssetIntegrity: vi.fn()
}));

vi.mock('@wasm-idle/llvm-core', () => ({
	decompressGzip: mocks.decompressGzip
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRuntimeAssetIntegrity: mocks.verifyRuntimeAssetIntegrity
}));

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: class {
		listen() {}
	},
	BrowserMessageWriter: class {
		write() {}
		end() {}
	}
}));

class FakeClangdWorkerScope {
	readonly messages: unknown[] = [];
	private messageListener?: (event: MessageEvent) => void | Promise<void>;

	addEventListener(type: 'message', listener: (event: MessageEvent) => void | Promise<void>) {
		if (type === 'message') this.messageListener = listener;
	}

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	async dispatch(data: unknown) {
		await this.messageListener?.({ data } as MessageEvent);
	}
}

describe('clangd worker asset integrity', () => {
	let scope: FakeClangdWorkerScope;
	let getRegisterCalls: () => unknown[][];

	beforeEach(async () => {
		vi.resetModules();
		mocks.decompressGzip.mockReset();
		mocks.verifyRuntimeAssetIntegrity.mockReset();
		scope = new FakeClangdWorkerScope();
		vi.stubGlobal('self', scope);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clangd-runtime');
		const { ClangdWorkspaceFileRegistry } = await import('../src/clangd/workspace.js');
		const registerWorkspaceFile = vi.spyOn(ClangdWorkspaceFileRegistry.prototype, 'register');
		getRegisterCalls = () => registerWorkspaceFile.mock.calls;
		await import('../src/clangd/worker.js');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('rejects initialization without an explicit asset base URL', async () => {
		await scope.dispatch({
			type: 'init',
			assets: {
				clangdJs: new ArrayBuffer(0),
				clangdWasmGz: new ArrayBuffer(0)
			}
		});

		expect(scope.messages).toContainEqual({
			type: 'error',
			message: 'clangd init requires an explicit baseUrl'
		});
		expect(mocks.decompressGzip).not.toHaveBeenCalled();
	});

	it.each([
		'/workspace/../../usr/include/injected.hpp',
		'/workspaceevil/prefix.cpp',
		'/tmp/outside.cpp',
		'file:///workspace/remote.cpp',
		'include/./nested.hpp',
		'include/bad\0.hpp',
		42
	])('rejects an unsafe direct sync-file message for %s', async (path) => {
		await scope.dispatch({ type: 'sync-file', name: path });

		expect(scope.messages).toEqual([
			{
				type: 'error',
				message: expect.stringContaining('Failed to sync clangd workspace file')
			}
		]);
	});

	it('validates but does not reserve a workspace file before runtime initialization', async () => {
		await scope.dispatch({ type: 'sync-file', name: 'include\\header.hpp' });

		expect(scope.messages).toEqual([]);
		expect(getRegisterCalls()).toHaveLength(0);
	});

	it('verifies decompressed Wasm bytes before importing the runtime module', async () => {
		const runtimeBytes = Uint8Array.of(0, 97, 115, 109);
		const deliveryBytes = Uint8Array.of(0x1f, 0x8b, 0x08);
		const integrity = {
			bytes: deliveryBytes.byteLength,
			sha256: 'a'.repeat(64),
			uncompressedBytes: runtimeBytes.byteLength,
			uncompressedSha256: 'b'.repeat(64)
		};
		mocks.decompressGzip.mockResolvedValue(runtimeBytes);
		mocks.verifyRuntimeAssetIntegrity.mockRejectedValue(
			new Error('decompressed clangd Wasm failed integrity verification')
		);

		await scope.dispatch({
			type: 'init',
			baseUrl: 'https://assets.example.com/clangd/',
			assets: {
				clangdJs: new TextEncoder().encode('export default async () => ({})').buffer,
				clangdWasmGz: deliveryBytes.buffer,
				clangdWasmIntegrity: integrity
			}
		});

		expect(mocks.decompressGzip).toHaveBeenCalledWith(
			expect.objectContaining({ byteLength: deliveryBytes.byteLength }),
			'clangd.wasm.gz'
		);
		expect(mocks.verifyRuntimeAssetIntegrity).toHaveBeenCalledWith({
			asset: 'clangd.wasm.gz',
			bytes: runtimeBytes,
			expected: integrity,
			stage: 'uncompressed',
			mimeType: 'application/wasm',
			runtimeId: 'clangd'
		});
		expect(scope.messages).toContainEqual({
			type: 'error',
			message: 'decompressed clangd Wasm failed integrity verification'
		});
		expect(scope.messages).not.toContainEqual(expect.objectContaining({ type: 'ready' }));
	});

	it('supplies the verified Module to pthread initialization and mounts all headers before main', async () => {
		const module = await WebAssembly.compile(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
		const headers = {
			schemaVersion: 1,
			version: 'fixture',
			targetTriple: 'wasm32-wasi',
			resourceDir: '/lib/clang/22',
			files: {
				'/usr/include/wasm32-wasi/stdio.h': 'C header',
				'/usr/include/c++/v1/vector': 'C++ header',
				'/usr/include/wasm32-wasi/noeh/c++/v1/__config_site': 'target configuration',
				'/lib/clang/22/include/stddef.h': 'resource header'
			}
		};
		const files = new Map<string, Uint8Array | string>();
		const receiveInstance = vi.fn();
		const runtime = {
			FS: {
				mkdirTree: vi.fn(),
				analyzePath: (path: string) => ({ exists: files.has(path) }),
				readFile: (path: string) => files.get(path),
				writeFile: (path: string, contents: Uint8Array | string) =>
					files.set(path, contents)
			},
			callMain: vi.fn(() => {
				for (const [path, content] of Object.entries(headers.files))
					expect(files.get(path)).toBe(content);
				for (const document of String(files.get('/workspace/.clangd')).split('\n---\n')) {
					const flags: string[] = JSON.parse(document).CompileFlags.Add;
					expect(flags[flags.indexOf('-resource-dir') + 1]).toBe('/lib/clang/22');
				}
			})
		};
		const factory = vi.fn(
			async (options: {
				instantiateWasm: (
					imports: WebAssembly.Imports,
					receive: typeof receiveInstance
				) => WebAssembly.Exports;
			}) => {
				const exports = options.instantiateWasm({}, receiveInstance);
				expect(receiveInstance.mock.calls[0][0]).toBeInstanceOf(WebAssembly.Instance);
				expect(receiveInstance.mock.calls[0][1]).toBe(module);
				expect(exports).toBe(receiveInstance.mock.calls[0][0].exports);
				return runtime;
			}
		);
		vi.stubGlobal('__testClangdFactory', factory);
		vi.mocked(URL.createObjectURL).mockReturnValue(
			'data:text/javascript,export default async (options) => globalThis.__testClangdFactory(options);'
		);
		await scope.dispatch({
			type: 'init',
			baseUrl: 'https://assets.example.com/clangd/',
			assets: {
				clangdJs: new ArrayBuffer(0),
				clangdModule: module,
				clangdWasmBytes: 8,
				clangdWasmSha256: 'a'.repeat(64),
				clangdHeaders: headers
			}
		});
		expect(factory).toHaveBeenCalledOnce();
		expect(receiveInstance).toHaveBeenCalledOnce();
		expect(runtime.callMain).toHaveBeenCalledWith([]);
		expect(mocks.decompressGzip).not.toHaveBeenCalled();
		expect(mocks.verifyRuntimeAssetIntegrity).not.toHaveBeenCalled();
		expect(scope.messages).toContainEqual({ type: 'ready', value: 8 });
		expect(scope.messages).not.toContainEqual(expect.objectContaining({ type: 'error' }));
	});

	it.each([0, 128 * 1024 * 1024 + 1, 1.5])(
		'rejects invalid verified Module metadata before importing JS: %s bytes',
		async (size) => {
			const imported = vi.fn();
			vi.stubGlobal('__testClangdImported', imported);
			vi.mocked(URL.createObjectURL).mockReturnValue(
				'data:text/javascript,globalThis.__testClangdImported(); export default async () => ({});'
			);
			await scope.dispatch({
				type: 'init',
				baseUrl: 'https://assets.example.com/clangd/',
				assets: {
					clangdJs: new ArrayBuffer(0),
					clangdModule: await WebAssembly.compile(
						Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
					),
					clangdWasmBytes: size,
					clangdWasmSha256: 'a'.repeat(64)
				}
			});
			expect(imported).not.toHaveBeenCalled();
			expect(scope.messages).toContainEqual({
				type: 'error',
				message: 'Invalid prepared clangd Module metadata'
			});
			expect(scope.messages).not.toContainEqual(expect.objectContaining({ type: 'ready' }));
		}
	);

	it.each([
		[
			'previous LLVM 22 build',
			'0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019',
			'b'.repeat(64),
			true
		],
		[
			'slim LLVM 22 build',
			'f2bef5c4b4aa8691f0b996286231c5778a17119c41537ae4108c7ff2795f7fc3',
			'b'.repeat(64),
			true
		],
		['unrecognized build', 'b'.repeat(64), 'b'.repeat(64), false],
		[
			'previous build without integrity metadata',
			undefined,
			'0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019',
			true
		],
		[
			'slim build without integrity metadata',
			undefined,
			'f2bef5c4b4aa8691f0b996286231c5778a17119c41537ae4108c7ff2795f7fc3',
			true
		],
		['unknown build without integrity metadata', undefined, 'b'.repeat(64), false]
	] as const)(
		'selects matching resource headers for %s',
		async (_label, digest, rawDigest, expectedOverlay) => {
			const runtimeBytes = Uint8Array.of(0, 97, 115, 109);
			const deliveryBytes = Uint8Array.of(0x1f, 0x8b, 0x08);
			const hash = vi
				.fn()
				.mockResolvedValue(
					Uint8Array.from(rawDigest.match(/../g)!, (byte) => Number.parseInt(byte, 16))
						.buffer
				);
			vi.stubGlobal('crypto', { subtle: { digest: hash } });
			const files = new Map<string, Uint8Array | string>();
			const runtime = {
				FS: {
					mkdirTree: vi.fn(),
					analyzePath: (path: string) => ({ exists: files.has(path) }),
					readFile: (path: string) => files.get(path),
					writeFile: (path: string, contents: Uint8Array | string) =>
						files.set(path, contents)
				},
				callMain: vi.fn()
			};
			vi.stubGlobal('__testClangdRuntime', runtime);
			vi.mocked(URL.createObjectURL).mockReturnValue(
				'data:text/javascript,export default async () => globalThis.__testClangdRuntime;'
			);
			mocks.decompressGzip.mockResolvedValue(runtimeBytes);
			mocks.verifyRuntimeAssetIntegrity.mockResolvedValue(undefined);

			await scope.dispatch({
				type: 'init',
				baseUrl: 'https://assets.example.com/clangd/',
				assets: {
					clangdJs: new ArrayBuffer(0),
					clangdWasmGz: deliveryBytes.buffer,
					clangdWasmIntegrity: digest
						? {
								bytes: deliveryBytes.byteLength,
								sha256: 'a'.repeat(64),
								uncompressedBytes: runtimeBytes.byteLength,
								uncompressedSha256: digest
							}
						: undefined
				}
			});

			expect(scope.messages).not.toContainEqual(expect.objectContaining({ type: 'error' }));
			expect(scope.messages).toContainEqual({
				type: 'ready',
				value: runtimeBytes.byteLength
			});
			expect(mocks.verifyRuntimeAssetIntegrity).toHaveBeenCalledTimes(digest ? 1 : 0);
			expect(hash).toHaveBeenCalledTimes(digest ? 0 : 1);
			if (!digest) expect(hash).toHaveBeenCalledWith('SHA-256', runtimeBytes);
			expect(files.has('/lib/clang/22/include/stddef.h')).toBe(expectedOverlay);
			expect(String(files.get('/workspace/.clangd')).includes('-resource-dir')).toBe(
				expectedOverlay
			);
			expect(runtime.callMain).toHaveBeenCalledWith([]);
		}
	);
});
