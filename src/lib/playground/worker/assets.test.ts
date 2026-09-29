import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalPostMessage = globalThis.postMessage;
const originalXmlHttpRequest = globalThis.XMLHttpRequest;
const runtimeBaseUrl = 'https://assets.example.test/runtime/';
const packageBaseUrl = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';

function createStreamResponse(
	chunks: Uint8Array[],
	{
		headers = {},
		status = 200,
		statusText = 'OK',
		url = `${runtimeBaseUrl}compiler.wasm`
	}: {
		headers?: Record<string, string>;
		status?: number;
		statusText?: string;
		url?: string;
	} = {}
) {
	const cancel = vi.fn(async () => undefined);
	const releaseLock = vi.fn();
	const remaining = [...chunks];
	const read = vi.fn(async () => {
		const value = remaining.shift();
		return value ? { done: false, value } : { done: true, value: undefined };
	});
	return {
		cancel,
		read,
		releaseLock,
		response: {
			body: {
				getReader: () => ({ cancel, read, releaseLock })
			},
			headers: new Headers(headers),
			ok: status >= 200 && status < 300,
			status,
			statusText,
			url
		}
	};
}

async function setupDirectAssetLoader(fetchMock: ReturnType<typeof vi.fn>, maxAssetBytes = 8) {
	(globalThis as any).fetch = fetchMock;
	(globalThis as any).postMessage = vi.fn();
	(globalThis as any).XMLHttpRequest = undefined;
	const assets = await import('./assets');
	assets.configureWorkerRuntimeAssets({
		baseUrl: runtimeBaseUrl,
		maxAssetBytes,
		useAssetBridge: false
	});
	return {
		...assets,
		postMessage: (globalThis as any).postMessage as ReturnType<typeof vi.fn>
	};
}

