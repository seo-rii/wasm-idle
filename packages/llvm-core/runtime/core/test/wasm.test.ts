import { zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compile, decompressGzip, fetchRuntimeJson, getInstance, readBuffer } from '../src/wasm.js';

const emptyWasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);

async function zipBytes(filename: string, contents: Uint8Array, level: 0 | 6 = 6) {
	return zipSync({ [filename]: contents }, { level });
}

describe('WebAssembly loading utilities', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rejects package-relative and file runtime assets', async () => {
		await expect(readBuffer('runtime.zip')).rejects.toThrow(
			/Runtime asset URL must be absolute/u
		);
		await expect(readBuffer('file:///tmp/runtime.zip')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
		await expect(readBuffer('data:application/zip;base64,AA==')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
		await expect(readBuffer('https://cdn.test/runtime.wasm#latest')).rejects.toThrow(
			/Runtime asset URLs must not include fragments/u
		);
		await expect(compile('toString')).rejects.toThrow(/Runtime asset URL must be absolute/u);
		await expect(compile('constructor')).rejects.toThrow(/Runtime asset URL must be absolute/u);
	});

	it('rejects credential-bearing runtime asset URLs before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const expectedError = 'Runtime asset URLs must not include credentials';

		await expect(readBuffer('https://user@cdn.test/runtime.bin')).rejects.toThrow(
			expectedError
		);
		await expect(readBuffer('https://user:secret@cdn.test/runtime.wasm.gz')).rejects.toThrow(
			expectedError
		);
		await expect(readBuffer('https://:secret@cdn.test/runtime.zip')).rejects.toThrow(
			expectedError
		);
		await expect(compile('https://user:secret@cdn.test/runtime.wasm')).rejects.toThrow(
			expectedError
		);
		await expect(
			fetchRuntimeJson('https://user:secret@cdn.test/manifest.json')
		).rejects.toThrow(expectedError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('preserves pre-abort reasons without fetching or caching assets', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop before asset fetch');
		controller.abort(reason);

		await expect(
			readBuffer(
				'https://cdn.test/llvm/pre-aborted-runtime.zip',
				undefined,
				undefined,
				controller.signal
			)
		).rejects.toBe(reason);
		await expect(
			compile('https://cdn.test/llvm/pre-aborted-runtime.wasm', undefined, controller.signal)
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('normalizes a fetch abort back to the caller-provided reason', async () => {
		const url = 'https://cdn.test/llvm/cancelled-fetch.bin';
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('fetch aborted', 'AbortError')),
						{ once: true }
					);
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop pending fetch');
		const pending = readBuffer(url, undefined, undefined, controller.signal);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

	it.each(['asset', 'json'] as const)(
		'cancels an uncooperative %s fetch and disposes its late response',
		async (kind) => {
			let resolveFetch!: (response: Response) => void;
			const fetchMock = vi.fn(
				(_input: RequestInfo | URL, _init?: RequestInit) =>
					new Promise<Response>((resolve) => {
						resolveFetch = resolve;
					})
			);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const reason = new Error(`stop uncooperative ${kind} fetch`);
			const url = `https://cdn.test/llvm/uncooperative-${kind}.bin`;
			let pending: Promise<unknown>;
			if (kind === 'asset') {
				vi.stubGlobal('fetch', fetchMock);
				pending = readBuffer(url, undefined, undefined, controller.signal);
			} else {
				pending = fetchRuntimeJson(url, {
					fetchImpl: fetchMock,
					signal: controller.signal
				});
			}

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			controller.abort(reason);

			await expect(pending).rejects.toBe(reason);

			const cancel = vi.fn(async () => {});
			resolveFetch({
				ok: true,
				status: 200,
				headers: new Headers(),
				body: { cancel }
			} as unknown as Response);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
			expect(removeEventListener).toHaveBeenCalledOnce();
		}
	);

	it.each([
		['asset with pending cancellation', 'asset', 'pending'],
		['JSON with detached cancellation', 'json', 'resolved'],
		['asset with a cancellation-settled chunk', 'asset', 'chunk']
	] as const)(
		'cancels an uncooperative active %s reader without poisoning a later retry',
		async (_case, kind, cancellationMode) => {
			const url = `https://cdn.test/llvm/cancelled-${cancellationMode}-runtime.${kind === 'asset' ? 'bin' : 'json'}`;
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
			let resolveCancellation!: () => void;
			const pendingCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn(() => {
				if (cancellationMode === 'chunk') {
					resolveRead({ done: false, value: Uint8Array.of(1) });
					return Promise.resolve();
				}
				return cancellationMode === 'pending' ? pendingCancellation : Promise.resolve();
			});
			const releaseLock = vi.fn(() => {
				if (kind === 'json')
					throw new Error('llvm-core reader release failed during abort');
			});
			const firstResponse = {
				url: '',
				ok: true,
				status: 200,
				headers: new Headers({ 'content-length': '1' }),
				body: { getReader: () => ({ read, cancel, releaseLock }) }
			} as unknown as Response;
			const retryBytes =
				kind === 'asset' ? Uint8Array.of(7, 8, 9) : new TextEncoder().encode('{"ok":true}');
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(firstResponse)
				.mockResolvedValueOnce(new Response(retryBytes));
			if (kind === 'asset') vi.stubGlobal('fetch', fetchMock);
			const controller = new AbortController();
			const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const reason =
				kind === 'asset'
					? new Error('stop uncooperative raw asset read')
					: new DOMException('runtime JSON deadline exceeded', 'TimeoutError');
			const progress = { set: vi.fn() };
			const loading =
				kind === 'asset'
					? readBuffer(url, progress, undefined, controller.signal)
					: fetchRuntimeJson(url, {
							fetchImpl: fetchMock,
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
				for (const registration of abortRegistrations) {
					expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
				}
				expect(progress.set).not.toHaveBeenCalled();

				resolveRead({ done: false, value: Uint8Array.of(1) });
				await Promise.resolve();
				await Promise.resolve();
				expect(progress.set).not.toHaveBeenCalled();

				if (kind === 'asset') {
					expect(fetchMock).toHaveBeenNthCalledWith(
						1,
						new URL(url),
						expect.objectContaining({ signal: controller.signal })
					);
					await expect(readBuffer(url)).resolves.toEqual(retryBytes);
				} else {
					await expect(fetchRuntimeJson(url, { fetchImpl: fetchMock })).resolves.toEqual({
						ok: true
					});
				}
				expect(fetchMock).toHaveBeenCalledTimes(2);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				resolveRead({ done: true, value: undefined });
				await loading.catch(() => {});
			}
		}
	);

	it('cleans an active raw reader when initial stream allocation fails', async () => {
		const url = 'https://cdn.test/llvm/oversized-allocation-runtime.bin';
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const read = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				return {
					url: '',
					ok: true,
					status: 200,
					headers: new Headers({
						'content-length': String(Number.MAX_SAFE_INTEGER)
					}),
					body: { getReader: () => ({ read, cancel, releaseLock }) }
				} as unknown as Response;
			})
		);
		const progress = { set: vi.fn() };
		let failure: unknown;

		await readBuffer(url, progress, Number.MAX_SAFE_INTEGER, controller.signal).then(
			() => {
				throw new Error('expected initial stream allocation to fail');
			},
			(error: unknown) => {
				failure = error;
				expect(error).toBeInstanceOf(RangeError);
			}
		);

		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledWith(failure);
		expect(releaseLock).toHaveBeenCalledOnce();
		const abortRegistrations = addEventListener.mock.calls.filter(([type]) => type === 'abort');
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('cancels active gzip readers and preserves the caller reason', async () => {
		const url = 'https://cdn.test/llvm/cancelled-runtime.wasm.gz';
		const compressed = gzipSync(Uint8Array.of(1, 2, 3, 4), { level: 9, mtime: 0 });
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(streamController) {
				streamController.enqueue(compressed.subarray(0, compressed.byteLength - 2));
			},
			cancel() {
				cancelled = true;
			}
		});
		const getReaderSpy = vi.spyOn(body, 'getReader');
		const fetchMock = vi.fn(async () => new Response(body));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop gzip asset load');
		const pending = readBuffer(url, undefined, undefined, controller.signal);

		await vi.waitFor(() => expect(getReaderSpy).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it.each([
		['raw', 'https://cdn.test/llvm/bodyless-runtime.bin'],
		['gzip', 'https://cdn.test/llvm/bodyless-runtime.wasm.gz']
	] as const)('cancels a pending %s bodyless response read', async (kind, url) => {
		let resolveArrayBuffer!: (buffer: ArrayBuffer) => void;
		const arrayBuffer = vi.fn(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveArrayBuffer = resolve;
				})
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers(),
				body: null,
				arrayBuffer
			}))
		);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error(`stop ${kind} bodyless response read`);
		const progress = { set: vi.fn() };
		const pending = readBuffer(url, progress, undefined, controller.signal);

		await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(removeEventListener).toHaveBeenCalledTimes(2);
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('observes cancellation before extracting a downloaded ZIP', async () => {
		const url = 'https://cdn.test/llvm/cancelled-runtime.zip';
		const archive = await zipBytes('fixture.bin', Uint8Array.of(1, 2, 3));
		const controller = new AbortController();
		const reason = new Error('stop before ZIP extraction');
		const fetchMock = vi.fn(
			async () =>
				new Response(archive, {
					headers: { 'Content-Length': String(archive.byteLength) }
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			readBuffer(
				url,
				{
					set(value) {
						if (value > 0) controller.abort(reason);
					}
				},
				undefined,
				controller.signal
			)
		).rejects.toBe(reason);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({ signal: controller.signal })
		);
	});

	it('keeps aborted compilation outside the shared module cache', async () => {
		const url = 'https://cdn.test/llvm/cancelled-compilation.wasm';
		const module = new WebAssembly.Module(emptyWasm);
		// Warm Undici before its lazy llhttp compilation can consume the compile spy below.
		void new Headers({
			'Content-Length': String(emptyWasm.byteLength)
		});
		let compilationStarted!: () => void;
		let finishCompilation!: () => void;
		let compilationFinished = false;
		let addEventListener!: ReturnType<typeof vi.spyOn>;
		let abortRegistrationsBeforeCompile = 0;
		const started = new Promise<void>((resolve) => {
			compilationStarted = resolve;
		});
		const finish = new Promise<void>((resolve) => {
			finishCompilation = resolve;
		});
		const compileSpy = vi
			.spyOn(WebAssembly, 'compile')
			.mockImplementationOnce(async () => {
				abortRegistrationsBeforeCompile = addEventListener.mock.calls.length;
				compilationStarted();
				await finish;
				compilationFinished = true;
				return module;
			})
			.mockResolvedValueOnce(module);
		const fetchMock = vi.fn(async () => new Response(emptyWasm));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		const reason = new Error('stop WebAssembly compilation');
		addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		let pending: Promise<WebAssembly.Module> | undefined;

		try {
			pending = compile(url, undefined, controller.signal);
			await started;
			expect(addEventListener.mock.calls.length).toBeGreaterThan(
				abortRegistrationsBeforeCompile
			);
			const compileAbortRegistration = addEventListener.mock.calls.at(-1);
			expect(compileAbortRegistration?.[0]).toBe('abort');
			controller.abort(reason);
			const outcome = await Promise.race([
				pending.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(compilationFinished).toBe(false);
			expect(removeEventListener).toHaveBeenCalledWith(
				'abort',
				compileAbortRegistration?.[1]
			);
			finishCompilation();
			await new Promise((resolve) => setTimeout(resolve, 0));
			await expect(compile(url)).resolves.toBe(module);
			expect(compileSpy).toHaveBeenCalledTimes(2);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			finishCompilation();
			await pending?.catch(() => {});
			compileSpy.mockRestore();
		}
	});

	it('loads bounded runtime JSON with least-authority request options', async () => {
		const url = 'https://cdn.test/llvm/runtime-manifest.v1.json';
		const body = new TextEncoder().encode(JSON.stringify({ manifestVersion: 1 }));
		const response = new Response(body, {
			headers: { 'Content-Length': String(body.byteLength) }
		});
		Object.defineProperty(response, 'url', { value: url });
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();

		await expect(
			fetchRuntimeJson(url, {
				fetchImpl,
				label: 'fixture runtime manifest',
				maxBytes: body.byteLength,
				signal: controller.signal
			})
		).resolves.toEqual({ manifestVersion: 1 });
		expect(fetchImpl).toHaveBeenCalledWith(url, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		});
	});

	it('cancels runtime JSON bodies that exceed declared or streamed limits', async () => {
		const declaredUrl = 'https://cdn.test/llvm/declared-manifest.json';
		let declaredCancelled = false;
		const declaredResponse = new Response(
			new ReadableStream({
				pull() {
					throw new Error('body should not be read');
				},
				cancel() {
					declaredCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '6' } }
		);
		await expect(
			fetchRuntimeJson(declaredUrl, {
				fetchImpl: async () => declaredResponse,
				maxBytes: 5
			})
		).rejects.toThrow(`Runtime asset ${declaredUrl} size exceeds the 5 byte limit`);
		expect(declaredCancelled).toBe(true);

		const streamedUrl = 'https://cdn.test/llvm/streamed-manifest.json';
		let streamedCancelled = false;
		const streamedResponse = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(Uint8Array.of(1, 2, 3));
					controller.enqueue(Uint8Array.of(4, 5, 6));
				},
				cancel() {
					streamedCancelled = true;
				}
			})
		);
		await expect(
			fetchRuntimeJson(streamedUrl, {
				fetchImpl: async () => streamedResponse,
				maxBytes: 5
			})
		).rejects.toThrow(`Runtime asset ${streamedUrl} size exceeds the 5 byte limit`);
		expect(streamedCancelled).toBe(true);
	});

	it('cancels an active runtime JSON reader with the caller signal', async () => {
		const url = 'https://cdn.test/llvm/cancelled-manifest.json';
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();
		const reason = new Error('stop manifest load');
		const pending = fetchRuntimeJson(url, {
			fetchImpl,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
	});

	it('rejects substituted, invalid UTF-8, and malformed runtime JSON', async () => {
		const url = 'https://cdn.test/llvm/runtime-manifest.json';
		let substitutedCancelled = false;
		const finalUrlSecret = 'signed-final-url-secret';
		const substituted = new Response(
			new ReadableStream({
				cancel() {
					substitutedCancelled = true;
				}
			})
		);
		Object.defineProperty(substituted, 'url', {
			value: `https://runtime-user:password@mirror.test/llvm/runtime-manifest.json?signature=${finalUrlSecret}#access-token`
		});
		let substitutedError: unknown;
		try {
			await fetchRuntimeJson(url, { fetchImpl: async () => substituted });
		} catch (error) {
			substitutedError = error;
		}
		expect(substitutedError).toBeInstanceOf(Error);
		expect((substitutedError as Error).message).toBe(
			'runtime JSON returned an unexpected final URL'
		);
		expect((substitutedError as Error).message).not.toContain(finalUrlSecret);
		expect((substitutedError as Error).message).not.toContain('access-token');
		expect(substitutedCancelled).toBe(true);

		let invalidCancelled = false;
		const invalidFinalUrl = '://invalid-final-url-secret';
		let invalidError: unknown;
		try {
			await fetchRuntimeJson(url, {
				fetchImpl: async () =>
					({
						url: invalidFinalUrl,
						ok: true,
						status: 200,
						headers: new Headers(),
						body: {
							async cancel() {
								invalidCancelled = true;
							}
						}
					}) as unknown as Response
			});
		} catch (error) {
			invalidError = error;
		}
		expect(invalidError).toBeInstanceOf(Error);
		expect((invalidError as Error).message).toBe('runtime JSON returned an invalid final URL');
		expect((invalidError as Error).message).not.toContain(invalidFinalUrl);
		expect(invalidCancelled).toBe(true);

		await expect(
			fetchRuntimeJson(url, {
				fetchImpl: async () => new Response(Uint8Array.of(0xc3, 0x28)),
				label: 'fixture manifest'
			})
		).rejects.toThrow('fixture manifest is not valid UTF-8');
		await expect(
			fetchRuntimeJson(url, {
				fetchImpl: async () => new Response('{'),
				label: 'fixture manifest'
			})
		).rejects.toThrow('fixture manifest is not valid JSON');
	});

	it('extracts the first file from a zip response and reports completion', async () => {
		const progress = { set: vi.fn() };
		const archive = await zipBytes('fixture.bin', Uint8Array.of(1, 2, 3, 4));
		const url = 'https://cdn.test/llvm/fixture.bin.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);

		await expect(readBuffer(url, progress)).resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
		expect(progress.set).toHaveBeenLastCalledWith(1);
	});

	it('reads chunked stored ZIP responses and skips directory entries', async () => {
		const archive = zipSync(
			{
				'fixture/': new Uint8Array(),
				'fixture/data.bin': Uint8Array.of(5, 6, 7, 8)
			},
			{ level: 0 }
		);
		const url = 'https://cdn.test/llvm/chunked-stored.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								for (let offset = 0; offset < archive.byteLength; offset += 7) {
									controller.enqueue(archive.slice(offset, offset + 7));
								}
								controller.close();
							}
						}),
						{ headers: { 'Content-Length': String(archive.byteLength) } }
					)
			)
		);

		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(5, 6, 7, 8));
	});

	it('uses native gzip decompression for wasm.gz and tar.gz assets', async () => {
		const progress = { set: vi.fn() };
		const contents = Uint8Array.of(21, 22, 23, 24);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/fixture.wasm.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(compressed, {
						headers: { 'Content-Length': String(compressed.byteLength) }
					})
			)
		);

		await expect(readBuffer(url, progress)).resolves.toEqual(contents);
		expect(progress.set).toHaveBeenLastCalledWith(1);
	});

	it('bounds decompressed gzip output before materializing the full asset', async () => {
		const contents = Uint8Array.of(1, 2, 3, 4, 5);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });

		await expect(decompressGzip(compressed, 'fixture.wasm.gz', 4)).rejects.toThrow(
			'Runtime asset fixture.wasm.gz decompressed size exceeds the 4 byte limit'
		);
		await expect(decompressGzip(contents, 'decoded.wasm', 4)).rejects.toThrow(
			'Runtime asset decoded.wasm decompressed size exceeds the 4 byte limit'
		);
	});

	it('rejects decompression limits without awaiting reader cleanup', async () => {
		const contents = Uint8Array.of(1, 2, 3, 4, 5);
		const compressed = Uint8Array.from(gzipSync(contents, { level: 9, mtime: 0 }));
		let resolveCancellation!: () => void;
		const stalledCancellation = new Promise<void>((resolve) => {
			resolveCancellation = resolve;
		});
		const reader = {
			read: vi.fn(async () => ({ done: false as const, value: contents })),
			cancel: vi.fn((_reason?: unknown) => stalledCancellation),
			releaseLock: vi.fn(() => {
				throw new Error('oversized reader lock cannot be released');
			})
		};
		const decompressed = new ReadableStream<Uint8Array>();
		vi.spyOn(decompressed, 'getReader').mockReturnValue(reader as never);
		const writable = new WritableStream<Uint8Array>();
		vi.stubGlobal(
			'DecompressionStream',
			class {
				readonly readable = decompressed;
				readonly writable = writable;
			}
		);
		const pending = decompressGzip(compressed, 'oversized.wasm.gz', 4);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			const outcome = await Promise.race([
				pending.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome.status).toBe('rejected');
			if (outcome.status !== 'rejected') throw new Error('expected decompression to reject');
			expect(outcome.reason).toBeInstanceOf(Error);
			expect((outcome.reason as Error).message).toContain(
				'Runtime asset oversized.wasm.gz decompressed size exceeds the 4 byte limit'
			);
			expect(reader.cancel).toHaveBeenCalledOnce();
			const cancellationReason = reader.cancel.mock.calls[0]?.[0];
			expect(cancellationReason).toBeInstanceOf(Error);
			expect((cancellationReason as Error).message).toBe(
				'Runtime asset oversized.wasm.gz decompressed size exceeds the 4 byte limit'
			);
			expect(reader.releaseLock).toHaveBeenCalledOnce();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancellation();
			await pending.catch(() => {});
		}
	});

	it('aborts stalled bodyless gzip decompression without awaiting cancellation', async () => {
		const contents = Uint8Array.of(1, 2, 3, 4);
		const compressed = Uint8Array.from(gzipSync(contents, { level: 9, mtime: 0 }));
		const url = 'https://cdn.test/llvm/bodyless-decompression.wasm.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers(),
				body: null,
				arrayBuffer: async () => compressed.buffer
			}))
		);
		let resolveRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
		const stalledRead = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
			resolveRead = resolve;
		});
		let resolveCancellation!: () => void;
		const stalledCancellation = new Promise<void>((resolve) => {
			resolveCancellation = resolve;
		});
		const reader = {
			read: vi.fn(() => stalledRead),
			cancel: vi.fn((_reason?: unknown) => stalledCancellation),
			releaseLock: vi.fn(() => {
				throw new Error('stalled reader lock cannot be released');
			})
		};
		const decompressed = new ReadableStream<Uint8Array>();
		const getReader = vi.spyOn(decompressed, 'getReader').mockReturnValue(reader as never);
		const writable = new WritableStream<Uint8Array>();
		vi.stubGlobal(
			'DecompressionStream',
			class {
				readonly readable = decompressed;
				readonly writable = writable;
			}
		);
		const controller = new AbortController();
		const reason = new Error('stop bodyless gzip decompression');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = { set: vi.fn() };
		const pending = readBuffer(url, progress, undefined, controller.signal);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await vi.waitFor(() => expect(getReader).toHaveBeenCalledOnce());
			controller.abort(reason);
			const outcome = await Promise.race([
				pending.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(reader.cancel).toHaveBeenCalledOnce();
			expect(reader.cancel).toHaveBeenCalledWith(reason);
			expect(reader.releaseLock).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(progress.set).not.toHaveBeenCalledWith(1);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveRead({ done: true, value: undefined });
			resolveCancellation();
			await pending.catch(() => {});
		}
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'aborts a stalled streamed gzip sniff without awaiting %s cleanup',
		async (cancellationMode) => {
			const url = `https://cdn.test/llvm/streamed-sniff-${cancellationMode}.wasm.gz`;
			let resolveRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
			const stalledRead = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
				resolveRead = resolve;
			});
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const reader = {
				read: vi.fn(() => stalledRead),
				cancel: vi.fn((reason?: unknown) => {
					if (cancellationMode === 'throw') {
						throw new Error('streamed gzip cancellation threw');
					}
					if (cancellationMode === 'reject') {
						return Promise.reject(new Error('streamed gzip cancellation rejected'));
					}
					return stalledCancellation;
				}),
				releaseLock: vi.fn(() => {
					throw new Error('streamed gzip reader lock cannot be released');
				})
			};
			const response = {
				url,
				ok: true,
				status: 200,
				headers: new Headers(),
				body: { getReader: vi.fn(() => reader) }
			} as unknown as Response;
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => response)
			);
			const controller = new AbortController();
			const reason = new Error(`stop streamed gzip sniff ${cancellationMode}`);
			const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = { set: vi.fn() };
			const pending = readBuffer(url, progress, undefined, controller.signal);
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
				controller.abort(reason);
				const outcome = await Promise.race([
					pending.then(
						(value) => ({ status: 'resolved' as const, value }),
						(error) => ({ status: 'rejected' as const, reason: error as unknown })
					),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome).toEqual({ status: 'rejected', reason });
				expect(reader.cancel).toHaveBeenCalledOnce();
				expect(reader.cancel).toHaveBeenCalledWith(reason);
				expect(reader.releaseLock).toHaveBeenCalledOnce();
				const abortRegistrations = addEventListener.mock.calls.filter(
					([type]) => type === 'abort'
				);
				for (const registration of abortRegistrations) {
					expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
				}
				expect(progress.set).not.toHaveBeenCalledWith(1);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveRead({ done: true, value: undefined });
				resolveCancellation();
				await pending.catch(() => {});
			}
		}
	);

	it('preserves streamed gzip read failures without awaiting cancellation', async () => {
		const url = 'https://cdn.test/llvm/streamed-read-failure.wasm.gz';
		const sourceFailure = new Error('streamed gzip response failed');
		let resolveCancellation!: () => void;
		const stalledCancellation = new Promise<void>((resolve) => {
			resolveCancellation = resolve;
		});
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false as const, value: Uint8Array.of(1, 2) })
				.mockRejectedValueOnce(sourceFailure),
			cancel: vi.fn((_reason?: unknown) => stalledCancellation),
			releaseLock: vi.fn(() => {
				throw new Error('failed streamed reader lock cannot be released');
			})
		};
		const response = {
			url,
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { getReader: vi.fn(() => reader) }
		} as unknown as Response;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response)
		);
		const progress = { set: vi.fn() };
		const pending = readBuffer(url, progress);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			const outcome = await Promise.race([
				pending.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome.status).toBe('rejected');
			if (outcome.status !== 'rejected') throw new Error('expected streamed read to reject');
			expect(outcome.reason).toBeInstanceOf(Error);
			expect((outcome.reason as Error).message).toContain(sourceFailure.message);
			expect(reader.cancel).toHaveBeenCalledOnce();
			expect(reader.cancel).toHaveBeenCalledWith(sourceFailure);
			expect(reader.releaseLock).toHaveBeenCalledOnce();
			expect(progress.set).not.toHaveBeenCalledWith(1);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancellation();
			await pending.catch(() => {});
		}
	});

	it('rejects an oversized gzip transfer before starting decompression', async () => {
		const contents = gzipSync(Uint8Array.of(1, 2, 3), { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/gzip-download-limit.wasm.gz';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(contents);
							},
							cancel() {
								cancelled = true;
							}
						}),
						{ headers: { 'Content-Length': String(contents.byteLength) } }
					)
			)
		);

		await expect(readBuffer(url, undefined, contents.byteLength - 1)).rejects.toThrow(
			`Runtime asset ${url} download size exceeds the ${contents.byteLength - 1} byte limit`
		);
		expect(cancelled).toBe(true);
	});

	it('connects gzip network chunks to the native decompression stream before download completion', async () => {
		const contents = Uint8Array.from({ length: 16_384 }, (_, index) => index % 251);
		const compressed = gzipSync(contents, { level: 9, mtime: 0 });
		const nativeDecompressionStream = globalThis.DecompressionStream;
		let offset = 0;
		let pulls = 0;
		let pullsAtDecompression = -1;
		vi.stubGlobal(
			'DecompressionStream',
			function TrackingDecompressionStream(format: CompressionFormat) {
				pullsAtDecompression = pulls;
				return new nativeDecompressionStream(format);
			}
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							pull(controller) {
								if (offset >= compressed.byteLength) {
									controller.close();
									return;
								}
								controller.enqueue(compressed.subarray(offset, ++offset));
								pulls += 1;
							}
						}),
						{ headers: { 'Content-Length': String(compressed.byteLength) } }
					)
			)
		);

		await expect(readBuffer('https://cdn.test/llvm/streamed-runtime.tar.gz')).resolves.toEqual(
			contents
		);
		expect(pullsAtDecompression).toBeGreaterThanOrEqual(2);
		expect(pullsAtDecompression).toBeLessThan(compressed.byteLength);
	});

	it('accepts gzip URLs already decoded by HTTP content encoding', async () => {
		const contents = Uint8Array.of(31, 32, 33);
		const url = 'https://cdn.test/llvm/already-decoded.tar.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(contents))
		);

		await expect(readBuffer(url)).resolves.toEqual(contents);
	});

	it('reports when native gzip decompression is unavailable', async () => {
		const compressed = gzipSync(Uint8Array.of(41, 42), { level: 9, mtime: 0 });
		const url = 'https://cdn.test/llvm/no-decompression-stream.wasm.gz';
		vi.stubGlobal('DecompressionStream', undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(compressed))
		);

		await expect(readBuffer(url)).rejects.toThrow(
			/DecompressionStream\('gzip'\) is unavailable/u
		);
	});

	it('extracts ZIP data when the response does not expose a body stream', async () => {
		const archive = await zipBytes('fixture.bin', Uint8Array.of(9, 10, 11));
		const url = 'https://cdn.test/llvm/no-body.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers({ 'Content-Length': String(archive.byteLength) }),
				body: null,
				arrayBuffer: async () => archive.slice().buffer
			}))
		);

		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(9, 10, 11));
	});

	it('rejects an oversized Content-Length before reading the response body', async () => {
		const url = 'https://cdn.test/llvm/content-length-limit.bin';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							pull() {
								throw new Error('body should not be read');
							},
							cancel() {
								cancelled = true;
							}
						}),
						{ headers: { 'Content-Length': '6' } }
					)
			)
		);

		await expect(readBuffer(url, undefined, 5)).rejects.toThrow(
			'Runtime asset https://cdn.test/llvm/content-length-limit.bin size exceeds the 5 byte limit'
		);
		expect(cancelled).toBe(true);
	});

	it.each([
		['empty', ''],
		['negative', '-1'],
		['fractional', '1.5'],
		['exponential', '1e2'],
		['duplicate', '2, content-length-secret'],
		['unsafe', '9007199254740992']
	])('rejects and cancels a %s Content-Length declaration', async (caseName, value) => {
		const url = `https://cdn.test/llvm/invalid-content-length-${caseName}.bin`;
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'Content-Length': value } }
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response)
		);
		let rejected: unknown;

		try {
			await readBuffer(url);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe('Runtime asset has an invalid Content-Length');
		if (value) expect((rejected as Error).message).not.toContain(value);
		expect(cancelled).toBe(true);
	});

	it('evicts invalid Content-Length failures so the asset can be retried', async () => {
		const url = 'https://cdn.test/llvm/retry-invalid-content-length.bin';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(new ReadableStream(), { headers: { 'Content-Length': 'invalid' } })
			)
			.mockResolvedValueOnce(new Response(Uint8Array.of(4, 5, 6)));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url)).rejects.toThrow(/invalid Content-Length/u);
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(4, 5, 6));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each(['raw', 'gzip', 'json'] as const)(
		'rejects an invalid %s Content-Length without awaiting body cancellation',
		async (kind) => {
			const url = `https://cdn.test/llvm/uncooperative-content-length.${kind === 'raw' ? 'bin' : kind === 'gzip' ? 'gz' : 'json'}`;
			let resolveCancellation!: () => void;
			const pendingCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn(() => {
				if (kind === 'gzip') throw new Error('llvm-core body cancellation threw');
				if (kind === 'json') {
					return Promise.reject(new Error('llvm-core body cancellation rejected'));
				}
				return pendingCancellation;
			});
			const getReader = vi.fn(() => {
				throw new Error('invalid response body should not be read');
			});
			const response = {
				url: '',
				ok: true,
				status: 200,
				headers: new Headers({ 'Content-Length': '-1' }),
				body: { cancel, getReader }
			} as unknown as Response;
			const fetchMock = vi.fn(async () => response);
			if (kind !== 'json') vi.stubGlobal('fetch', fetchMock);
			const loading =
				kind === 'json' ? fetchRuntimeJson(url, { fetchImpl: fetchMock }) : readBuffer(url);
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
				expect('reason' in outcome ? outcome.reason : undefined).toMatchObject({
					message: 'Runtime asset has an invalid Content-Length'
				});
				expect(cancel).toHaveBeenCalledOnce();
				expect(cancel.mock.calls[0]?.[0]).toMatchObject({
					message: 'Runtime asset has an invalid Content-Length'
				});
				expect(getReader).not.toHaveBeenCalled();
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await loading.catch(() => {});
			}
		}
	);

	it('allows absent and zero Content-Length declarations', async () => {
		const missingUrl = 'https://cdn.test/llvm/missing-content-length.bin';
		const zeroUrl = 'https://cdn.test/llvm/zero-content-length.bin';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(Uint8Array.of(1, 2)))
			.mockResolvedValueOnce(new Response(null, { headers: { 'Content-Length': '0' } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(missingUrl)).resolves.toEqual(Uint8Array.of(1, 2));
		await expect(readBuffer(zeroUrl)).resolves.toEqual(new Uint8Array());
	});

	it('cancels an unknown-length stream as soon as it crosses the byte limit', async () => {
		const url = 'https://cdn.test/llvm/stream-limit.bin';
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(Uint8Array.of(1, 2, 3));
								controller.enqueue(Uint8Array.of(4, 5, 6));
							},
							cancel() {
								cancelled = true;
							}
						})
					)
			)
		);

		await expect(readBuffer(url, undefined, 5)).rejects.toThrow(
			'Runtime asset https://cdn.test/llvm/stream-limit.bin size exceeds the 5 byte limit'
		);
		expect(cancelled).toBe(true);
	});

	it('does not reuse a cached asset across different byte limits', async () => {
		const url = 'https://cdn.test/llvm/cache-limit.bin';
		const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3)));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url, undefined, 3)).resolves.toEqual(Uint8Array.of(1, 2, 3));
		await expect(readBuffer(url, undefined, 2)).rejects.toThrow(
			`Runtime asset ${url} size exceeds the 2 byte limit`
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rejects a ZIP entry from its declared original size before extraction', async () => {
		const expanded = new Uint8Array(4096);
		const archive = zipSync({ 'expanded.bin': expanded }, { level: 6 });
		const limit = archive.byteLength + 16;
		expect(limit).toBeLessThan(expanded.byteLength);
		const url = 'https://cdn.test/llvm/zip-output-limit.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);

		await expect(readBuffer(url, undefined, limit)).rejects.toThrow(
			`Runtime asset ${url} extracted size exceeds the ${limit} byte limit`
		);
	});

	it('omits credentials and referrer metadata from runtime asset fetches', async () => {
		const url = 'https://cdn.test/llvm/request-policy.bin';
		const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1)));
		vi.stubGlobal('fetch', fetchMock);

		await readBuffer(url);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL(url),
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
	});

	it('rejects a response whose final URL differs from the declared asset URL', async () => {
		const url = 'https://cdn.test/llvm/exact-url.bin';
		let cancelled = false;
		const finalUrlSecret = 'signed-final-url-secret';
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', {
			value: `https://runtime-user:password@mirror.test/llvm/exact-url.bin?signature=${finalUrlSecret}#access-token`
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response)
		);

		let rejected: unknown;
		try {
			await readBuffer(url);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe('Runtime asset returned an unexpected final URL');
		expect((rejected as Error).message).not.toContain(finalUrlSecret);
		expect((rejected as Error).message).not.toContain('access-token');
		expect(cancelled).toBe(true);
	});

	it('cancels malformed final URLs and evicts the failed request from the cache', async () => {
		const url = 'https://cdn.test/llvm/invalid-final-url.bin';
		let cancelled = false;
		const invalidResponse = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		const invalidFinalUrl = '://invalid-final-url-secret';
		Object.defineProperty(invalidResponse, 'url', { value: invalidFinalUrl });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(invalidResponse)
			.mockResolvedValueOnce(new Response(Uint8Array.of(7, 8, 9)));
		vi.stubGlobal('fetch', fetchMock);

		let rejected: unknown;
		try {
			await readBuffer(url);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe('Runtime asset returned an invalid final URL');
		expect((rejected as Error).message).not.toContain(invalidFinalUrl);
		expect(cancelled).toBe(true);
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(7, 8, 9));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('cancels failed response bodies before allowing the asset to be retried', async () => {
		const url = 'https://cdn.test/llvm/failed-response.bin';
		let cancelled = false;
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						}
					}),
					{ status: 503 }
				)
			)
			.mockResolvedValueOnce(new Response(Uint8Array.of(7, 8, 9)));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url)).rejects.toThrow(`Failed to load runtime asset ${url}: 503`);
		expect(cancelled).toBe(true);
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(7, 8, 9));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('evicts malformed archives from the cache so the same URL can be retried', async () => {
		const archive = await zipBytes('fixture.bin', Uint8Array.of(12, 13));
		const url = 'https://cdn.test/llvm/retry.zip';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(Uint8Array.of(1, 2, 3)))
			.mockResolvedValueOnce(new Response(archive));
		vi.stubGlobal('fetch', fetchMock);

		await expect(readBuffer(url)).rejects.toThrow();
		await expect(readBuffer(url)).resolves.toEqual(Uint8Array.of(12, 13));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('deduplicates concurrent compilation without prototype-key cache hits', async () => {
		const url = 'https://cdn.test/llvm/concurrent.wasm';
		const compileSpy = vi.spyOn(WebAssembly, 'compile');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(emptyWasm))
		);

		const [first, second] = await Promise.all([compile(url), compile(url)]);

		expect(first).toBe(second);
		expect(compileSpy).toHaveBeenCalledTimes(1);
		compileSpy.mockRestore();
	});

	it('keeps compiled modules isolated by their caller asset ceiling', async () => {
		const url = 'https://cdn.test/llvm/limit-keyed.wasm';
		const fetchMock = vi.fn(async () => new Response(emptyWasm));
		const compileSpy = vi.spyOn(WebAssembly, 'compile');
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			compile(url, undefined, undefined, emptyWasm.byteLength)
		).resolves.toBeInstanceOf(WebAssembly.Module);
		await expect(compile(url, undefined, undefined, emptyWasm.byteLength - 1)).rejects.toThrow(
			new RegExp(`size exceeds the ${emptyWasm.byteLength - 1} byte limit`, 'u')
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(compileSpy).toHaveBeenCalledTimes(1);
		compileSpy.mockRestore();
	});

	it('compiles zipped wasm and instantiates the resulting module', async () => {
		const archive = await zipBytes('fixture.wasm', emptyWasm);
		const url = 'https://cdn.test/llvm/fixture.wasm.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);
		const module = await compile(url);
		const instance = await getInstance(module, {});

		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(instance).toBeInstanceOf(WebAssembly.Instance);
	});
});
