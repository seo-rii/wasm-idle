import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
	addFile: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	loadRuntimeManifest: vi.fn(async () => ({})),
	resolveRuntimeManifestUrl: vi.fn((baseUrl: string) => `${baseUrl}runtime-manifest.v1.json`),
	verifyRuntimeAssetIntegrity: vi.fn(
		async (_request: {
			asset: string;
			bytes: Uint8Array;
			expected: { bytes: number; sha256: string };
			runtimeId: string;
		}) => undefined
	)
}));

vi.mock('@bjorn3/browser_wasi_shim', () => ({
	WASI: class {}
}));

vi.mock('$lib/playground/worker/assets', () => ({
	configureWorkerRuntimeAssets: workerMocks.configureWorkerRuntimeAssets,
	handleWorkerAssetMessage: workerMocks.handleWorkerAssetMessage
}));

vi.mock('@wasm-idle/llvm-core/clang', () => ({
	BrowserClangRuntime: class {
		ready = Promise.resolve();
		memfs = { addFile: workerMocks.addFile };
	},
	createBrowserWasiHost: vi.fn(),
	executeBrowserClangArtifact: vi.fn(),
	loadRuntimeManifest: workerMocks.loadRuntimeManifest,
	resolveRuntimeManifestUrl: workerMocks.resolveRuntimeManifestUrl
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRuntimeAssetIntegrity: workerMocks.verifyRuntimeAssetIntegrity
}));

const assetBaseUrl = 'https://assets.example.test/wasm-fortran/';
const originalFetch = globalThis.fetch;
const TEST_RECEIPTS = Object.freeze({
	'f2c.wasm': Object.freeze({
		bytes: 4,
		sha256: '1'.repeat(64)
	}),
	'libf2c.a': Object.freeze({
		bytes: 3,
		sha256: '3'.repeat(64)
	}),
	'f2c.h': Object.freeze({
		bytes: 18,
		sha256: '5'.repeat(64)
	})
});

function responseFor(data: Uint8Array, url: string) {
	return {
		async arrayBuffer() {
			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		},
		body: null,
		headers: new Headers({ 'content-length': String(data.byteLength) }),
		ok: true,
		status: 200,
		url
	};
}

