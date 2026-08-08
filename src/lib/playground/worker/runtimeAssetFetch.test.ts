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

	it.each([null, false, 0, ''])(
		'preserves the exact falsy pre-abort reason %j before fetching an asset',
		async (reason) => {
			const fetchMock = vi.fn();
			(globalThis as any).fetch = fetchMock;
			const controller = new AbortController();
			controller.abort(reason);

			await expect(
				fetchRuntimeAssetBytes({
					url: assetUrl,
					label: 'test compiler',
					signal: controller.signal
				})
			).rejects.toBe(reason);
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('preserves exact null while aborting an uncooperative asset fetch', async () => {
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		let resolveFetch!: (response: unknown) => void;
		(globalThis as any).fetch = vi.fn(() => {
			markFetchStarted();
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		});
		const cancel = vi.fn(async () => undefined);
		const lateResponse = {
			body: { cancel, getReader: vi.fn() },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		};
		const controller = new AbortController();
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			signal: controller.signal
		});

		try {
			await fetchStarted;
			controller.abort(null);
			await expect(loading).rejects.toBeNull();
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(null));
		} finally {
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('preserves exact null while cancelling a pending asset stream read', async () => {
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let resolveRead!: (value: { done: true; value: undefined }) => void;
		const read = vi.fn(() => {
			markReadStarted();
			return new Promise<{ done: true; value: undefined }>((resolve) => {
				resolveRead = resolve;
			});
		});
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			signal: controller.signal
		});

		try {
			await readStarted;
			controller.abort(null);
			await expect(loading).rejects.toBeNull();
			expect(cancel).toHaveBeenCalledWith(null);
			expect(releaseLock).toHaveBeenCalledOnce();
		} finally {
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('rejects before fetching when abort listener registration fails', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;
		const controller = new AbortController();
		const reason = new Error('abort listener registration failed');
		vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => {
			throw reason;
		});
		const removeEventListener = vi
			.spyOn(controller.signal, 'removeEventListener')
			.mockImplementation(() => undefined);

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(removeEventListener).toHaveBeenCalledOnce();
	});

	it('preserves a synchronous abort raised by failing listener registration', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;
		const controller = new AbortController();
		const reason = new Error('abort while registering listener');
		const registrationFailure = new Error('listener registration failed afterward');
		vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => {
			controller.abort(reason);
			throw registrationFailure;
		});

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('preserves an abort raised while observing the initial signal state', async () => {
		const fetchMock = vi.fn();
		(globalThis as any).fetch = fetchMock;
		const controller = new AbortController();
		const reason = new Error('abort during initial signal observation');
		const getterFailure = new Error('aborted getter failed afterward');
		Object.defineProperty(controller.signal, 'aborted', {
			configurable: true,
			get() {
				controller.abort(reason);
				throw getterFailure;
			}
		});

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('preserves an abort raised before fetch throws', async () => {
		const controller = new AbortController();
		const reason = new Error('abort inside fetch');
		const fetchFailure = new Error('fetch failed afterward');
		(globalThis as any).fetch = vi.fn(() => {
			controller.abort(reason);
			throw fetchFailure;
		});

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
	});

	it.each(['before', 'after'] as const)(
		'preserves an abort raised %s successful listener removal',
		async (abortOrder) => {
			(globalThis as any).fetch = vi.fn(async () => ({
				arrayBuffer: async () => new Uint8Array([1]).buffer,
				body: null,
				headers: new Headers(),
				ok: true,
				status: 200,
				url: assetUrl
			}));
			const controller = new AbortController();
			const reason = new Error(`abort ${abortOrder} listener removal`);
			const removeEventListener = controller.signal.removeEventListener.bind(
				controller.signal
			);
			vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
				(type, listener, options) => {
					if (abortOrder === 'before') controller.abort(reason);
					removeEventListener(type, listener, options);
					if (abortOrder === 'after') controller.abort(reason);
				}
			);

			await expect(
				fetchRuntimeAssetBytes({
					url: assetUrl,
					label: 'test compiler',
					signal: controller.signal
				})
			).rejects.toBe(reason);
		}
	);

	it('preserves cancellation when abort listener removal throws', async () => {
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		let resolveFetch!: (response: unknown) => void;
		(globalThis as any).fetch = vi.fn(() => {
			markFetchStarted();
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		});
		const cancel = vi.fn(async () => undefined);
		const lateResponse = {
			body: { cancel, getReader: vi.fn() },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		};
		const controller = new AbortController();
		const reason = new Error('stop despite listener cleanup failure');
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw new Error('listener cleanup failed');
		});
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			signal: controller.signal
		});

		try {
			await fetchStarted;
			controller.abort(reason);
			await expect(loading).rejects.toBe(reason);
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
		} finally {
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('snapshots a reentrant abort reason once for rejection and late cleanup', async () => {
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		let resolveFetch!: (response: unknown) => void;
		(globalThis as any).fetch = vi.fn(() => {
			markFetchStarted();
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		});
		const cancel = vi.fn(async () => undefined);
		const lateResponse = {
			body: { cancel, getReader: vi.fn() },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		};
		const controller = new AbortController();
		const firstReason = new Error('first abort reason');
		const replacementReason = new Error('replacement abort reason');
		let reasonReads = 0;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get() {
				reasonReads += 1;
				return reasonReads === 1 ? firstReason : replacementReason;
			}
		});
		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			signal: controller.signal
		});

		try {
			await fetchStarted;
			controller.abort(firstReason);
			await expect(loading).rejects.toBe(firstReason);
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(firstReason));
			expect(reasonReads).toBe(1);
		} finally {
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('cancels and releases an acquired reader when abort state observation fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const read = vi.fn();
		const releaseLock = vi.fn();
		let readerAcquired = false;
		(globalThis as any).fetch = vi.fn(async () => ({
			body: {
				getReader() {
					readerAcquired = true;
					return { cancel, read, releaseLock };
				}
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const reason = new Error('abort state getter failed');
		Object.defineProperty(controller.signal, 'aborted', {
			configurable: true,
			get() {
				if (readerAcquired) throw reason;
				return false;
			}
		});

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledWith(reason);
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('preserves an abort raised before a response getter throws', async () => {
		const controller = new AbortController();
		const reason = new Error('abort inside response getter');
		const getterFailure = new Error('response getter failed afterward');
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel, getReader: vi.fn() },
			headers: new Headers(),
			get ok() {
				controller.abort(reason);
				throw getterFailure;
			},
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(bodyCancel).toHaveBeenCalledWith(reason);
	});

	it('preserves an abort raised before reader acquisition throws', async () => {
		const controller = new AbortController();
		const reason = new Error('abort while acquiring reader');
		const readerFailure = new Error('reader acquisition failed afterward');
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch = vi.fn(async () => ({
			body: {
				cancel: bodyCancel,
				getReader() {
					controller.abort(reason);
					throw readerFailure;
				}
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(bodyCancel).toHaveBeenCalledWith(reason);
	});

	it('preserves a bodyless progress callback abort', async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			arrayBuffer: async () => new Uint8Array([1]).buffer,
			body: null,
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const reason = new Error('stop bodyless progress');
		const progress = vi.fn(() => controller.abort(reason));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				onProgress: progress,
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(progress).toHaveBeenCalledOnce();
	});

	it('consumes a late bodyless rejection after a synchronous abort', async () => {
		const controller = new AbortController();
		const reason = new Error('abort while starting bodyless materialization');
		const lateFailure = new Error('late bodyless materialization failure');
		let rejectMaterialization!: (reason: unknown) => void;
		(globalThis as any).fetch = vi.fn(async () => ({
			arrayBuffer() {
				controller.abort(reason);
				return new Promise<ArrayBuffer>((_resolve, reject) => {
					rejectMaterialization = reject;
				});
			},
			body: null,
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		rejectMaterialization(lateFailure);
		await Promise.resolve();
		await Promise.resolve();
	});

	it('preserves a final stream progress callback abort', async () => {
		const streamed = createStreamResponse([]);
		(globalThis as any).fetch = vi.fn(async () => streamed.response);
		const controller = new AbortController();
		const reason = new Error('stop final stream progress');
		const progress = vi.fn(() => controller.abort(reason));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				onProgress: progress,
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(progress).toHaveBeenCalledOnce();
		expect(streamed.cancel).toHaveBeenCalledWith(reason);
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it('consumes a late stream-read rejection after a synchronous abort', async () => {
		const controller = new AbortController();
		const reason = new Error('abort while starting stream read');
		const lateFailure = new Error('late stream read failure');
		let rejectRead!: (reason: unknown) => void;
		const read = vi.fn(() => {
			controller.abort(reason);
			return new Promise<{ done: true; value: undefined }>((_resolve, reject) => {
				rejectRead = reject;
			});
		});
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(cancel).toHaveBeenCalledWith(reason);
		expect(releaseLock).toHaveBeenCalledOnce();
		rejectRead(lateFailure);
		await Promise.resolve();
		await Promise.resolve();
	});

	it('cancels and releases the reader when the initial buffer allocation fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const read = vi.fn();
		const releaseLock = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { getReader: () => ({ cancel, read, releaseLock }) },
			headers: new Headers({ 'content-length': String(Number.MAX_SAFE_INTEGER) }),
			ok: true,
			status: 200,
			url: assetUrl
		}));
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		const loading = fetchRuntimeAssetBytes({
			url: assetUrl,
			label: 'test compiler',
			maxAssetBytes: Number.MAX_SAFE_INTEGER,
			signal: controller.signal
		});
		const outcome = await loading.then(
			(value) => ({ status: 'resolved' as const, value }),
			(error) => ({ status: 'rejected' as const, reason: error as unknown })
		);

		expect(outcome.status).toBe('rejected');
		if (outcome.status !== 'rejected') throw new Error('expected asset fetch to reject');
		expect(outcome.reason).toMatchObject({ name: 'RangeError' });
		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledWith(outcome.reason);
		expect(releaseLock).toHaveBeenCalledOnce();
		const abortRegistrations = addEventListener.mock.calls.filter(([type]) => type === 'abort');
		expect(abortRegistrations).toHaveLength(1);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}
	});

	it('preserves an abort raised while acquiring the stream reader', async () => {
		const controller = new AbortController();
		const reason = new Error('stop while acquiring the common worker asset reader');
		const cancel = vi.fn(async () => undefined);
		const read = vi.fn();
		const releaseLock = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			body: {
				getReader() {
					controller.abort(reason);
					return { cancel, read, releaseLock };
				}
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			url: assetUrl
		}));

		await expect(
			fetchRuntimeAssetBytes({
				url: assetUrl,
				label: 'test compiler',
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledWith(reason);
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'aborts a stalled stream read without awaiting %s cancellation',
		async (cancellationMode) => {
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
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn(() => {
				if (cancellationMode === 'throw') throw new Error('reader cleanup threw');
				if (cancellationMode === 'reject') {
					return Promise.reject(new Error('reader cleanup rejected'));
				}
				return stalledCancellation;
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
				expect(abortRegistrations).toHaveLength(1);
				for (const registration of abortRegistrations) {
					expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
				}
				expect(progress).not.toHaveBeenCalled();
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				resolveRead({ done: true, value: undefined });
				await loading.catch(() => {});
			}
		}
	);

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

	it.each(['pending', 'throw', 'reject'] as const)(
		'reports an unsuccessful response without awaiting %s cancellation',
		async (cancellationMode) => {
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const bodyCancel = vi.fn((_reason?: unknown) => {
				if (cancellationMode === 'throw') throw new Error('response cleanup threw');
				if (cancellationMode === 'reject') {
					return Promise.reject(new Error('response cleanup rejected'));
				}
				return stalledCancellation;
			});
			(globalThis as any).fetch = vi.fn(async () => ({
				body: { cancel: bodyCancel },
				headers: new Headers(),
				ok: false,
				status: 503,
				url: assetUrl
			}));

			const loading = fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' });
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				const outcome = await Promise.race([
					loading.then(
						(value) => ({ status: 'resolved' as const, value }),
						(error) => ({ status: 'rejected' as const, reason: error as unknown })
					),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome.status).toBe('rejected');
				if (outcome.status !== 'rejected')
					throw new Error('expected asset fetch to reject');
				expect(outcome.reason).toMatchObject({
					message: `failed to load test compiler from ${assetUrl}: 503`
				});
				expect(bodyCancel).toHaveBeenCalledOnce();
				expect(bodyCancel.mock.calls[0]?.[0]).toBe(outcome.reason);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await loading.catch(() => {});
			}
		}
	);

	it('cancels and releases an unknown-length stream at the byte limit', async () => {
		const streamed = createStreamResponse([new Uint8Array(3), new Uint8Array(2)]);
		(globalThis as any).fetch = vi.fn(async () => streamed.response);

		await expect(
			fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler', maxAssetBytes: 4 })
		).rejects.toThrow('test compiler exceeds the 4 byte limit');
		expect(streamed.cancel).toHaveBeenCalledOnce();
		expect(streamed.releaseLock).toHaveBeenCalledOnce();
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'preserves a stream failure without awaiting %s cancellation',
		async (cancellationMode) => {
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn(() => {
				if (cancellationMode === 'throw') throw new Error('stream cleanup threw');
				if (cancellationMode === 'reject') {
					return Promise.reject(new Error('stream cleanup rejected'));
				}
				return stalledCancellation;
			});
			const releaseLock = vi.fn();
			const reason = new Error('stream failed');
			const read = vi.fn().mockRejectedValueOnce(reason);
			(globalThis as any).fetch = vi.fn(async () => ({
				body: { getReader: () => ({ cancel, read, releaseLock }) },
				headers: new Headers(),
				ok: true,
				status: 200,
				url: assetUrl
			}));

			const loading = fetchRuntimeAssetBytes({ url: assetUrl, label: 'test compiler' });
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
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
				expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
					releaseLock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
				);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await loading.catch(() => {});
			}
		}
	);

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
