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
		).rejects.toThrow(
			`TeaVM runtime asset compiler.wasm has an invalid Content-Length: ${value}`
		);
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
});
