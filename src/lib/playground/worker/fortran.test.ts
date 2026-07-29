import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
	addFile: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	loadRuntimeManifest: vi.fn(async () => ({})),
	resolveRuntimeManifestUrl: vi.fn((baseUrl: string) => `${baseUrl}runtime-manifest.v1.json`)
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

const assetBaseUrl = 'https://assets.example.test/wasm-fortran/';
const originalFetch = globalThis.fetch;

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
					f2cHeaderUrl: `${assetBaseUrl}f2c.h`
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
					f2cHeaderUrl: '/wasm-fortran/f2c.h'
				}
			}
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'f2c.wasm URL is invalid: /wasm-fortran/f2c.wasm'
		});
	});
});