describe('Fortran worker runtime assets', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		workerMocks.addFile.mockReset();
		workerMocks.configureWorkerRuntimeAssets.mockReset();
		workerMocks.handleWorkerAssetMessage.mockReset().mockReturnValue(false);
		workerMocks.loadRuntimeManifest.mockReset().mockResolvedValue({});
		workerMocks.resolveRuntimeManifestUrl
			.mockReset()
			.mockImplementation((baseUrl: string) => `${baseUrl}runtime-manifest.v1.json`);
		workerMocks.verifyRuntimeAssetIntegrity.mockReset().mockResolvedValue(undefined);
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('loads every f2c asset through the bounded least-authority fetch boundary', async () => {
		const assets = new Map([
			[`${assetBaseUrl}f2c.wasm`, new Uint8Array([0, 97, 115, 109])],
			[`${assetBaseUrl}libf2c.a`, new Uint8Array([1, 2, 3])],
			[`${assetBaseUrl}f2c.h`, new TextEncoder().encode('integer f2c(void);')]
		]);
		const fetchMock = vi.fn(async (url: string) => {
			const bytes = assets.get(url);
			if (!bytes) throw new Error(`unexpected asset: ${url}`);
			return responseFor(bytes, url);
		});
		(globalThis as any).fetch = fetchMock;
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({} as WebAssembly.Module);

		await import('./fortran');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: 'https://assets.example.test/clang/',
					useAssetBridge: false
				},
				fortranAssets: {
					f2cWasmUrl: `${assetBaseUrl}f2c.wasm`,
					libf2cUrl: `${assetBaseUrl}libf2c.a`,
					f2cHeaderUrl: `${assetBaseUrl}f2c.h`,
					integrity: TEST_RECEIPTS,
					maxAssetBytes: 128 * 1024 * 1024
				}
			}
		});

		const safeFetchOptions = {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		};
		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const url of assets.keys()) {
			expect(fetchMock).toHaveBeenCalledWith(url, safeFetchOptions);
		}
		expect(compile).toHaveBeenCalledWith(new Uint8Array([0, 97, 115, 109]));
		expect(workerMocks.verifyRuntimeAssetIntegrity).toHaveBeenCalledTimes(3);
		for (const [index, asset] of ['f2c.wasm', 'libf2c.a', 'f2c.h'].entries()) {
			expect(workerMocks.verifyRuntimeAssetIntegrity).toHaveBeenNthCalledWith(index + 1, {
				asset,
				bytes: expect.any(Uint8Array),
				expected: TEST_RECEIPTS[asset as keyof typeof TEST_RECEIPTS],
				runtimeId: 'FORTRAN'
			});
			const request = workerMocks.verifyRuntimeAssetIntegrity.mock.calls[index]?.[0];
			expect(request).toBeDefined();
			expect(Array.from(request!.bytes)).toEqual(
				Array.from(assets.get(`${assetBaseUrl}${asset}`) || [])
			);
		}
		expect(workerMocks.addFile).toHaveBeenCalledWith('f2c.h', 'integer f2c(void);');
		expect(workerMocks.addFile).toHaveBeenCalledWith('libf2c.a', new Uint8Array([1, 2, 3]));
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('rejects relative f2c asset URLs before network access', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);

		await import('./fortran');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: 'https://assets.example.test/clang/',
					useAssetBridge: false
				},
				fortranAssets: {
					f2cWasmUrl: '/wasm-fortran/f2c.wasm',
					libf2cUrl: '/wasm-fortran/libf2c.a',
					f2cHeaderUrl: '/wasm-fortran/f2c.h',
					integrity: TEST_RECEIPTS,
					maxAssetBytes: 128 * 1024 * 1024
				}
			}
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'f2c.wasm URL is invalid: /wasm-fortran/f2c.wasm'
		});
	});

	it('rejects an incomplete receipt set before loading any runtime asset', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;

		await import('./fortran');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: 'https://assets.example.test/clang/',
					useAssetBridge: false
				},
				fortranAssets: {
					f2cWasmUrl: `${assetBaseUrl}f2c.wasm`,
					libf2cUrl: `${assetBaseUrl}libf2c.a`,
					f2cHeaderUrl: `${assetBaseUrl}f2c.h`,
					integrity: {
						'f2c.wasm': TEST_RECEIPTS['f2c.wasm'],
						'libf2c.a': TEST_RECEIPTS['libf2c.a']
					},
					maxAssetBytes: 128 * 1024 * 1024
				}
			}
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(workerMocks.loadRuntimeManifest).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Fortran execution requires exactly three asset receipts'
		});
	});

	it('rejects an operation asset limit below a receipt before network access', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;

		await import('./fortran');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: 'https://assets.example.test/clang/',
					useAssetBridge: false
				},
				fortranAssets: {
					f2cWasmUrl: `${assetBaseUrl}f2c.wasm`,
					libf2cUrl: `${assetBaseUrl}libf2c.a`,
					f2cHeaderUrl: `${assetBaseUrl}f2c.h`,
					integrity: TEST_RECEIPTS,
					maxAssetBytes: 3
				}
			}
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(workerMocks.loadRuntimeManifest).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Fortran execution asset f2c.wasm exceeds the 3 byte limit'
		});
	});

	it('uses each receipt byte size as the exact fetch ceiling', async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const bytes = new Uint8Array([0, 97, 115, 109, 0]);
			return responseFor(bytes, url);
		});
		(globalThis as any).fetch = fetchMock;
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({} as WebAssembly.Module);

		await import('./fortran');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: 'https://assets.example.test/clang/',
					useAssetBridge: false
				},
				fortranAssets: {
					f2cWasmUrl: `${assetBaseUrl}f2c.wasm`,
					libf2cUrl: `${assetBaseUrl}libf2c.a`,
					f2cHeaderUrl: `${assetBaseUrl}f2c.h`,
					integrity: TEST_RECEIPTS,
					maxAssetBytes: 128 * 1024 * 1024
				}
			}
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(workerMocks.verifyRuntimeAssetIntegrity).not.toHaveBeenCalled();
		expect(workerMocks.loadRuntimeManifest).not.toHaveBeenCalled();
		expect(compile).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'f2c.wasm exceeds the 4 byte limit'
		});
	});

	it('does not compile or publish corrupt assets and permits a clean retry', async () => {
		const assets = new Map([
			[`${assetBaseUrl}f2c.wasm`, new Uint8Array([0, 97, 115, 109])],
			[`${assetBaseUrl}libf2c.a`, new Uint8Array([1, 2, 3])],
			[`${assetBaseUrl}f2c.h`, new TextEncoder().encode('integer f2c(void);')]
		]);
		const fetchMock = vi.fn(async (url: string) => {
			const bytes = assets.get(url);
			if (!bytes) throw new Error(`unexpected asset: ${url}`);
			return responseFor(bytes, url);
		});
		(globalThis as any).fetch = fetchMock;
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({} as WebAssembly.Module);
		workerMocks.verifyRuntimeAssetIntegrity.mockRejectedValueOnce(
			new Error('f2c.wasm integrity mismatch')
		);

		await import('./fortran');
		const load = () =>
			(globalThis as any).self.onmessage({
				data: {
					load: true,
					log: false,
					clangAssets: {
						baseUrl: 'https://assets.example.test/clang/',
						useAssetBridge: false
					},
					fortranAssets: {
						f2cWasmUrl: `${assetBaseUrl}f2c.wasm`,
						libf2cUrl: `${assetBaseUrl}libf2c.a`,
						f2cHeaderUrl: `${assetBaseUrl}f2c.h`,
						integrity: TEST_RECEIPTS,
						maxAssetBytes: 128 * 1024 * 1024
					}
				}
			});

		await load();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(compile).not.toHaveBeenCalled();
		expect(workerMocks.addFile).not.toHaveBeenCalled();
		expect(workerMocks.loadRuntimeManifest).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'f2c.wasm integrity mismatch'
		});

		workerMocks.verifyRuntimeAssetIntegrity.mockResolvedValue(undefined);
		await load();
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(compile).toHaveBeenCalledOnce();
		expect(workerMocks.addFile).toHaveBeenCalledTimes(2);
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({ load: true });
	});
});