describe('worker direct runtime asset fallback', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		globalThis.postMessage = originalPostMessage;
		globalThis.XMLHttpRequest = originalXmlHttpRequest;
		vi.restoreAllMocks();
	});

	it.each([false, true])(
		'requests compiled modules independently of the byte bridge: %s',
		async (useAssetBridge) => {
			const fetchMock = vi.fn();
			const assets = await setupDirectAssetLoader(fetchMock);
			assets.configureWorkerRuntimeAssets({
				baseUrl: runtimeBaseUrl,
				useAssetBridge,
				useModuleBridge: true
			});
			const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
			const loading = assets.loadWorkerRuntimeModule('compiler.wasm');
			expect(assets.hasWorkerRuntimeModuleBridge()).toBe(true);
			expect(assets.postMessage).toHaveBeenCalledOnce();
			const request = assets.postMessage.mock.calls[0][0].assetRequest;
			expect(request).toEqual({
				id: expect.any(Number),
				asset: 'compiler.wasm',
				module: true
			});
			expect(
				assets.handleWorkerAssetMessage({
					assetResponse: { id: request.id, ok: true, module }
				})
			).toBe(true);
			await expect(loading).resolves.toBe(module);
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it.each([undefined, {}, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])])(
		'rejects module responses that are not compiled modules: %s',
		async (module) => {
			const assets = await setupDirectAssetLoader(vi.fn());
			assets.configureWorkerRuntimeAssets({
				baseUrl: runtimeBaseUrl,
				useAssetBridge: false,
				useModuleBridge: true
			});
			const loading = assets.loadWorkerRuntimeModule('compiler.wasm');
			const request = assets.postMessage.mock.calls[0][0].assetRequest;
			assets.handleWorkerAssetMessage({
				assetResponse: { id: request.id, ok: true, module }
			});
			await expect(loading).rejects.toThrow('Runtime module response is invalid');
		}
	);

	it('preserves host module errors without retrying a direct fetch', async () => {
		const fetchMock = vi.fn();
		const assets = await setupDirectAssetLoader(fetchMock);
		assets.configureWorkerRuntimeAssets({ baseUrl: runtimeBaseUrl, useAssetBridge: true });
		const loading = assets.loadWorkerRuntimeModule('compiler.wasm');
		const request = assets.postMessage.mock.calls[0][0].assetRequest;
		assets.handleWorkerAssetMessage({
			assetResponse: { id: request.id, ok: false, error: 'receipt verification failed' }
		});
		await expect(loading).rejects.toThrow('receipt verification failed');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([null, { baseUrl: 'https://replacement.example/runtime/', useAssetBridge: true }])(
		'rejects pending modules when runtime configuration resets: %s',
		async (replacement) => {
			const assets = await setupDirectAssetLoader(vi.fn());
			assets.configureWorkerRuntimeAssets({
				baseUrl: runtimeBaseUrl,
				useAssetBridge: false,
				useModuleBridge: true
			});
			const loading = assets.loadWorkerRuntimeModule('compiler.wasm');
			const rejection = expect(loading).rejects.toThrow(
				'Runtime module configuration changed'
			);
			const oldRequest = assets.postMessage.mock.calls[0][0].assetRequest;
			assets.configureWorkerRuntimeAssets(replacement);
			await rejection;
			const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
			expect(
				assets.handleWorkerAssetMessage({
					assetResponse: { id: oldRequest.id, ok: true, module }
				})
			).toBe(true);

			assets.configureWorkerRuntimeAssets({
				baseUrl: runtimeBaseUrl,
				useAssetBridge: false,
				useModuleBridge: true
			});
			const retry = assets.loadWorkerRuntimeModule('compiler.wasm');
			const request = assets.postMessage.mock.calls[1][0].assetRequest;
			expect(request.id).not.toBe(oldRequest.id);
			assets.handleWorkerAssetMessage({
				assetResponse: { id: request.id, ok: true, module }
			});
			await expect(retry).resolves.toBe(module);
		}
	);

	it('rejects a failed module postMessage and allows the next request', async () => {
		const assets = await setupDirectAssetLoader(vi.fn());
		assets.configureWorkerRuntimeAssets({
			baseUrl: runtimeBaseUrl,
			useAssetBridge: false,
			useModuleBridge: true
		});
		const failure = new Error('worker channel closed');
		assets.postMessage.mockImplementationOnce(() => {
			throw failure;
		});
		await expect(assets.loadWorkerRuntimeModule('compiler.wasm')).rejects.toBe(failure);
		const retry = assets.loadWorkerRuntimeModule('compiler.wasm');
		const request = assets.postMessage.mock.calls[1][0].assetRequest;
		const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		assets.handleWorkerAssetMessage({ assetResponse: { id: request.id, ok: true, module } });
		await expect(retry).resolves.toBe(module);
	});

	it('rejects unavailable or unconfined module requests before sending them to the host', async () => {
		const assets = await setupDirectAssetLoader(vi.fn());
		expect(assets.hasWorkerRuntimeModuleBridge()).toBe(false);
		await expect(assets.loadWorkerRuntimeModule('compiler.wasm')).rejects.toThrow(
			'Runtime module bridge unavailable'
		);
		assets.configureWorkerRuntimeAssets({
			baseUrl: runtimeBaseUrl,
			useAssetBridge: false,
			useModuleBridge: true
		});
		await expect(assets.loadWorkerRuntimeModule('../compiler.wasm')).rejects.toThrow(
			'Untracked runtime module request'
		);
		expect(assets.postMessage).not.toHaveBeenCalled();
	});

	it('streams a confined asset with least-authority fetch options and bounded progress', async () => {
		const streamed = createStreamResponse([new Uint8Array([1, 2]), new Uint8Array([3])], {
			headers: {
				'content-length': '3',
				'content-type': 'application/wasm'
			}
		});
		const fetchMock = vi.fn(async () => streamed.response);
		const { loadWorkerRuntimeAsset, postMessage } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).resolves.toEqual({
			bytes: new Uint8Array([1, 2, 3]),
			mimeType: 'application/wasm'
		});
		expect(fetchMock).toHaveBeenCalledWith(`${runtimeBaseUrl}compiler.wasm`, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect(streamed.cancel).not.toHaveBeenCalled();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
		expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
			{
				assetProgress: { asset: 'compiler.wasm', loaded: 2, total: 3 }
			},
			{
				assetProgress: { asset: 'compiler.wasm', loaded: 3, total: 3 }
			},
			{
				assetProgress: { asset: 'compiler.wasm', loaded: 3, total: 3 }
			}
		]);
	});

	it('rejects an oversized declaration before reading and cancels the body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		const fetchMock = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers({ 'content-length': '9' }),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: `${runtimeBaseUrl}compiler.wasm`
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'Runtime asset compiler.wasm exceeds the 8 byte limit'
		);
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('cancels an unknown-length stream as soon as it exceeds the byte limit', async () => {
		const streamed = createStreamResponse([new Uint8Array(3), new Uint8Array(2)], {
			headers: {}
		});
		const fetchMock = vi.fn(async () => streamed.response);
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock, 4);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'Runtime asset compiler.wasm exceeds the 4 byte limit'
		);
		expect(streamed.cancel).toHaveBeenCalledOnce();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it('cancels an unsuccessful response before reporting the HTTP status', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		const fetchMock = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: false,
			status: 503,
			statusText: 'Unavailable',
			url: `${runtimeBaseUrl}compiler.wasm`
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'Failed to load compiler.wasm: 503'
		);
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it.each(['pending', 'rejected', 'thrown'] as const)(
		'does not let a %s response cancellation hide the HTTP failure',
		async (cancelMode) => {
			const cleanupFailure = new Error('response cleanup failed');
			const bodyCancel = vi.fn(() => {
				if (cancelMode === 'pending') return new Promise<void>(() => undefined);
				if (cancelMode === 'rejected') return Promise.reject(cleanupFailure);
				throw cleanupFailure;
			});
			const fetchMock = vi.fn(async () => ({
				body: { cancel: bodyCancel },
				headers: new Headers(),
				ok: false,
				status: 503,
				statusText: 'Unavailable',
				url: `${runtimeBaseUrl}compiler.wasm`
			}));
			const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);
			const guardedLoad = Promise.race([
				loadWorkerRuntimeAsset('compiler.wasm'),
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => reject(new Error('response cleanup timed out')), 100);
				})
			]);

			await expect(guardedLoad).rejects.toThrow('Failed to load compiler.wasm: 503');
			expect(bodyCancel).toHaveBeenCalledOnce();
			expect(bodyCancel).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Failed to load compiler.wasm: 503' })
			);
		}
	);

	it('rejects a substituted final URL and cancels the response body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		const fetchMock = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: 'https://cdn.example.test/compiler.wasm'
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			`Runtime asset response URL mismatch: expected ${runtimeBaseUrl}compiler.wasm, received https://cdn.example.test/compiler.wasm`
		);
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it.each([
		'../private.wasm',
		'https://assets.example.test/runtime-sibling/compiler.wasm',
		'https://user:secret@assets.example.test/runtime/compiler.wasm',
		'https://assets.example.test/runtime/compiler.wasm#fragment',
		'https://assets.example.test/runtime/nested%2fcompiler.wasm'
	])('rejects an unconfined asset before native fetch: %s', async (asset) => {
		const fetchMock = vi.fn();
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset(asset)).rejects.toThrow(
			'Untracked runtime asset request'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('cancels and releases a reader when the asset stream fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('asset stream failed'));
		const fetchMock = vi.fn(async () => ({
			body: {
				getReader: () => ({ cancel, read, releaseLock })
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: `${runtimeBaseUrl}compiler.wasm`
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'asset stream failed'
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it.each(['pending', 'rejected', 'thrown'] as const)(
		'does not let a %s reader cancellation hide the byte-limit failure',
		async (cancelMode) => {
			const cleanupFailure = new Error('reader cleanup failed');
			const cancel = vi.fn(() => {
				if (cancelMode === 'pending') return new Promise<void>(() => undefined);
				if (cancelMode === 'rejected') return Promise.reject(cleanupFailure);
				throw cleanupFailure;
			});
			const releaseLock = vi.fn();
			const read = vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(5) });
			const fetchMock = vi.fn(async () => ({
				body: {
					getReader: () => ({ cancel, read, releaseLock })
				},
				headers: new Headers(),
				ok: true,
				status: 200,
				statusText: 'OK',
				url: `${runtimeBaseUrl}compiler.wasm`
			}));
			const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock, 4);
			const guardedLoad = Promise.race([
				loadWorkerRuntimeAsset('compiler.wasm'),
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => reject(new Error('reader cleanup timed out')), 100);
				})
			]);

			await expect(guardedLoad).rejects.toThrow(
				'Runtime asset compiler.wasm exceeds the 4 byte limit'
			);
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(
				expect.objectContaining({
					message: 'Runtime asset compiler.wasm exceeds the 4 byte limit'
				})
			);
			expect(releaseLock).toHaveBeenCalledOnce();
		}
	);

	it('preserves a stream failure when releasing the reader also fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn(() => {
			throw new Error('reader release failed');
		});
		const read = vi.fn().mockRejectedValueOnce(new Error('asset stream failed'));
		const fetchMock = vi.fn(async () => ({
			body: {
				getReader: () => ({ cancel, read, releaseLock })
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: `${runtimeBaseUrl}compiler.wasm`
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'asset stream failed'
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('reports a reader release failure after a successful stream', async () => {
		const streamed = createStreamResponse([new Uint8Array([1])]);
		streamed.releaseLock.mockImplementation(() => {
			throw new Error('reader release failed');
		});
		const fetchMock = vi.fn(async () => streamed.response);
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'reader release failed'
		);
		expect(streamed.cancel).not.toHaveBeenCalled();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it('checks the byte limit after a no-body fallback is materialized', async () => {
		const fetchMock = vi.fn(async () => ({
			arrayBuffer: async () => new Uint8Array(5).buffer,
			body: null,
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: `${runtimeBaseUrl}compiler.wasm`
		}));
		const { loadWorkerRuntimeAsset } = await setupDirectAssetLoader(fetchMock, 4);

		await expect(loadWorkerRuntimeAsset('compiler.wasm')).rejects.toThrow(
			'Runtime asset compiler.wasm exceeds the 4 byte limit'
		);
	});

	it('bounds an exact package allowlist and preserves native integrity verification', async () => {
		const packageUrl = `${packageBaseUrl}numpy-2.3.3-py3-none-any.whl`;
		const streamed = createStreamResponse([new Uint8Array([1, 2, 3])], {
			url: packageUrl
		});
		const fetchMock = vi.fn(async () => streamed.response);
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock, 4);
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: packageBaseUrl,
			assets: ['numpy-2.3.3-py3-none-any.whl']
		});

		const response = await globalThis.fetch(packageUrl, {
			integrity: 'sha256-ZGVtby1kaWdlc3Q='
		});

		await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
		expect(fetchMock).toHaveBeenCalledWith(packageUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			integrity: 'sha256-ZGVtby1kaWdlc3Q='
		});
	});

	it('cancels an allowlisted package stream when it exceeds the caller ceiling', async () => {
		const packageAsset = 'numpy-2.3.3-py3-none-any.whl';
		const packageUrl = `${packageBaseUrl}${packageAsset}`;
		const streamed = createStreamResponse([new Uint8Array(3), new Uint8Array(2)], {
			url: packageUrl
		});
		const fetchMock = vi.fn(async () => streamed.response);
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock, 4);
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: packageBaseUrl,
			assets: [packageAsset]
		});

		await expect(globalThis.fetch(packageUrl)).rejects.toThrow(
			`Runtime asset ${packageAsset} exceeds the 4 byte limit`
		);
		expect(streamed.cancel).toHaveBeenCalledOnce();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects an oversized allowlisted package declaration before reading it', async () => {
		const packageAsset = 'numpy-2.3.3-py3-none-any.whl';
		const packageUrl = `${packageBaseUrl}${packageAsset}`;
		const bodyCancel = vi.fn(async () => undefined);
		const fetchMock = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers({ 'content-length': '5' }),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: packageUrl
		}));
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock, 4);
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: packageBaseUrl,
			assets: [packageAsset]
		});

		await expect(globalThis.fetch(packageUrl)).rejects.toThrow(
			`Runtime asset ${packageAsset} exceeds the 4 byte limit`
		);
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('fails closed for package-base paths absent from the exact allowlist', async () => {
		const fetchMock = vi.fn();
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock);
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: packageBaseUrl,
			assets: ['numpy-2.3.3-py3-none-any.whl']
		});

		await expect(globalThis.fetch(`${packageBaseUrl}unlisted.whl`)).rejects.toThrow(
			'Untracked runtime asset request'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps the exact allowlist authoritative when package and runtime bases overlap', async () => {
		const packageAsset = 'numpy-2.3.3-py3-none-any.whl';
		const packageUrl = `${runtimeBaseUrl}${packageAsset}`;
		const fetchMock = vi.fn(
			async (input: string) =>
				createStreamResponse([new Uint8Array([1, 2, 3])], { url: input }).response
		);
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock, 4);
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: runtimeBaseUrl,
			assets: [packageAsset],
			runtimeAssets: ['compiler.wasm']
		});

		await expect(globalThis.fetch(packageUrl)).resolves.toBeInstanceOf(Response);
		await expect(globalThis.fetch(`${runtimeBaseUrl}compiler.wasm`)).resolves.toBeInstanceOf(
			Response
		);
		await expect(globalThis.fetch(`${runtimeBaseUrl}unlisted.whl`)).rejects.toThrow(
			'Untracked runtime asset request'
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		'../numpy.whl',
		'nested/numpy.whl',
		'https://untrusted.example/numpy.whl',
		'numpy.whl?mirror=untrusted'
	])('rejects an unsafe direct allowlist entry: %s', async (asset) => {
		const fetchMock = vi.fn();
		const { configureWorkerRuntimeAssetAllowlist } = await setupDirectAssetLoader(fetchMock);

		expect(() =>
			configureWorkerRuntimeAssetAllowlist({ baseUrl: packageBaseUrl, assets: [asset] })
		).toThrow(`Direct runtime asset name is unsafe: ${asset}`);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
