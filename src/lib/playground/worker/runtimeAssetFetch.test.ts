import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRuntimeAssetBytes } from './runtimeAssetFetch';

const originalFetch = globalThis.fetch;
const assetUrl = 'https://assets.example.test/runtime/compiler.wasm';

function createStreamResponse(
	chunks: Uint8Array[],
	{
		headers = {},
		status = 200,
		url = assetUrl
	}: { headers?: Record<string, string>; status?: number; url?: string } = {}
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
		releaseLock,
		response: {
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers(headers),
			ok: status >= 200 && status < 300,
			status,
			url
		}
	};
}

describe('runtime asset fetch', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('uses least-authority fetch options and streams into a bounded buffer', async () => {
		const streamed = createStreamResponse([new Uint8Array([1, 2]), new Uint8Array([3])], {
			headers: { 'content-length': '3' }
		});
		const fetchMock = vi.fn(async () => streamed.response);
		(globalThis as any).fetch = fetchMock;
		const progress = vi.fn();

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				cache: 'no-store',
				onProgress: progress
			})
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
		expect(fetchMock).toHaveBeenCalledWith(assetUrl, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect(progress.mock.calls.map(([value]) => value)).toEqual([
			{ loaded: 2, total: 3 },
			{ loaded: 3, total: 3 },
			{ loaded: 3, total: 3 }
		]);
		expect(streamed.cancel).not.toHaveBeenCalled();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it.each([
		'/runtime/compiler.wasm',
		'file:///tmp/compiler.wasm',
		'https://user:secret@assets.example.test/runtime/compiler.wasm',
		'https://assets.example.test/runtime/compiler.wasm#fragment',
		'https://assets.example.test/runtime/nested%2fcompiler.wasm'
	])('rejects an unsafe configured URL before fetch: %s', async (url) => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;

		await expect(fetchRuntimeAssetBytes({ url, label: 'test compiler' })).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects an oversized declaration and cancels its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers({ 'content-length': '9' }),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler', maxAssetBytes: 8 })
		).rejects.toThrow('test compiler exceeds the 8 byte limit');
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('cancels an unsuccessful response before reporting its status', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: false,
			status: 503,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' })
		).rejects.toThrow(`failed to load test compiler from ${assetUrl}: 503`);
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('cancels and releases an unknown-length stream at the byte limit', async () => {
		const streamed = createStreamResponse([new Uint8Array(3), new Uint8Array(2)]);
		(globalThis as any).fetch = vi.fn(async () => streamed.response);

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler', maxAssetBytes: 4 })
		).rejects.toThrow('test compiler exceeds the 4 byte limit');
		expect(streamed.cancel).toHaveBeenCalledOnce();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it('cancels and releases a reader when the stream fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('stream failed'));
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' })
		).rejects.toThrow('stream failed');
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects a substituted final URL and cancels its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: 'https://cdn.example.test/compiler.wasm'
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' })
		).rejects.toThrow('test compiler response URL mismatch');
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('rejects a relative final URL and cancels its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: 'compiler.wasm'
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' })
		).rejects.toThrow('test compiler response URL is invalid: compiler.wasm');
		expect(bodyCancel).toHaveBeenCalledOnce();
	});

	it('checks the byte limit after materializing a no-body response', async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			arrayBuffer: async () => new Uint8Array(5).buffer,
			body: null,
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler', maxAssetBytes: 4 })
		).rejects.toThrow('test compiler exceeds the 4 byte limit');
	});
});
