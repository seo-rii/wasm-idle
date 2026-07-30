import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_MAX_RUNTIME_ASSET_BYTES,
	fetchRuntimeAssetBytes,
	fetchRuntimeAssetJson
} from '../src/runtime-asset.js';

describe('runtime asset fetch fallback', () => {
	it('uses least-authority fetch options and accepts an exact final URL', async () => {
		const assetUrl = 'https://example.test/runtime/data.bin';
		const response = new Response(new Uint8Array([1, 2, 3]));
		Object.defineProperty(response, 'url', { value: assetUrl });
		const fetchImpl = vi.fn(async () => response);

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'data.bin', fetchImpl, false)
		).resolves.toEqual(new Uint8Array([1, 2, 3]));
		expect(fetchImpl).toHaveBeenCalledWith(assetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
	});

	it.each([
		'data:application/wasm;base64,AGFzbQ==',
		'https://user:secret@example.test/runtime/data.bin',
		'https://example.test/runtime/data.bin#fragment'
	])('rejects an unsafe runtime asset URL before fetching: %s', async (assetUrl) => {
		const fetchImpl = vi.fn(async () => new Response(new Uint8Array()));

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'data.bin', fetchImpl, false)
		).rejects.toThrow(/runtime asset URL/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		['relative', 'data.bin', 'invalid final URL'],
		['malformed', 'http://[', 'invalid final URL'],
		['mismatched', 'https://mirror.test/runtime/data.bin', 'unexpected final URL']
	])('rejects and cancels a %s response URL', async (_caseName, responseUrl, message) => {
		let cancelled = false;
		let readerRequested = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', { value: responseUrl });
		Object.defineProperty(response.body, 'getReader', {
			value: () => {
				readerRequested = true;
				throw new Error('rejected response body should not be read');
			}
		});

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false
			)
		).rejects.toThrow(message);
		expect(readerRequested).toBe(false);
		expect(cancelled).toBe(true);
	});

	it.each(['', '-1', '1.5', '1e2', '3, 3', '9007199254740992'])(
		'rejects and cancels an invalid Content-Length: %s',
		async (contentLength) => {
			let cancelled = false;
			let readerRequested = false;
			const response = new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					}
				}),
				{ headers: { 'content-length': contentLength } }
			);
			Object.defineProperty(response.body, 'getReader', {
				value: () => {
					readerRequested = true;
					throw new Error('invalid-length response body should not be read');
				}
			});

			await expect(
				fetchRuntimeAssetBytes(
					'https://example.test/runtime/data.bin',
					'data.bin',
					async () => response,
					false
				)
			).rejects.toThrow(`invalid Content-Length: ${contentLength}`);
			expect(readerRequested).toBe(false);
			expect(cancelled).toBe(true);
		}
	);

	it('accepts a zero Content-Length declaration', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/empty.bin',
				'empty.bin',
				async () => new Response(null, { headers: { 'content-length': '0' } }),
				false
			)
		).resolves.toEqual(new Uint8Array());
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
		'rejects an invalid maxAssetBytes before fetching: %s',
		async (maxAssetBytes) => {
			const fetchImpl = vi.fn(async () => new Response(new Uint8Array()));

			await expect(
				fetchRuntimeAssetBytes(
					'https://example.test/runtime/data.bin',
					'data.bin',
					fetchImpl,
					false,
					undefined,
					{ maxAssetBytes }
				)
			).rejects.toThrow(/invalid maxAssetBytes/);
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	);

	it('rejects an oversized declaration before requesting a reader', async () => {
		let cancelled = false;
		let readerRequested = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'content-length': '5' } }
		);
		Object.defineProperty(response.body, 'getReader', {
			value: () => {
				readerRequested = true;
				throw new Error('oversized response body should not be read');
			}
		});

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
		expect(readerRequested).toBe(false);
		expect(cancelled).toBe(true);
	});

	it('cancels and releases an unknown-length stream that exceeds the byte limit', async () => {
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5]) })
				.mockResolvedValueOnce({ done: true, value: undefined }),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: () => reader }
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it('cancels and releases a stream after a read failure', async () => {
		const failure = new Error('stream failed');
		const reader = {
			read: vi.fn(async () => {
				throw failure;
			}),
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn()
		};
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: () => reader }
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toBe(failure);
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects an oversized bodyless response after materialization', async () => {
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: null,
			arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
	});

	it('bounds gzip expansion and accepts raw or expanded bytes exactly at the limit', async () => {
		const bombExpanded = new Uint8Array(100);
		const bombCompressed = gzipSync(bombExpanded);
		expect(bombCompressed.byteLength).toBeLessThan(32);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin.gz',
				'data.bin.gz',
				async () => new Response(bombCompressed),
				false,
				undefined,
				{ maxAssetBytes: 32 }
			)
		).rejects.toThrow(/decompressed size exceeds the 32 byte limit/);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => new Response(new Uint8Array([1, 2, 3, 4])),
				false,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));

		const exactExpanded = new Uint8Array(32);
		const exactCompressed = gzipSync(exactExpanded);
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin.gz',
				'data.bin.gz',
				async () => new Response(exactCompressed),
				false,
				undefined,
				{ maxAssetBytes: exactExpanded.byteLength }
			)
		).resolves.toEqual(exactExpanded);
	});

	it('preserves a custom byte limit through gzip fallback and JSON loading', async () => {
		const fallbackUrl = 'https://example.test/runtime/data.bin';
		const expanded = new Uint8Array([1, 2, 3, 4, 5]);
		await expect(
			fetchRuntimeAssetBytes(
				fallbackUrl,
				'data.bin',
				async (input) =>
					String(input).endsWith('.gz')
						? new Response(gzipSync(expanded))
						: new Response(null, { status: 404 }),
				true,
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/status 404/);

		await expect(
			fetchRuntimeAssetJson(
				'https://example.test/runtime/manifest.json',
				'manifest',
				async () => new Response('{"ok":true}'),
				undefined,
				{ maxAssetBytes: 4 }
			)
		).rejects.toThrow(/download size exceeds the 4 byte limit/);
	});

	it('exports a safe default runtime asset byte limit', () => {
		expect(DEFAULT_MAX_RUNTIME_ASSET_BYTES).toBe(128 * 1024 * 1024);
	});

	it('rejects a pre-aborted runtime asset load before fetching', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled before fetch');
		controller.abort(reason);
		const fetchImpl = vi.fn(async () => new Response(new Uint8Array()));

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				fetchImpl,
				false,
				undefined,
				{ signal: controller.signal }
			)
		).rejects.toBe(reason);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('passes the signal to fetch and cancels a response returned after abort', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled by fetch test');
		let cancelled = false;
		let sent = false;
		const response = new Response(
			new ReadableStream({
				pull(streamController) {
					if (sent) {
						streamController.close();
						return;
					}
					sent = true;
					streamController.enqueue(new Uint8Array([1]));
				},
				cancel() {
					cancelled = true;
				}
			})
		);
		const observedSignals: Array<AbortSignal | null | undefined> = [];

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async (_input, init) => {
					observedSignals.push(init?.signal);
					controller.abort(reason);
					return response;
				},
				false,
				undefined,
				{ signal: controller.signal }
			)
		).rejects.toBe(reason);
		expect(observedSignals).toEqual([controller.signal]);
		expect(cancelled).toBe(true);
	});

	it('cancels and releases a pending stream reader when aborted', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled during read');
		let finishRead: ((result: { done: true; value: undefined }) => void) | undefined;
		const reader = {
			read: vi.fn(
				() =>
					new Promise<{ done: true; value: undefined }>((resolve) => {
						finishRead = resolve;
						setTimeout(() => resolve({ done: true, value: undefined }), 50);
					})
			),
			cancel: vi.fn(async () => {
				finishRead?.({ done: true, value: undefined });
			}),
			releaseLock: vi.fn()
		};
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: () => reader }
		} as unknown as Response;
		const load = fetchRuntimeAssetBytes(
			'https://example.test/runtime/data.bin',
			'data.bin',
			async () => response,
			false,
			undefined,
			{ signal: controller.signal }
		);
		const rejection = expect(load).rejects.toBe(reason);
		await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
		controller.abort(reason);

		await rejection;
		expect(reader.cancel).toHaveBeenCalledOnce();
		expect(reader.releaseLock).toHaveBeenCalledOnce();
	});

	it.each([
		['while reader cancellation remains pending', false, false, false],
		['when reader cancellation resolves without settling the read', true, true, false],
		['when reader cancellation settles the read with a late chunk', true, false, true]
	])(
		'rejects an uncooperative pending stream promptly %s',
		async (_case, resolveCancellation, throwOnRelease, settleReadFromCancel) => {
			let markReadStarted!: () => void;
			const readStarted = new Promise<void>((resolve) => {
				markReadStarted = resolve;
			});
			let resolveRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
			const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
				resolveRead = resolve;
			});
			const read = vi
				.fn()
				.mockImplementationOnce(() => {
					markReadStarted();
					return pendingRead;
				})
				.mockResolvedValue({ done: true, value: undefined });
			let resolveCancel!: () => void;
			const pendingCancel = new Promise<void>((resolve) => {
				resolveCancel = resolve;
			});
			const cancel = vi.fn(() => {
				if (settleReadFromCancel) {
					resolveRead({ done: false, value: Uint8Array.of(1) });
				}
				return resolveCancellation ? Promise.resolve() : pendingCancel;
			});
			const releaseFailure = new Error('wasm-rust reader release failed during abort');
			const releaseLock = vi.fn(() => {
				if (throwOnRelease) throw releaseFailure;
			});
			const response = {
				url: '',
				ok: true,
				status: 200,
				headers: new Headers(),
				body: { getReader: () => ({ read, cancel, releaseLock }) }
			} as unknown as Response;
			const controller = new AbortController();
			const reason = resolveCancellation
				? new DOMException('wasm-rust asset deadline exceeded', 'TimeoutError')
				: new Error('cancelled during uncooperative read');
			const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const onProgress = vi.fn();
			const loading = fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				onProgress,
				{ signal: controller.signal }
			);
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
				expect(abortRegistrations).toHaveLength(1);
				expect(removeEventListener).toHaveBeenCalledWith(
					'abort',
					abortRegistrations[0]?.[1]
				);
				expect(onProgress).not.toHaveBeenCalled();

				resolveCancel();
				resolveRead({ done: false, value: Uint8Array.of(1) });
				await Promise.resolve();
				await Promise.resolve();
				expect(onProgress).not.toHaveBeenCalled();
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancel();
				resolveRead({ done: false, value: Uint8Array.of(1) });
				await loading.catch(() => {});
			}
		}
	);

	it('rejects promptly when a gzip output reader remains pending after cancellation', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled during decompression');
		let markDecompressionReadStarted!: () => void;
		const decompressionReadStarted = new Promise<void>((resolve) => {
			markDecompressionReadStarted = resolve;
		});
		let resolveRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
		const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
			resolveRead = resolve;
		});
		const read = vi.fn(() => {
			markDecompressionReadStarted();
			return pendingRead;
		});
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const onProgress = vi.fn();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		class TestDecompressionStream {
			readonly readable = new ReadableStream<Uint8Array>();
			readonly writable = new WritableStream<BufferSource>();

			constructor() {
				Object.defineProperty(this.readable, 'getReader', {
					value: () => ({ read, cancel, releaseLock })
				});
			}
		}

		vi.stubGlobal('DecompressionStream', TestDecompressionStream);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let load: Promise<Uint8Array> | undefined;
		try {
			load = fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin.gz',
				'data.bin.gz',
				async () => new Response(new Uint8Array([0x1f, 0x8b])),
				false,
				onProgress,
				{ signal: controller.signal }
			);
			await decompressionReadStarted;
			const progressCallCount = onProgress.mock.calls.length;
			controller.abort(reason);
			const outcome = await Promise.race([
				load.then(
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
			expect(removeEventListener).toHaveBeenCalledWith(
				'abort',
				abortRegistrations.at(-1)?.[1]
			);

			resolveRead({ done: false, value: Uint8Array.of(1) });
			await Promise.resolve();
			await Promise.resolve();
			expect(onProgress).toHaveBeenCalledTimes(progressCallCount);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveRead({ done: true, value: undefined });
			await load?.catch(() => {});
			vi.unstubAllGlobals();
		}
	});

	it('preserves abort reasons through gzip fallback', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled during fallback');
		const assetUrl = 'https://example.test/runtime/data.bin';
		const observedSignals: Array<AbortSignal | null | undefined> = [];

		await expect(
			fetchRuntimeAssetBytes(
				assetUrl,
				'data.bin',
				async (input, init) => {
					observedSignals.push(init?.signal);
					if (!String(input).endsWith('.gz')) return new Response(null, { status: 404 });
					controller.abort(reason);
					return new Response(gzipSync(new Uint8Array([1, 2, 3, 4])));
				},
				true,
				undefined,
				{ signal: controller.signal }
			)
		).rejects.toBe(reason);
		expect(observedSignals).toEqual([controller.signal, controller.signal]);
	});

	it('propagates cancellation through bodyless and JSON asset paths', async () => {
		const bodylessController = new AbortController();
		const bodylessReason = new Error('cancelled during bodyless read');
		const bodylessResponse = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: null,
			arrayBuffer: async () => {
				bodylessController.abort(bodylessReason);
				return new Uint8Array([1]).buffer;
			}
		} as unknown as Response;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => bodylessResponse,
				false,
				undefined,
				{ signal: bodylessController.signal }
			)
		).rejects.toBe(bodylessReason);

		const jsonController = new AbortController();
		const jsonReason = new Error('cancelled before JSON fetch');
		jsonController.abort(jsonReason);
		const jsonFetch = vi.fn(async () => new Response('{"ok":true}'));
		await expect(
			fetchRuntimeAssetJson(
				'https://example.test/runtime/manifest.json',
				'manifest',
				jsonFetch,
				undefined,
				{ signal: jsonController.signal }
			)
		).rejects.toBe(jsonReason);
		expect(jsonFetch).not.toHaveBeenCalled();
	});

	it('rejects promptly when a bodyless asset read is aborted', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const reason = new Error('cancelled during stalled bodyless read');
		const onProgress = vi.fn();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		let markMaterializationStarted!: () => void;
		const materializationStarted = new Promise<void>((resolve) => {
			markMaterializationStarted = resolve;
		});
		let resolveArrayBuffer!: (value: ArrayBuffer) => void;
		const arrayBufferPromise = new Promise<ArrayBuffer>((resolve) => {
			resolveArrayBuffer = resolve;
		});
		const arrayBuffer = vi.fn(() => {
			markMaterializationStarted();
			return arrayBufferPromise;
		});
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/data.bin',
			'data.bin',
			async () =>
				({
					url: '',
					ok: true,
					status: 200,
					headers: new Headers(),
					body: null,
					arrayBuffer
				}) as unknown as Response,
			false,
			onProgress,
			{ signal: controller.signal }
		);

		await materializationStarted;
		controller.abort(reason);
		try {
			const outcome = Promise.race([
				pending.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setTimeout(() => resolve({ status: 'pending' }), 1);
				})
			]);
			await vi.advanceTimersByTimeAsync(1);

			expect(await outcome).toEqual({ status: 'rejected', reason });
			expect(onProgress).not.toHaveBeenCalled();
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		} finally {
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await pending.catch(() => {});
			vi.useRealTimers();
		}
	});

	it('cancels a failed response before trying the gzip fallback', async () => {
		const assetUrl = 'https://example.test/runtime/llvm/lld.wasm';
		let cancelled = false;
		let sent = false;
		const failedResponse = new Response(
			new ReadableStream({
				pull(controller) {
					if (sent) {
						controller.close();
						return;
					}
					sent = true;
					controller.enqueue(new TextEncoder().encode('missing'));
				},
				cancel() {
					cancelled = true;
				}
			}),
			{ status: 404 }
		);
		Object.defineProperty(failedResponse, 'url', { value: assetUrl });
		const gzipResponse = new Response(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
		Object.defineProperty(gzipResponse, 'url', { value: `${assetUrl}.gz` });

		await expect(
			fetchRuntimeAssetBytes(assetUrl, 'lld.wasm', async (input) => {
				return String(input).endsWith('.gz') ? gzipResponse : failedResponse;
			})
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
		expect(cancelled).toBe(true);
	});

	it('retries the gzip variant when a raw wasm asset resolves to html', async () => {
		const requestedUrls: string[] = [];

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/llvm/lld.wasm',
				'wasm-rust llvm asset llvm/lld.wasm',
				async (assetUrl) => {
					requestedUrls.push(String(assetUrl));
					if (String(assetUrl).endsWith('/llvm/lld.wasm')) {
						return new Response('<!doctype html><html><body>fallback</body></html>', {
							status: 200,
							headers: {
								'content-type': 'text/html; charset=utf-8'
							}
						});
					}
					if (String(assetUrl).endsWith('/llvm/lld.wasm.gz')) {
						return new Response(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
					}
					throw new Error(`unexpected asset ${String(assetUrl)}`);
				}
			)
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));

		expect(requestedUrls).toEqual([
			'https://example.test/runtime/llvm/lld.wasm',
			'https://example.test/runtime/llvm/lld.wasm.gz'
		]);
	});

	it('fails with a stale-bundle hint when both raw and gzip runtime assets resolve to html', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/llvm/lld.wasm',
				'wasm-rust llvm asset llvm/lld.wasm',
				async () =>
					new Response('<!doctype html><html><body>fallback</body></html>', {
						status: 200,
						headers: {
							'content-type': 'text/html; charset=utf-8'
						}
					})
			)
		).rejects.toThrow(
			/stale or wrong wasm-rust bundle|rewrote a missing nested asset request/i
		);
	});

	it('accepts already-decoded gzip assets without trying to decompress them again', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/rustc/rustc.wasm.gz',
				'rustc.wasm',
				async () =>
					new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), {
						status: 200,
						headers: {
							'content-encoding': 'gzip',
							'content-type': 'application/wasm'
						}
					})
			)
		).resolves.toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
	});

	it('streams byte progress while reading an asset response body', async () => {
		const progressEvents: Array<{ loaded: number; total?: number }> = [];
		const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(bytes.slice(0, 2));
					controller.enqueue(bytes.slice(2, 5));
					controller.enqueue(bytes.slice(5));
					controller.close();
				}
			}),
			{
				status: 200,
				headers: {
					'content-length': String(bytes.byteLength)
				}
			}
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/data.bin',
				'data.bin',
				async () => response,
				false,
				(progress) => progressEvents.push(progress)
			)
		).resolves.toEqual(bytes);

		expect(progressEvents.map((event) => event.loaded)).toEqual([2, 5, 6]);
		expect(progressEvents.at(-1)?.total).toBe(bytes.byteLength);
	});
});
