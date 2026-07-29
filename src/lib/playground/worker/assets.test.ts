import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalPostMessage = globalThis.postMessage;
const originalXmlHttpRequest = globalThis.XMLHttpRequest;
const runtimeBaseUrl = 'https://assets.example.test/runtime/';

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
});
