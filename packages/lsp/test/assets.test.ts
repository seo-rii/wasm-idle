import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLanguageToolAsset } from '../src/assets.js';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('language tool asset loading', () => {
	it('rejects assets outside the clangd runtime allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'../../private',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected clangd runtime asset: ../../private');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects assets outside the D bootstrap allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'd',
				'../../private',
				{ baseUrl: 'https://assets.example.com/wasm-d/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected D runtime asset: ../../private');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects assets outside the Tcl diagnostic worker allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'tcl',
				'../../private',
				{ baseUrl: 'https://assets.example.com/wasm-tcl/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected Tcl runtime asset: ../../private');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects assets outside the Perl diagnostic worker allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'perl',
				'unexpected.js',
				{ baseUrl: 'https://assets.example.com/wasm-perl/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected Perl runtime asset: unexpected.js');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects assets outside the Janet diagnostic worker allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'janet',
				'unexpected.js',
				{ baseUrl: 'https://assets.example.com/wasm-janet/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected Janet runtime asset: unexpected.js');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects assets outside the Ruby runtime allowlist before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'ruby',
				'../../private',
				{ baseUrl: 'https://assets.example.com/wasm-ruby/' },
				vi.fn()
			)
		).rejects.toThrow('Unexpected Ruby runtime asset: ../../private');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('enforces exact no-store response URLs for D bootstrap assets', async () => {
		const cancel = vi.fn(async () => {});
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://assets.example.com/wasm-d/index.js?v=substituted',
			headers: new Headers(),
			body: { cancel }
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'd',
				'index.js',
				{
					baseUrl: 'https://assets.example.com/wasm-d/',
					cache: 'no-store',
					redirect: 'error',
					requireExactResponseUrl: true
				},
				vi.fn()
			)
		).rejects.toThrow('Runtime asset index.js returned an unexpected final URL');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://assets.example.com/wasm-d/index.js',
			expect.objectContaining({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error'
			})
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not treat an empty D receipt as integrity opt-out', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url: 'https://assets.example.com/wasm-d/index.js',
				headers: new Headers({ 'Content-Length': '1' }),
				body: null,
				arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.of(1).buffer)
			})
		);

		await expect(
			loadLanguageToolAsset(
				'd',
				'index.js',
				{
					baseUrl: 'https://assets.example.com/wasm-d/',
					integrity: { 'index.js': '' }
				},
				vi.fn()
			)
		).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			runtimeId: 'd'
		});
	});

	it('attributes malformed D response lengths to the D runtime', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url: 'https://assets.example.com/wasm-d/index.js',
				headers: new Headers({ 'Content-Length': '1e2' }),
				body: { cancel: vi.fn(async () => {}) }
			})
		);

		await expect(
			loadLanguageToolAsset(
				'd',
				'index.js',
				{ baseUrl: 'https://assets.example.com/wasm-d/' },
				vi.fn()
			)
		).rejects.toMatchObject({
			name: 'ProtocolError',
			phase: 'asset',
			runtimeId: 'd'
		});
	});

	it.each([
		[
			'credentials',
			'https://user:secret@assets.example.com/clangd/clangd.js',
			'Runtime asset clangd.js URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.com/clangd/clangd.js#token',
			'Runtime asset clangd.js URL must not include a fragment'
		]
	])('rejects custom-loader URLs containing %s before fetching', async (_kind, url, message) => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					loader: () => url
				},
				vi.fn()
			)
		).rejects.toThrow(message);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a clangd asset whose configured SHA-256 digest does not match', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-type' ? 'text/javascript; charset=utf-8' : null
					)
				},
				body: null,
				arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					integrity: {
						'clangd.js': {
							bytes: 3,
							sha256: '0'.repeat(64),
							mediaType: 'text/javascript'
						}
					}
				},
				vi.fn()
			)
		).rejects.toThrow(
			'Runtime asset clangd.js compressed SHA-256 mismatch: expected ' +
				'0'.repeat(64) +
				', received 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
		);
	});

	it('assembles a stream in bounded storage when Content-Length is inaccurate', async () => {
		const releaseLock = vi.fn();
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5, 6]) })
				.mockResolvedValueOnce({ done: true, value: undefined }),
			cancel: vi.fn(),
			releaseLock
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-length' ? '4' : 'application/wasm'
					)
				},
				body: { getReader: () => reader }
			})
		);
		const copySpy = vi.spyOn(Uint8Array, 'from');

		const loaded = await loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{ baseUrl: 'https://assets.example.com/clangd/' },
			vi.fn()
		);

		expect(copySpy).not.toHaveBeenCalled();
		expect([...loaded.bytes]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects an oversized response before reading its body', async () => {
		const read = vi.fn();
		const cancel = vi.fn(async () => {});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-length' ? String(128 * 1024 * 1024 + 1) : null
					)
				},
				body: { cancel, getReader: () => ({ read }) }
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.wasm.gz',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Runtime asset clangd.wasm.gz exceeds the 134217728 byte limit');
		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('cancels a streamed response that crosses the asset limit', async () => {
		const cancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: { get: vi.fn(() => null) },
				body: {
					getReader: () => ({
						read: vi.fn().mockResolvedValueOnce({
							done: false,
							value: { byteLength: 128 * 1024 * 1024 + 1 } as Uint8Array
						}),
						cancel,
						releaseLock
					})
				}
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.wasm.gz',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Runtime asset clangd.wasm.gz exceeds the 134217728 byte limit');
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects redirects outside the configured asset bases and omits credentials', async () => {
		const cancel = vi.fn(async () => {});
		const secret = 'signed-final-url-secret';
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			url: `https://evil.example.com/clangd/clangd.js?signature=${secret}`,
			headers: { get: vi.fn(() => null) },
			body: { cancel },
			arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
		});
		vi.stubGlobal('fetch', fetchMock);

		let rejected: unknown;
		try {
			await loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'Runtime asset clangd.js URL is outside the allowed asset bases'
		);
		expect((rejected as Error).message).not.toContain(secret);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://assets.example.com/clangd/clangd.js',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			})
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects a relative final response URL before reading its body', async () => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const arrayBuffer = vi.fn();
		const invalidFinalUrl = '://invalid-final-url-secret';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: invalidFinalUrl,
				headers: { get: vi.fn(() => null) },
				body: { cancel, getReader },
				arrayBuffer
			})
		);

		let rejected: unknown;
		try {
			await loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'Runtime asset clangd.js has an invalid final response URL'
		);
		expect((rejected as Error).message).not.toContain(invalidFinalUrl);
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each([
		[
			'credentials',
			'https://user:secret@assets.example.com/clangd/clangd.js',
			'Runtime asset clangd.js URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.com/clangd/clangd.js#token',
			'Runtime asset clangd.js URL must not include a fragment'
		]
	])('rejects final response URLs containing %s before reading', async (_kind, url, message) => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const arrayBuffer = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url,
				headers: new Headers(),
				body: { cancel, getReader },
				arrayBuffer
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow(message);
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each(['', '-1', '1.5', '1e2', '3, clangd-header-secret', '9007199254740992'])(
		'rejects and cancels an invalid Content-Length before reading: %s',
		async (contentLength) => {
			const cancel = vi.fn(async () => {});
			const getReader = vi.fn();
			const arrayBuffer = vi.fn();
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					url: 'https://assets.example.com/clangd/clangd.js',
					headers: new Headers({ 'content-length': contentLength }),
					body: { cancel, getReader },
					arrayBuffer
				})
			);

			let rejected: unknown;
			try {
				await loadLanguageToolAsset(
					'clangd',
					'clangd.js',
					{ baseUrl: 'https://assets.example.com/clangd/' },
					vi.fn()
				);
			} catch (error) {
				rejected = error;
			}
			expect(rejected).toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'clangd',
				message: 'Runtime asset clangd.js has an invalid Content-Length'
			});
			if (contentLength) expect((rejected as Error).message).not.toContain(contentLength);
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
		}
	);

	it('retries after an invalid Content-Length and releases the successful reader', async () => {
		const firstCancel = vi.fn(async () => {});
		const firstGetReader = vi.fn();
		const retryCancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		const retryReader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: Uint8Array.of(1) })
				.mockResolvedValueOnce({ done: true, value: undefined }),
			cancel: retryCancel,
			releaseLock
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: new Headers({ 'content-length': '1, clangd-header-secret' }),
				body: { cancel: firstCancel, getReader: firstGetReader }
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: new Headers({ 'content-length': '1' }),
				body: { getReader: () => retryReader }
			});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'asset',
			runtimeId: 'clangd',
			message: 'Runtime asset clangd.js has an invalid Content-Length'
		});

		const loaded = await loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{ baseUrl: 'https://assets.example.com/clangd/' },
			vi.fn()
		);

		expect(Array.from(loaded.bytes)).toEqual([1]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(firstCancel).toHaveBeenCalledOnce();
		expect(firstGetReader).not.toHaveBeenCalled();
		expect(retryCancel).not.toHaveBeenCalled();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('cancels failed HTTP responses before reporting their status', async () => {
		const cancel = vi.fn(async () => {});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: { get: vi.fn(() => null) },
				body: { cancel }
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn()
			)
		).rejects.toThrow('Failed to load clangd.js: 503');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not publish partial bytes when cancellation completes a stream read', async () => {
		const controller = new AbortController();
		const cancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: 'https://assets.example.com/clangd/clangd.js',
				headers: { get: vi.fn(() => null) },
				body: {
					getReader: () => ({
						read: vi.fn(async () => {
							controller.abort(new Error('cancelled during read'));
							return { done: true, value: undefined };
						}),
						cancel,
						releaseLock
					})
				}
			})
		);

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{ baseUrl: 'https://assets.example.com/clangd/' },
				vi.fn(),
				{ signal: controller.signal }
			)
		).rejects.toThrow('cancelled during read');
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it.each([
		['while reader cancellation remains pending', false],
		['when reader cancellation resolves without settling the read', true]
	])('releases a stalled stream read on caller abort %s', async (_case, resolveCancellation) => {
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let resolveRead!: (result: { done: true; value: undefined }) => void;
		const pendingRead = new Promise<{ done: true; value: undefined }>((resolve) => {
			resolveRead = resolve;
		});
		const read = vi.fn(() => {
			markReadStarted();
			return pendingRead;
		});
		let resolveCancel!: () => void;
		const pendingCancel = new Promise<void>((resolve) => {
			resolveCancel = resolve;
		});
		const cancel = vi.fn(() => (resolveCancellation ? Promise.resolve() : pendingCancel));
		let markReleased!: () => void;
		const released = new Promise<void>((resolve) => {
			markReleased = resolve;
		});
		const releaseLock = vi.fn(() => markReleased());
		let addEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const signal = init?.signal as AbortSignal;
				addEventListener = vi.spyOn(signal, 'addEventListener');
				removeEventListener = vi.spyOn(signal, 'removeEventListener');
				return {
					ok: true,
					url: 'https://assets.example.com/clangd/clangd.js',
					headers: { get: vi.fn(() => null) },
					body: { getReader: () => ({ read, cancel, releaseLock }) }
				};
			})
		);
		const controller = new AbortController();
		const reason = new Error('cancelled during stalled stream read');
		const reportProgress = vi.fn();
		const loading = loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{ baseUrl: 'https://assets.example.com/clangd/' },
			reportProgress,
			{ signal: controller.signal }
		);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await readStarted;
			controller.abort(reason);
			await expect(loading).rejects.toBe(reason);
			const cleanup = await Promise.race([
				released.then(() => 'released' as const),
				new Promise<'pending'>((resolve) => {
					timeout = setTimeout(() => resolve('pending'), 25);
				})
			]);

			expect(cleanup).toBe('released');
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(reason);
			expect(releaseLock).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener?.mock.calls.filter(
				([type]) => type === 'abort'
			);
			expect(abortRegistrations).toHaveLength(1);
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistrations?.[0]?.[1]);
			expect(reportProgress).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('does not publish a bodyless response after cancellation during materialization', async () => {
		let resolveArrayBuffer!: (buffer: ArrayBuffer) => void;
		const arrayBuffer = vi.fn(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveArrayBuffer = resolve;
				})
		);
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				removeEventListener = vi.spyOn(init?.signal as AbortSignal, 'removeEventListener');
				return {
					ok: true,
					url: 'https://assets.example.com/clangd/clangd.js',
					headers: { get: vi.fn(() => null) },
					body: null,
					arrayBuffer
				};
			})
		);
		const controller = new AbortController();
		const reason = new Error('cancelled during bodyless read');
		const reportProgress = vi.fn();
		const loading = loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{ baseUrl: 'https://assets.example.com/clangd/' },
			reportProgress,
			{ signal: controller.signal }
		);

		await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		await vi.waitFor(() => expect(removeEventListener).toHaveBeenCalledOnce());
		resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(reportProgress).not.toHaveBeenCalled();
	});

	it('rejects oversized loader-owned blobs before materializing them', async () => {
		const blob = new Blob();
		Object.defineProperty(blob, 'size', { value: 128 * 1024 * 1024 + 1 });
		const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					loader: () => blob
				},
				vi.fn()
			)
		).rejects.toThrow('Runtime asset clangd.js exceeds the 134217728 byte limit');
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each(['bare', 'wrapped'] as const)(
		'does not publish a %s loader-owned Blob after cancellation',
		async (shape) => {
			let resolveArrayBuffer!: (buffer: ArrayBuffer) => void;
			const blob = new Blob([Uint8Array.of(1, 2, 3)], {
				type: 'application/wasm'
			});
			const arrayBuffer = vi.spyOn(blob, 'arrayBuffer').mockImplementation(
				() =>
					new Promise<ArrayBuffer>((resolve) => {
						resolveArrayBuffer = resolve;
					})
			);
			let removeEventListener!: ReturnType<typeof vi.spyOn>;
			const controller = new AbortController();
			const reason = new Error(`cancelled during ${shape} Blob read`);
			const reportProgress = vi.fn();
			const loading = loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					loader: ({ signal }) => {
						removeEventListener = vi.spyOn(signal, 'removeEventListener');
						return shape === 'bare' ? blob : { data: blob };
					}
				},
				reportProgress,
				{ signal: controller.signal }
			);

			await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
			controller.abort(reason);

			await expect(loading).rejects.toBe(reason);
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(removeEventListener).toHaveBeenCalledTimes(2);
			expect(reportProgress).not.toHaveBeenCalled();
		}
	);

	it('discards a late custom-loader result after caller cancellation', async () => {
		let resolveLoader!: (value: Uint8Array) => void;
		let removeEventListener!: ReturnType<typeof vi.spyOn>;
		const controller = new AbortController();
		const reason = new Error('cancelled while custom loader is pending');
		const reportProgress = vi.fn();
		const loading = loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{
				baseUrl: 'https://assets.example.com/clangd/',
				loader: ({ signal }) => {
					removeEventListener = vi.spyOn(signal, 'removeEventListener');
					return new Promise<Uint8Array>((resolve) => {
						resolveLoader = resolve;
					});
				}
			},
			reportProgress,
			{ signal: controller.signal }
		);

		await vi.waitFor(() => expect(removeEventListener).toBeDefined());
		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		resolveLoader(Uint8Array.of(1, 2, 3));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(removeEventListener).toHaveBeenCalledOnce();
		expect(reportProgress).not.toHaveBeenCalled();
	});

	it('aborts a loader that exceeds its configured timeout', async () => {
		vi.useFakeTimers();
		let loaderSignal: AbortSignal | undefined;
		const loading = loadLanguageToolAsset(
			'clangd',
			'clangd.js',
			{
				baseUrl: 'https://assets.example.com/clangd/',
				loader: ({ signal }) => {
					loaderSignal = signal;
					return new Promise(() => {});
				}
			},
			vi.fn(),
			{ timeoutMs: 25 }
		);
		const rejection = expect(loading).rejects.toThrow(
			'Timed out loading runtime asset clangd.js after 25 ms'
		);

		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(loaderSignal?.aborted).toBe(true);
	});

	it('honors a caller cancellation before invoking a custom loader', async () => {
		const controller = new AbortController();
		const loader = vi.fn();
		controller.abort(new Error('asset load cancelled'));

		await expect(
			loadLanguageToolAsset(
				'clangd',
				'clangd.js',
				{
					baseUrl: 'https://assets.example.com/clangd/',
					loader
				},
				vi.fn(),
				{ signal: controller.signal }
			)
		).rejects.toThrow('asset load cancelled');
		expect(loader).not.toHaveBeenCalled();
	});
});
