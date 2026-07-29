import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchBoundedExternalAsset } from '../src/external-asset.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('bounded external LSP asset loading', () => {
	it('uses least-authority request options and one growable stream buffer', async () => {
		const reportProgress = vi.fn();
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

		const bytes = await fetchBoundedExternalAsset({
			url: 'https://assets.example.com/runtime.wasm',
			label: 'test runtime',
			fetch: fetchMock,
			maxBytes: 8,
			reportProgress
		});

		expect([...bytes]).toEqual([1, 2, 3, 4]);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://assets.example.com/runtime.wasm',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(reportProgress).toHaveBeenLastCalledWith(4, 3);
	});

	it('rejects an oversized declared asset before reading and cancels its body', async () => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				({
					ok: true,
					url: 'https://assets.example.com/runtime.wasm',
					headers: new Headers({ 'content-length': '9' }),
					body: { cancel, getReader }
				}) as unknown as Response
		);

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock,
				maxBytes: 8
			})
		).rejects.toThrow('exceeds the 8 byte download limit');
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
					url: 'https://assets.example.com/runtime.wasm',
					headers: new Headers({ 'content-length': value }),
					body: { cancel, getReader }
				}) as unknown as Response
		);

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow(`test runtime has an invalid Content-Length: ${value}`);
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('allows absent and zero Content-Length declarations', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(Uint8Array.of(1, 2)))
			.mockResolvedValueOnce(new Response(null, { headers: { 'content-length': '0' } }));

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/missing-length.wasm',
				label: 'missing length runtime',
				fetch: fetchMock
			})
		).resolves.toEqual(Uint8Array.of(1, 2));
		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/zero-length.wasm',
				label: 'zero length runtime',
				fetch: fetchMock
			})
		).resolves.toEqual(new Uint8Array());
	});

	it('cancels an unknown-length stream when it crosses the byte limit', async () => {
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
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock,
				maxBytes: 4
			})
		).rejects.toThrow('exceeds the 4 byte download limit');
		expect(cancelled).toBe(true);
	});

	it('rejects a substituted final URL and cancels its body', async () => {
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
				value: 'https://other.example.com/runtime.wasm'
			});
			return response;
		});

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow('unexpected final URL');
		expect(cancelled).toBe(true);
	});

	it('rejects a malformed final URL and cancels its body', async () => {
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
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow('test runtime returned an invalid final URL: ://invalid');
		expect(getReader).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('cancels when the caller aborts while fetch is resolving', async () => {
		let cancelled = false;
		const controller = new AbortController();
		const fetchMock = vi.fn(async () => {
			controller.abort(new Error('cancelled during fetch'));
			return new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						cancelled = true;
					}
				})
			);
		});

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock,
				signal: controller.signal
			})
		).rejects.toThrow('cancelled during fetch');
		expect(cancelled).toBe(true);
	});

	it('rejects unsafe URLs and pre-aborted loads before fetching', async () => {
		const fetchMock = vi.fn();
		const controller = new AbortController();
		controller.abort(new Error('cancelled before fetch'));

		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock,
				signal: controller.signal
			})
		).rejects.toThrow('cancelled before fetch');
		await expect(
			fetchBoundedExternalAsset({
				url: 'data:application/wasm;base64,AA==',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow('Unsupported external runtime asset URL scheme');
		await expect(
			fetchBoundedExternalAsset({
				url: 'https://user:secret@assets.example.com/runtime.wasm',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow('must not include credentials');
		await expect(
			fetchBoundedExternalAsset({
				url: 'https://assets.example.com/runtime.wasm#alternate',
				label: 'test runtime',
				fetch: fetchMock
			})
		).rejects.toThrow('must not include fragments');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
