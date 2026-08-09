import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_RUNTIME_ASSET_BYTES, fetchRuntimeAssetBytes } from '../src/runtime-asset.js';
import {
	DEFAULT_MAX_RUNTIME_MANIFEST_BYTES,
	loadRuntimeManifest
} from '../src/runtime-manifest.js';
import type { RuntimeAssetIntegrity, RuntimeAssetIntegrityVerifier } from '../src/types.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const createIntegrity = (
	deliveryBytes: Uint8Array,
	runtimeBytes: Uint8Array
): RuntimeAssetIntegrity => ({
	bytes: deliveryBytes.byteLength,
	sha256: sha256(deliveryBytes),
	uncompressedBytes: runtimeBytes.byteLength,
	uncompressedSha256: sha256(runtimeBytes)
});

const verifyIntegrity: RuntimeAssetIntegrityVerifier = async ({
	asset,
	bytes,
	expected,
	stage
}) => {
	const expectedBytes = stage === 'compressed' ? expected.bytes : expected.uncompressedBytes;
	const expectedSha256 = stage === 'compressed' ? expected.sha256 : expected.uncompressedSha256;
	if (bytes.byteLength !== expectedBytes || sha256(bytes) !== expectedSha256) {
		throw new Error(`integrity mismatch for ${asset} at ${stage}`);
	}
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('runtime asset loader', () => {
	it('inflates gzip-compressed assets after fetch', async () => {
		const body = gzipSync(new TextEncoder().encode('compressed D runtime asset'));
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () => new Response(body),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('compressed D runtime asset');
	});

	it('verifies paired delivery and runtime receipts before publishing gzip assets', async () => {
		const runtimeBytes = new TextEncoder().encode('verified D runtime asset');
		const deliveryBytes = new Uint8Array(gzipSync(runtimeBytes));
		const integrity = createIntegrity(deliveryBytes, runtimeBytes);
		const verifier = vi.fn(verifyIntegrity);

		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () =>
				new Response(deliveryBytes, {
					headers: { 'Content-Length': String(deliveryBytes.byteLength) }
				}),
			undefined,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			undefined,
			integrity,
			verifier
		);

		expect(bytes).toEqual(runtimeBytes);
		expect(verifier).toHaveBeenCalledTimes(2);
		expect(verifier.mock.calls.map(([request]) => request.stage)).toEqual([
			'compressed',
			'uncompressed'
		]);
	});

	it('preserves cancellation while an integrity verifier is stalled', async () => {
		const runtimeBytes = new TextEncoder().encode('verified D runtime asset');
		const deliveryBytes = new Uint8Array(gzipSync(runtimeBytes));
		let releaseVerification!: () => void;
		const verificationGate = new Promise<void>((resolve) => {
			releaseVerification = resolve;
		});
		const verifier = vi.fn(async () => {
			await verificationGate;
		});
		const controller = new AbortController();
		const reason = new Error('stop stalled D integrity verification');
		const loading = fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () => new Response(deliveryBytes),
			undefined,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal,
			createIntegrity(deliveryBytes, runtimeBytes),
			verifier
		);

		await vi.waitFor(() => expect(verifier).toHaveBeenCalledOnce());
		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		releaseVerification();
		await verificationGate;
		expect(verifier).toHaveBeenCalledOnce();
	});

	it('rejects corrupt delivery bytes before decompression or publication', async () => {
		const runtimeBytes = new TextEncoder().encode('expected D runtime asset');
		const expectedDelivery = new Uint8Array(gzipSync(runtimeBytes));
		const corruptDelivery = Uint8Array.from(expectedDelivery);
		corruptDelivery[corruptDelivery.length - 1] ^= 1;

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				async () => new Response(corruptDelivery),
				undefined,
				'gzip',
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				undefined,
				createIntegrity(expectedDelivery, runtimeBytes),
				verifyIntegrity
			)
		).rejects.toThrow('integrity mismatch for ldc2.wasm at compressed');
	});

	it('rejects a truncated receipt-backed response before invoking the verifier', async () => {
		const runtimeBytes = new TextEncoder().encode('expected D runtime asset');
		const expectedDelivery = new Uint8Array(gzipSync(runtimeBytes));
		const truncatedDelivery = expectedDelivery.subarray(0, expectedDelivery.byteLength - 1);
		const verifier = vi.fn(verifyIntegrity);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				async () => new Response(truncatedDelivery),
				undefined,
				'gzip',
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				undefined,
				createIntegrity(expectedDelivery, runtimeBytes),
				verifier
			)
		).rejects.toThrow(
			`ldc2.wasm download size mismatch: expected ${expectedDelivery.byteLength} bytes, received ${truncatedDelivery.byteLength}`
		);
		expect(verifier).not.toHaveBeenCalled();
	});

	it('requires a verifier before fetching receipt-backed assets', async () => {
		const runtimeBytes = new TextEncoder().encode('verified D runtime asset');
		const deliveryBytes = new Uint8Array(gzipSync(runtimeBytes));
		const fetchImpl = vi.fn();

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				fetchImpl,
				undefined,
				'gzip',
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				undefined,
				createIntegrity(deliveryBytes, runtimeBytes)
			)
		).rejects.toThrow('D runtime asset ldc2.wasm requires an integrity verifier');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('verifies transparently decoded gzip against its runtime receipt', async () => {
		const runtimeBytes = new TextEncoder().encode('decoded D runtime asset');
		const deliveryBytes = new Uint8Array(gzipSync(runtimeBytes));
		const verifier = vi.fn(verifyIntegrity);

		const loaded = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () =>
				new Response(runtimeBytes, {
					headers: {
						'Content-Encoding': 'gzip',
						'Content-Length': String(deliveryBytes.byteLength)
					}
				}),
			undefined,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			undefined,
			createIntegrity(deliveryBytes, runtimeBytes),
			verifier
		);

		expect(loaded).toEqual(runtimeBytes);
		expect(verifier).toHaveBeenCalledOnce();
		expect(verifier.mock.calls[0]?.[0].stage).toBe('uncompressed');
	});

	it('rejects corrupt transparently decoded gzip logical bytes', async () => {
		const runtimeBytes = new TextEncoder().encode('decoded D runtime asset');
		const corruptRuntimeBytes = new TextEncoder().encode('corrupt D runtime asset');
		const deliveryBytes = new Uint8Array(gzipSync(runtimeBytes));

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				async () =>
					new Response(corruptRuntimeBytes, {
						headers: {
							'Content-Encoding': 'gzip',
							'Content-Length': String(deliveryBytes.byteLength)
						}
					}),
				undefined,
				'gzip',
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				undefined,
				createIntegrity(deliveryBytes, runtimeBytes),
				verifyIntegrity
			)
		).rejects.toThrow('integrity mismatch for ldc2.wasm at uncompressed');
	});

	it('does not inflate again when fetch already decoded gzip content encoding', async () => {
		const body = new TextEncoder().encode('decoded D runtime asset');
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () =>
				new Response(body, {
					headers: {
						'Content-Encoding': 'gzip'
					}
				}),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('decoded D runtime asset');
	});

	it('omits credentials and rejects redirects for exact HTTP asset requests', async () => {
		const fetchImpl = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3)));
		const controller = new AbortController();

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl,
				undefined,
				undefined,
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				controller.signal
			)
		).resolves.toEqual(Uint8Array.of(1, 2, 3));
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://example.test/runtime/bin/ldc2.wasm',
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: controller.signal
			})
		);
	});

	it('preserves a pre-aborted reason without invoking fetch', async () => {
		const fetchImpl = vi.fn();
		const controller = new AbortController();
		const reason = new Error('stop before D asset fetch');
		controller.abort(reason);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl,
				undefined,
				undefined,
				DEFAULT_MAX_RUNTIME_ASSET_BYTES,
				controller.signal
			)
		).rejects.toBe(reason);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('cancels an uncooperative fetch and disposes its late response', async () => {
		let resolveFetch!: (response: Response) => void;
		const fetchImpl = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				})
		);
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('stop uncooperative D asset fetch');
		const reportProgress = vi.fn();
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm',
			'ldc2.wasm',
			fetchImpl,
			reportProgress,
			undefined,
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);

		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		resolveFetch({
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { cancel, getReader }
		} as unknown as Response);
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		expect(getReader).not.toHaveBeenCalled();
		expect(reportProgress).not.toHaveBeenCalled();
	});

	it('rejects embedded URL credentials before invoking fetch', async () => {
		const fetchImpl = vi.fn();

		await expect(
			fetchRuntimeAssetBytes(
				'https://user:secret@example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl
			)
		).rejects.toThrow('D runtime asset URLs must not include credentials');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('cancels a response whose final URL differs from the declared asset', async () => {
		let cancelled = false;
		const secret = 'signed-query-secret';
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', {
			value: `https://mirror.test/runtime/bin/ldc2.wasm?X-Amz-Signature=${secret}`
		});
		let rejected: unknown;

		try {
			await fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				async () => response
			);
		} catch (error) {
			rejected = error;
		}

		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'D runtime asset ldc2.wasm returned an unexpected final URL'
		);
		expect((rejected as Error).message).not.toContain(secret);
		expect(cancelled).toBe(true);
	});

	it('cancels a response whose final URL is malformed', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		const invalidFinalUrl = '://invalid-final-url-secret';
		Object.defineProperty(response, 'url', { value: invalidFinalUrl });
		let rejected: unknown;

		try {
			await fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				async () => response
			);
		} catch (error) {
			rejected = error;
		}

		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'D runtime asset ldc2.wasm returned an invalid final URL'
		);
		expect((rejected as Error).message).not.toContain(invalidFinalUrl);
		expect(cancelled).toBe(true);
	});

	it('rejects an oversized declared response before reading its body', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
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
					{
						headers: { 'Content-Length': String(DEFAULT_MAX_RUNTIME_ASSET_BYTES + 1) }
					}
				)
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				fetchImpl
			)
		).rejects.toThrow(
			`ldc2.wasm download size exceeds the ${DEFAULT_MAX_RUNTIME_ASSET_BYTES} byte limit`
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
	])('rejects and cancels a %s Content-Length declaration', async (_caseName, value) => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'Content-Length': value } }
		);

		let rejected: unknown;
		try {
			await fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm',
				'ldc2.wasm',
				async () => response
			);
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
		expect((rejected as Error).message).toBe(
			'D runtime asset ldc2.wasm has an invalid Content-Length'
		);
		if (value) expect((rejected as Error).message).not.toContain(value);
		expect(cancelled).toBe(true);
	});

	it('rejects and cancels invalid Content-Length on gzip and manifest paths', async () => {
		let gzipCancelled = false;
		let manifestCancelled = false;
		const gzipResponse = new Response(
			new ReadableStream({
				cancel() {
					gzipCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '-1' } }
		);
		const manifestResponse = new Response(
			new ReadableStream({
				cancel() {
					manifestCancelled = true;
				}
			}),
			{ headers: { 'Content-Length': '1e2' } }
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/bin/ldc2.wasm.gz',
				'ldc2.wasm',
				async () => gzipResponse,
				undefined,
				'gzip'
			)
		).rejects.toThrow(/^D runtime asset ldc2\.wasm has an invalid Content-Length$/u);
		await expect(
			loadRuntimeManifest('https://example.test/runtime/', async () => manifestResponse)
		).rejects.toThrow(
			/^D runtime asset wasm-d runtime manifest has an invalid Content-Length$/u
		);
		expect(gzipCancelled).toBe(true);
		expect(manifestCancelled).toBe(true);
	});

	it('allows absent and zero Content-Length declarations', async () => {
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/no-content-length.bin',
				'D runtime asset',
				async () => new Response(Uint8Array.of(1, 2))
			)
		).resolves.toEqual(Uint8Array.of(1, 2));
		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/zero-content-length.bin',
				'D runtime asset',
				async () => new Response(null, { headers: { 'Content-Length': '0' } })
			)
		).resolves.toEqual(new Uint8Array());
	});

	it('uses a dedicated 4 MiB ceiling for runtime manifests', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull() {
							throw new Error('manifest body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{
						headers: {
							'Content-Length': String(DEFAULT_MAX_RUNTIME_MANIFEST_BYTES + 1)
						}
					}
				)
		);

		await expect(
			loadRuntimeManifest('https://example.test/runtime/', fetchImpl)
		).rejects.toThrow(
			`wasm-d runtime manifest download size exceeds the ${DEFAULT_MAX_RUNTIME_MANIFEST_BYTES} byte limit`
		);
		expect(cancelled).toBe(true);
	});

	it('cancels an unknown-length download as soon as it crosses its byte limit', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
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
		);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/toolchain.tar',
				'D toolchain',
				fetchImpl,
				undefined,
				undefined,
				5
			)
		).rejects.toThrow('D toolchain download size exceeds the 5 byte limit');
		expect(cancelled).toBe(true);
	});

	it('cancels an active unknown-length download with the caller signal', async () => {
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
		const reason = new Error('stop D asset download');
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar',
			'D toolchain',
			fetchImpl,
			undefined,
			undefined,
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(cancelled).toBe(true);
	});

	it.each([
		['while cancellation and the read remain pending', 'pending', false],
		['when cancellation resolves without settling the read', 'resolved', false],
		['when cancellation settles the read before rejection', 'settles-read', true]
	])('rejects a stalled streamed download promptly %s', async (_case, mode, throwOnRelease) => {
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
			if (mode === 'pending') return pendingCancel;
			if (mode === 'settles-read') resolveRead({ done: true, value: undefined });
			return Promise.resolve();
		});
		const releaseFailure = new Error('D reader release failed during abort');
		const releaseLock = vi.fn(() => {
			if (throwOnRelease) throw releaseFailure;
		});
		const response = {
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { getReader: () => ({ read, cancel, releaseLock }) }
		} as unknown as Response;
		const controller = new AbortController();
		const reason =
			mode === 'resolved'
				? new DOMException('D asset deadline exceeded', 'TimeoutError')
				: new Error('stop stalled D asset stream read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reportProgress = vi.fn();
		const loading = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar',
			'D toolchain',
			async () => response,
			reportProgress,
			undefined,
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
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
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(reportProgress).not.toHaveBeenCalled();

			resolveCancel();
			resolveRead({ done: false, value: Uint8Array.of(1) });
			await Promise.resolve();
			await Promise.resolve();
			expect(reportProgress).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: false, value: Uint8Array.of(1) });
			await loading.catch(() => {});
		}
	});

	it('rejects promptly when a bodyless asset read is aborted', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const reason = new Error('stop bodyless D asset read');
		const reportProgress = vi.fn();
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
			'https://example.test/runtime/toolchain.tar',
			'D toolchain',
			async () =>
				({
					ok: true,
					headers: new Headers(),
					body: null,
					arrayBuffer
				}) as unknown as Response,
			reportProgress,
			undefined,
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
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
			expect(reportProgress).not.toHaveBeenCalled();
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

	it('cancels an active gzip decompression chain with the caller signal', async () => {
		const compressed = gzipSync(new Uint8Array(1024), { level: 9 });
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(compressed);
				},
				cancel() {
					cancelled = true;
				}
			})
		);
		const fetchImpl = vi.fn(async () => response);
		const controller = new AbortController();
		const reason = new Error('stop D asset decompression');
		const pending = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar.gz',
			'D toolchain',
			fetchImpl,
			undefined,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		await vi.waitFor(() => expect(cancelled).toBe(true));
	});

	it('suppresses queued gzip progress after a stalled decompression read is aborted', async () => {
		let transformChunk!: (
			chunk: Uint8Array,
			controller: TransformStreamDefaultController<Uint8Array>
		) => void;
		let flushTransform!: (controller: TransformStreamDefaultController<Uint8Array>) => void;
		vi.stubGlobal(
			'TransformStream',
			class {
				constructor(transformer: Transformer<Uint8Array, Uint8Array>) {
					transformChunk = transformer.transform!.bind(transformer);
					flushTransform = transformer.flush!.bind(transformer);
				}
			}
		);
		vi.stubGlobal(
			'DecompressionStream',
			class {
				readonly readable = {};
				readonly writable = {};
			}
		);
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
		const cancel = vi.fn(() => pendingCancel);
		const releaseLock = vi.fn();
		const decompressedStream = { getReader: () => ({ read, cancel, releaseLock }) };
		const limitedDownload = { pipeThrough: vi.fn(() => decompressedStream) };
		const response = {
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { pipeThrough: vi.fn(() => limitedDownload) }
		} as unknown as Response;
		const controller = new AbortController();
		const reason = new Error('stop stalled D gzip output read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reportProgress = vi.fn();
		const loading = fetchRuntimeAssetBytes(
			'https://example.test/runtime/toolchain.tar.gz',
			'D toolchain',
			async () => response,
			reportProgress,
			'gzip',
			DEFAULT_MAX_RUNTIME_ASSET_BYTES,
			controller.signal
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
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(reportProgress).not.toHaveBeenCalled();

			const streamController = {
				enqueue: vi.fn()
			} as unknown as TransformStreamDefaultController<Uint8Array>;
			let transformError: unknown;
			try {
				transformChunk(Uint8Array.of(1, 2, 3), streamController);
			} catch (error) {
				transformError = error;
			}
			expect(transformError).toBe(reason);
			let flushError: unknown;
			try {
				flushTransform(streamController);
			} catch (error) {
				flushError = error;
			}
			expect(flushError).toBe(reason);
			expect(reportProgress).not.toHaveBeenCalled();
			expect(streamController.enqueue).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('bounds streamed gzip output before materializing a decompression bomb', async () => {
		const expanded = new Uint8Array(4096);
		const compressed = gzipSync(expanded, { level: 9 });
		const limit = compressed.byteLength + 16;
		expect(limit).toBeLessThan(expanded.byteLength);

		await expect(
			fetchRuntimeAssetBytes(
				'https://example.test/runtime/toolchain.tar.gz',
				'D toolchain',
				async () => new Response(compressed),
				undefined,
				'gzip',
				limit
			)
		).rejects.toThrow(`D toolchain decompressed size exceeds the ${limit} byte limit`);
	});
});
