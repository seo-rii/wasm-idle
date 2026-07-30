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

	it('aborts a stalled stream read and releases its reader', async () => {
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let resolveRead!: (result: { done: true; value: undefined }) => void;
		const readPending = new Promise<{ done: true; value: undefined }>((resolve) => {
			resolveRead = resolve;
		});
		const read = vi.fn(() => {
			markReadStarted();
			return readPending;
		});
		const cancel = vi.fn(async () => {
			resolveRead({ done: true, value: undefined });
		});
		const releaseLock = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const reason = new Error('stop stalled common worker asset stream');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = vi.fn();
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			onProgress: progress,
			signal: controller.signal
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await readStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(reason);
			expect(releaseLock).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(progress).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('aborts an uncooperative fetch promptly and cancels its late response', async () => {
		let resolveFetch!: (response: unknown) => void;
		const fetchStarted = new Promise<void>((resolve) => {
			(globalThis as any).fetch = vi.fn(() => {
				resolve();
				return new Promise((resolveResponse) => {
					resolveFetch = resolveResponse;
				});
			});
		});
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const lateResponse = {
			body: { cancel, getReader },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		};
		const controller = new AbortController();
		const reason = new Error('stop common worker asset fetch');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = vi.fn();
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			onProgress: progress,
			signal: controller.signal
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await fetchStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
			expect(getReader).not.toHaveBeenCalled();
			expect(progress).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
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

	it('aborts bodyless response materialization promptly and suppresses late progress', async () => {
		let markMaterializationStarted!: () => void;
		const materializationStarted = new Promise<void>((resolve) => {
			markMaterializationStarted = resolve;
		});
		let resolveArrayBuffer!: (value: ArrayBuffer) => void;
		const pendingArrayBuffer = new Promise<ArrayBuffer>((resolve) => {
			resolveArrayBuffer = resolve;
		});
		(globalThis as any).fetch = vi.fn(async () => ({
			arrayBuffer() {
				markMaterializationStarted();
				return pendingArrayBuffer;
			},
			body: null,
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const reason = new Error('stop bodyless common worker asset read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = vi.fn();
		let returnedBytes: Uint8Array | undefined;
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			onProgress: progress,
			signal: controller.signal
		});
		const observed = loading.then(
			(value) => {
				returnedBytes = value;
				return { status: 'resolved' as const, value };
			},
			(error) => ({ status: 'rejected' as const, reason: error as unknown })
		);
		const lateBytes = new Uint8Array([1, 2, 3]);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await materializationStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				observed,
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(returnedBytes).toBeUndefined();
			const abortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			expect(abortRegistrations.length).toBeGreaterThan(0);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			resolveArrayBuffer(lateBytes.buffer);
			await Promise.resolve();
			await Promise.resolve();
			expect(returnedBytes).toBeUndefined();
			expect(progress).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveArrayBuffer(lateBytes.buffer);
			await loading.catch(() => {});
		}
	});
});
