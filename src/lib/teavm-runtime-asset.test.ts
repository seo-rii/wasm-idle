import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	fetchTeaVmAsset,
	resolveTeaVmAssetUrl,
	type TeaVmLoadAsset
} from '../../runtimes/teavm/src/index';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('TeaVM runtime asset boundary', () => {
	it('confines runtime asset paths to the configured base', () => {
		expect(
			resolveTeaVmAssetUrl('compiler.wasm', {
				baseUrl: './teavm',
				currentUrl: 'https://example.test/wasm-idle/'
			})
		).toBe('https://example.test/wasm-idle/teavm/compiler.wasm');
		for (const asset of [
			'https://evil.example/compiler.wasm',
			'../compiler.wasm',
			'%2e%2e/compiler.wasm',
			'/compiler.wasm',
			'compiler.wasm#alternate',
			'compiler.wasm?download=1',
			'folder\\compiler.wasm'
		]) {
			expect(() =>
				resolveTeaVmAssetUrl(asset, { baseUrl: 'https://assets.example/teavm/' })
			).toThrow('Invalid TeaVM runtime asset path');
		}
		expect(() =>
			resolveTeaVmAssetUrl('compiler.wasm', { baseUrl: 'data:text/plain,compiler' })
		).toThrow('TeaVM assets must use HTTP(S)');
		expect(() =>
			resolveTeaVmAssetUrl('compiler.wasm', {
				baseUrl: 'https://user:secret@assets.example/teavm/'
			})
		).toThrow('must not include credentials');
	});

	it('streams assets with least-authority request options and bounded storage', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1, 2]));
							controller.enqueue(new Uint8Array([3, 4]));
							controller.close();
						}
					}),
					{ headers: { 'content-length': '3' } }
				)
		);

		const bytes = await fetchTeaVmAsset('compiler.wasm', {
			baseUrl: 'https://assets.example/teavm/',
			fetch: fetchMock,
			maxAssetBytes: 8
		});

		expect([...bytes]).toEqual([1, 2, 3, 4]);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://assets.example/teavm/compiler.wasm',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
	});

	it('rejects oversized declarations before reading and cancels the response', async () => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: 'https://assets.example/teavm/compiler.wasm',
					headers: new Headers({ 'content-length': '9' }),
					body: { cancel, getReader }
				}) as unknown as Response
		);

		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock,
				maxAssetBytes: 8
			})
		).rejects.toThrow('exceeds the 8 byte limit');
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it.each([
		['empty', ''],
		['negative', '-1'],
		['fractional', '1.5'],
		['exponential', '1e2'],
		['duplicate', '2, 2'],
		['unsafe', '9007199254740992']
	])('rejects a %s Content-Length before reading and cancels the body', async (_case, value) => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: 'https://assets.example/teavm/compiler.wasm',
					headers: new Headers({ 'content-length': value }),
					body: { cancel, getReader }
				}) as unknown as Response
		);

		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock
			})
		).rejects.toThrow('TeaVM runtime asset compiler.wasm has an invalid Content-Length');
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('redacts an invalid Content-Length before reading and cancels the body', async () => {
		const rawHeader = '2, content-length-secret';
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: 'https://assets.example/teavm/compiler.wasm',
					headers: new Headers({ 'content-length': rawHeader }),
					body: { cancel, getReader }
				}) as unknown as Response
		);
		let rejected: unknown;

		try {
			await fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock
			});
		} catch (error) {
			rejected = error;
		}

		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'TeaVM runtime asset compiler.wasm has an invalid Content-Length'
		);
		expect((rejected as Error).message).not.toContain(rawHeader);
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('allows a zero Content-Length declaration', async () => {
		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: async () => new Response(null, { headers: { 'content-length': '0' } })
			})
		).resolves.toEqual(new Uint8Array());
	});

	it('cancels an unknown-length stream that crosses the byte limit', async () => {
		let cancelled = false;
		const fetchMock = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
						},
						cancel() {
							cancelled = true;
						}
					})
				)
		);

		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock,
				maxAssetBytes: 4
			})
		).rejects.toThrow('exceeds the 4 byte limit');
		expect(cancelled).toBe(true);
	});

	it('rejects promptly and cancels a late response when custom fetch ignores abort', async () => {
		let resolveFetch!: (response: Response) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				})
		);
		const controller = new AbortController();
		const reason = new Error('stop TeaVM asset loading');
		const pending = fetchTeaVmAsset('compiler.wasm', {
			baseUrl: 'https://assets.example/teavm/',
			fetch: fetchMock,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);

		const cancel = vi.fn(async () => {});
		resolveFetch({
			ok: true,
			url: 'https://assets.example/teavm/compiler.wasm',
			headers: new Headers(),
			body: { cancel }
		} as unknown as Response);
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
	});

	it('rejects promptly when a bodyless response ignores abort during materialization', async () => {
		let resolveArrayBuffer!: (buffer: ArrayBuffer) => void;
		const arrayBuffer = vi.fn(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveArrayBuffer = resolve;
				})
		);
		const controller = new AbortController();
		const reason = new Error('stop TeaVM response materialization');
		const pending = fetchTeaVmAsset('compiler.wasm', {
			baseUrl: 'https://assets.example/teavm/',
			fetch: async () =>
				({
					ok: true,
					url: 'https://assets.example/teavm/compiler.wasm',
					headers: new Headers(),
					body: null,
					arrayBuffer
				}) as unknown as Response,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
	});

	it.each([
		['while cancellation and the read remain pending', 'pending', false],
		['when cancellation resolves without settling the read', 'resolved', false],
		['when cancellation settles the read before rejection', 'settles-read', true]
	])('rejects a stalled streamed response promptly %s', async (_case, mode, throwOnRelease) => {
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
		const cancel = vi.fn(() => {
			if (mode === 'pending') return pendingCancel;
			if (mode === 'settles-read') resolveRead({ done: true, value: undefined });
			return Promise.resolve();
		});
		const releaseFailure = new Error('TeaVM reader release failed during abort');
		const releaseLock = vi.fn(() => {
			if (throwOnRelease) throw releaseFailure;
		});
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: 'https://assets.example/teavm/compiler.wasm',
					headers: new Headers(),
					body: { getReader: () => ({ read, cancel, releaseLock }) }
				}) as unknown as Response
		);
		const controller = new AbortController();
		const reason =
			mode === 'resolved'
				? new DOMException('TeaVM asset deadline exceeded', 'TimeoutError')
				: new Error('stop stalled TeaVM stream read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = fetchTeaVmAsset('compiler.wasm', {
			baseUrl: 'https://assets.example/teavm/',
			fetch: fetchMock,
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

			expect(outcome.status).toBe('rejected');
			expect('reason' in outcome ? outcome.reason : undefined).toBe(reason);
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
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('rejects substituted final URLs and unknown runtime assets', async () => {
		let cancelled = false;
		const fetchMock = vi.fn(async () => {
			const response = new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						cancelled = true;
					}
				})
			);
			Object.defineProperty(response, 'url', {
				value: 'https://other.example/teavm/compiler.wasm'
			});
			return response;
		});

		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock
			})
		).rejects.toThrow('unexpected final URL');
		expect(cancelled).toBe(true);

		await expect(
			fetchTeaVmAsset('private.bin' as TeaVmLoadAsset, {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock
			})
		).rejects.toThrow('Unexpected TeaVM runtime asset');
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('rejects a malformed final URL before reading and cancels the body', async () => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: '://invalid',
					headers: new Headers(),
					body: { cancel, getReader }
				}) as unknown as Response
		);

		await expect(
			fetchTeaVmAsset('compiler.wasm', {
				baseUrl: 'https://assets.example/teavm/',
				fetch: fetchMock
			})
		).rejects.toThrow('TeaVM runtime asset compiler.wasm returned an invalid final URL');
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it.each([
		['://invalid-final-url-secret', 'invalid final URL', 'invalid-final-url-secret'],
		[
			'https://runtime-user:final-password-secret@assets.example/teavm/compiler.wasm#fragment-secret',
			'unexpected final URL',
			'final-password-secret'
		]
	])(
		'redacts a rejected final URL from the error: %s',
		async (finalUrl, expectedMessage, secret) => {
			const cancel = vi.fn(async () => {});
			const getReader = vi.fn();
			const fetchMock = vi.fn(
				async () =>
					({
						ok: true,
						url: finalUrl,
						headers: new Headers(),
						body: { cancel, getReader }
					}) as unknown as Response
			);
			let rejected: unknown;

			try {
				await fetchTeaVmAsset('compiler.wasm', {
					baseUrl: 'https://assets.example/teavm/',
					fetch: fetchMock
				});
			} catch (error) {
				rejected = error;
			}

			expect(rejected).toBeInstanceOf(Error);
			expect((rejected as Error).message).toContain(expectedMessage);
			expect((rejected as Error).message).not.toContain(secret);
			expect((rejected as Error).message).not.toContain(finalUrl);
			expect(getReader).not.toHaveBeenCalled();
			expect(cancel).toHaveBeenCalledOnce();
		}
	);
});
