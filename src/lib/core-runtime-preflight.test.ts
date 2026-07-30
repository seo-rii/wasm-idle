import { createHash } from 'node:crypto';
import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	preflightRuntimeAssets,
	type RuntimeRegistryAsset,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();
const loaderBytes = encoder.encode('export default 1;');
const compressedBytes = encoder.encode('compressed compiler');
const runtimeBytes = encoder.encode('logical compiler');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const assets: readonly RuntimeRegistryAsset[] = [
	{
		key: 'loader',
		path: 'loader.js',
		compressedSha256: sha256(loaderBytes),
		uncompressedSha256: sha256(loaderBytes),
		compressedBytes: loaderBytes.byteLength,
		uncompressedBytes: loaderBytes.byteLength,
		mediaType: 'text/javascript',
		encoding: 'identity'
	},
	{
		key: 'compiler',
		path: 'compiler.wasm.gz',
		compressedSha256: sha256(compressedBytes),
		uncompressedSha256: sha256(runtimeBytes),
		compressedBytes: compressedBytes.byteLength,
		uncompressedBytes: runtimeBytes.byteLength,
		mediaType: 'application/wasm',
		encoding: 'gzip'
	}
];

function createManifest(runtimeAssets = assets): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/preflight-test',
		revision: 'test-v1',
		runtimes: [
			{
				runtimeId: 'fortran/preflight-test',
				identity: {
					languageId: 'FORTRAN',
					implementationId: 'preflight-test',
					implementationVersion: '1.0.0',
					profile: {
						profileId: 'preflight-v1',
						manifestSchemaVersion: 1,
						manifestSha256: 'a'.repeat(64),
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'prebuffered',
					workspace: false,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm'],
				assetRoot: 'runtime',
				assets: runtimeAssets,
				contracts: {
					routeId: 'fortran',
					runtimeAssetKey: 'fortran',
					documentationId: 'FORTRAN'
				}
			}
		]
	};
}

const responseFor = (url: string) => {
	if (url.endsWith('/loader.js')) {
		return new Response(loaderBytes, {
			status: 200,
			headers: {
				'content-length': String(loaderBytes.byteLength),
				'content-type': 'text/javascript; charset=utf-8'
			}
		});
	}
	return new Response(compressedBytes, {
		status: 200,
		headers: {
			'content-length': String(compressedBytes.byteLength),
			'content-type': 'application/gzip'
		}
	});
};

afterEach(() => {
	vi.useRealTimers();
});

describe('runtime registry asset preflight', () => {
	it('loads every declared asset under a nested root before worker startup', async () => {
		const requested: Array<{ url: string; init?: RequestInit }> = [];
		const progress: string[] = [];
		const result = await preflightRuntimeAssets({
			manifest: createManifest(),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/wasm-idle/',
			fetch: async (input, init) => {
				requested.push({ url: String(input), init });
				return responseFor(String(input));
			},
			reportProgress: ({ assetKey, loadedBytes, totalBytes }) =>
				progress.push(`${assetKey}:${loadedBytes}/${totalBytes}`)
		});

		expect(requested.map(({ url }) => url).sort()).toEqual([
			'https://example.test/wasm-idle/runtime/compiler.wasm.gz',
			'https://example.test/wasm-idle/runtime/loader.js'
		]);
		for (const { init } of requested) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(result.assetRootUrl).toBe('https://example.test/wasm-idle/runtime/');
		expect(result.assets.loader?.runtimeIntegrity?.sha256).toBe(sha256(loaderBytes));
		expect(result.assets.compiler?.deliveryIntegrity.sha256).toBe(sha256(compressedBytes));
		expect(result.assets.compiler?.runtimeIntegrity).toBeUndefined();
		expect(result.assets.loader?.cacheKey).toBe(`sha256:${sha256(loaderBytes)}`);
		expect(progress).toContain(`loader:${loaderBytes.byteLength}/${loaderBytes.byteLength}`);
		expect(Object.isFrozen(result.assets)).toBe(true);
	});

	it('releases a successful streamed response reader without cancelling it', async () => {
		const cancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: loaderBytes })
			.mockResolvedValueOnce({ done: true, value: undefined });
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers({
				'content-length': String(loaderBytes.byteLength),
				'content-type': 'text/javascript; charset=utf-8'
			}),
			body: {
				cancel,
				getReader: () => ({ read, cancel, releaseLock })
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).resolves.toMatchObject({
			assets: {
				loader: {
					deliveryIntegrity: { sha256: sha256(loaderBytes) }
				}
			}
		});
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(cancel).not.toHaveBeenCalled();
	});

	it('cancels and releases a response reader when a streamed read fails', async () => {
		const reason = new Error('stream read failed');
		const cancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers({
				'content-length': String(loaderBytes.byteLength),
				'content-type': 'text/javascript; charset=utf-8'
			}),
			body: {
				cancel,
				getReader: () => ({
					read: vi.fn().mockRejectedValue(reason),
					cancel,
					releaseLock
				})
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toMatchObject({
			name: 'AssetNotFoundError',
			code: 'asset-not-found',
			phase: 'asset',
			cause: reason
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledWith(reason);
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it.each([
		['while reader cancellation remains pending', false, false],
		['when reader cancellation settles the read before rejection', true, true]
	])(
		'cancels a stalled streamed response promptly %s',
		async (_case, settleReadOnCancel, throwOnRelease) => {
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
				if (!settleReadOnCancel) return pendingCancel;
				resolveRead({ done: true, value: undefined });
				return Promise.resolve();
			});
			const releaseFailure = new Error('release failed during cancellation');
			const releaseLock = vi.fn(() => {
				if (throwOnRelease) throw releaseFailure;
			});
			let addEventListener!: ReturnType<typeof vi.spyOn>;
			let removeEventListener!: ReturnType<typeof vi.spyOn>;
			const response = {
				url: '',
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'text/javascript; charset=utf-8' }),
				body: { getReader: () => ({ read, cancel, releaseLock }) }
			} as unknown as Response;
			const controller = new AbortController();
			const reason = new Error('cancel stalled preflight stream read');
			const reportProgress = vi.fn();
			const preflight = preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async (_input, init) => {
					const signal = init?.signal as AbortSignal;
					addEventListener = vi.spyOn(signal, 'addEventListener');
					removeEventListener = vi.spyOn(signal, 'removeEventListener');
					return response;
				},
				signal: controller.signal,
				reportProgress
			});
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				await readStarted;
				controller.abort(reason);
				const outcome = await Promise.race([
					preflight.then(
						(value) => ({ status: 'resolved' as const, value }),
						(error) => ({ status: 'rejected' as const, reason: error as unknown })
					),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome.status).toBe('rejected');
				expect('reason' in outcome ? outcome.reason : undefined).toMatchObject({
					name: 'CancelledError',
					code: 'cancelled',
					phase: 'asset',
					cause: reason
				});
				expect(
					'reason' in outcome ? (outcome.reason as { cause?: unknown }).cause : undefined
				).toBe(reason);
				expect(cancel).toHaveBeenCalledOnce();
				expect(cancel).toHaveBeenCalledWith(reason);
				expect(releaseLock).toHaveBeenCalledOnce();
				const abortRegistrations = addEventListener.mock.calls.filter(
					(registration: unknown[]) => registration[0] === 'abort'
				);
				expect(abortRegistrations).toHaveLength(2);
				for (const registration of abortRegistrations) {
					expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
				}
				expect(reportProgress).not.toHaveBeenCalled();

				resolveCancel();
				resolveRead({ done: true, value: undefined });
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(reportProgress).not.toHaveBeenCalled();
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancel();
				resolveRead({ done: true, value: undefined });
				await preflight.catch(() => {});
			}
		}
	);

	it('times out a stalled streamed response and preserves the internal abort reason', async () => {
		vi.useFakeTimers();
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
		const cancel = vi.fn(async () => {});
		const releaseLock = vi.fn();
		let internalSignal!: AbortSignal;
		let addEventListener!: ReturnType<typeof vi.spyOn>;
		let removeEventListener!: ReturnType<typeof vi.spyOn>;
		const reportProgress = vi.fn();
		const preflight = preflightRuntimeAssets({
			manifest: createManifest([assets[0]!]),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/',
			fetch: async (_input, init) => {
				internalSignal = init?.signal as AbortSignal;
				addEventListener = vi.spyOn(internalSignal, 'addEventListener');
				removeEventListener = vi.spyOn(internalSignal, 'removeEventListener');
				return {
					url: '',
					ok: true,
					status: 200,
					headers: new Headers({ 'content-type': 'text/javascript; charset=utf-8' }),
					body: { getReader: () => ({ read, cancel, releaseLock }) }
				} as unknown as Response;
			},
			limits: { assetTimeoutMs: 10 },
			reportProgress
		});

		try {
			await readStarted;
			const outcomePromise = Promise.race([
				preflight.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					setTimeout(() => resolve({ status: 'pending' }), 11);
				})
			]);
			await vi.advanceTimersByTimeAsync(11);
			const outcome = await outcomePromise;

			expect(outcome.status).toBe('rejected');
			expect('reason' in outcome ? outcome.reason : undefined).toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'asset',
				timeoutMs: 10
			});
			const timeoutCause =
				'reason' in outcome ? (outcome.reason as { cause?: unknown }).cause : undefined;
			expect(timeoutCause).toBe(internalSignal.reason);
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(internalSignal.reason);
			expect(releaseLock).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(reportProgress).not.toHaveBeenCalled();
		} finally {
			resolveRead({ done: true, value: undefined });
			await preflight.catch(() => {});
			vi.useRealTimers();
		}
	});

	it('cancels a bodyless response read promptly and suppresses late progress', async () => {
		let resolveArrayBuffer!: (buffer: ArrayBuffer) => void;
		const arrayBuffer = vi.fn(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveArrayBuffer = resolve;
				})
		);
		let removeEventListener!: ReturnType<typeof vi.spyOn>;
		const controller = new AbortController();
		const reason = new Error('cancel bodyless preflight read');
		const reportProgress = vi.fn();
		const pending = preflightRuntimeAssets({
			manifest: createManifest([assets[0]!]),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/',
			fetch: async (_input, init) => {
				removeEventListener = vi.spyOn(init?.signal as AbortSignal, 'removeEventListener');
				return {
					url: '',
					ok: true,
					status: 200,
					headers: new Headers(),
					body: null,
					arrayBuffer
				} as unknown as Response;
			},
			signal: controller.signal,
			reportProgress
		});

		await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'asset',
			cause: reason
		});
		resolveArrayBuffer(loaderBytes.buffer.slice(0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(removeEventListener).toHaveBeenCalledTimes(2);
		expect(reportProgress).not.toHaveBeenCalled();
	});

	it('cancels an uncooperative fetch promptly and disposes its late response', async () => {
		let resolveFetch!: (response: Response) => void;
		let removeEventListener!: ReturnType<typeof vi.spyOn>;
		const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			removeEventListener = vi.spyOn(init?.signal as AbortSignal, 'removeEventListener');
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		});
		const controller = new AbortController();
		const reason = new Error('cancel uncooperative preflight fetch');
		const pending = preflightRuntimeAssets({
			manifest: createManifest([assets[0]!]),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/',
			fetch,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'asset',
			cause: reason
		});

		const cancel = vi.fn(async () => {});
		resolveFetch({
			url: '',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: { cancel }
		} as unknown as Response);
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason));
		expect(removeEventListener).toHaveBeenCalledOnce();
	});

	it('cancels integrity verification promptly and ignores a late digest failure', async () => {
		let rejectDigest!: (reason: unknown) => void;
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
			() =>
				new Promise<ArrayBuffer>((_resolve, reject) => {
					rejectDigest = reject;
				})
		);
		let addEventListener!: ReturnType<typeof vi.spyOn>;
		let removeEventListener!: ReturnType<typeof vi.spyOn>;
		const controller = new AbortController();
		const reason = new Error('cancel integrity verification');
		let published = false;
		const pending = preflightRuntimeAssets({
			manifest: createManifest([assets[0]!]),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/',
			fetch: async (_input, init) => {
				const signal = init?.signal as AbortSignal;
				addEventListener = vi.spyOn(signal, 'addEventListener');
				removeEventListener = vi.spyOn(signal, 'removeEventListener');
				return responseFor('https://example.test/runtime/loader.js');
			},
			signal: controller.signal
		}).then((result) => {
			published = true;
			return result;
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
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

			expect(outcome.status).toBe('rejected');
			expect('reason' in outcome ? outcome.reason : undefined).toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'asset',
				cause: reason
			});
			const abortRegistrations = (
				addEventListener.mock.calls as Array<[string, ...unknown[]]>
			).filter(([type]) => type === 'abort');
			expect(abortRegistrations.length).toBeGreaterThan(0);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}

			rejectDigest(new Error('late integrity failure'));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(published).toBe(false);
		} finally {
			if (timeout) clearTimeout(timeout);
			rejectDigest(new Error('release integrity verification'));
			await pending.catch(() => {});
			digest.mockRestore();
		}
	});

	it('rejects credentialed asset roots without copying secrets into the error', async () => {
		const secret = 'root-password-must-not-leak';
		let rejected: unknown;
		try {
			await preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: `https://runtime-user:${secret}@example.test/`,
				fetch: vi.fn<typeof globalThis.fetch>()
			});
		} catch (error) {
			rejected = error;
		}

		expect(rejected).toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'asset'
		});
		expect((rejected as Error).message).not.toContain(secret);
	});

	it('rejects corrupt or truncated bytes before publishing a result', async () => {
		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => new Response(encoder.encode('truncated'))
			})
		).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			runtimeId: 'fortran/preflight-test',
			profileId: 'preflight-v1'
		});
	});

	it.each(['', '-1', '1.5', '1e2', '3, 3', '9007199254740992'])(
		'rejects and cancels an invalid Content-Length before reading: %s',
		async (contentLength) => {
			let cancelled = false;
			let readerRequested = false;
			const response = {
				url: '',
				ok: true,
				status: 200,
				headers: new Headers({ 'content-length': contentLength }),
				body: {
					async cancel() {
						cancelled = true;
					},
					getReader() {
						readerRequested = true;
						throw new Error('invalid-length response body should not be read');
					}
				}
			} as unknown as Response;

			await expect(
				preflightRuntimeAssets({
					manifest: createManifest([assets[0]!]),
					runtimeId: 'fortran/preflight-test',
					rootUrl: 'https://example.test/',
					fetch: async () => response
				})
			).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'fortran/preflight-test',
				profileId: 'preflight-v1'
			});
			expect(readerRequested).toBe(false);
			expect(cancelled).toBe(true);
		}
	);

	it('redacts an invalid Content-Length before reading and cancelling the body', async () => {
		const rawHeader = '2, content-length-secret';
		let cancelReason: unknown;
		let readerRequested = false;
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers({ 'content-length': rawHeader }),
			body: {
				async cancel(reason?: unknown) {
					cancelReason = reason;
				},
				getReader() {
					readerRequested = true;
					throw new Error('invalid-length response body should not be read');
				}
			}
		} as unknown as Response;
		let rejected: unknown;

		try {
			await preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			});
		} catch (error) {
			rejected = error;
		}

		expect(rejected).toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'asset'
		});
		expect((rejected as Error).message).toBe(
			'Runtime asset loader has an invalid Content-Length'
		);
		expect((rejected as Error).message).not.toContain(rawHeader);
		expect(cancelReason).toBe(rejected);
		expect(readerRequested).toBe(false);
	});

	it('cancels an oversized Content-Length before requesting a reader', async () => {
		const expected = encoder.encode('four');
		const asset: RuntimeRegistryAsset = {
			...assets[0]!,
			compressedSha256: sha256(expected),
			uncompressedSha256: sha256(expected),
			compressedBytes: expected.byteLength,
			uncompressedBytes: expected.byteLength
		};
		let cancelled = false;
		let readerRequested = false;
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers({ 'content-length': '6' }),
			body: {
				async cancel() {
					cancelled = true;
				},
				getReader() {
					readerRequested = true;
					throw new Error('oversized response body should not be read');
				}
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([asset]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response,
				limits: { maxAssetBytes: 5 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			actual: 6,
			limit: 5
		});
		expect(readerRequested).toBe(false);
		expect(cancelled).toBe(true);
	});

	it('rejects a relative final response URL before reading its body', async () => {
		let cancelled = false;
		let readerRequested = false;
		let arrayBufferRequested = false;
		const response = {
			url: 'loader.js',
			ok: true,
			status: 200,
			headers: new Headers(),
			body: {
				async cancel() {
					cancelled = true;
				},
				getReader() {
					readerRequested = true;
					throw new Error('relative final URL response should not be read');
				}
			},
			async arrayBuffer() {
				arrayBufferRequested = true;
				throw new Error('relative final URL response should not be materialized');
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'asset',
			runtimeId: 'fortran/preflight-test',
			profileId: 'preflight-v1'
		});
		expect(cancelled).toBe(true);
		expect(readerRequested).toBe(false);
		expect(arrayBufferRequested).toBe(false);
	});

	it.each([
		[
			'https://runtime-user:final-password-must-not-leak@example.test/runtime/loader.js',
			'final-password-must-not-leak'
		],
		[
			'https://example.test/runtime/loader.js?token=query-secret-must-not-leak',
			'query-secret-must-not-leak'
		],
		[
			'https://example.test/runtime/loader.js#fragment-secret-must-not-leak',
			'fragment-secret-must-not-leak'
		]
	])(
		'rejects an unsafe final URL without copying its secret into the error: %s',
		async (finalUrl, secret) => {
			let cancelled = false;
			let readerRequested = false;
			const response = {
				url: finalUrl,
				ok: true,
				status: 200,
				headers: new Headers(),
				body: {
					async cancel() {
						cancelled = true;
					},
					getReader() {
						readerRequested = true;
						throw new Error('unsafe final URL response body should not be read');
					}
				}
			} as unknown as Response;
			let rejected: unknown;

			try {
				await preflightRuntimeAssets({
					manifest: createManifest([assets[0]!]),
					runtimeId: 'fortran/preflight-test',
					rootUrl: 'https://example.test/',
					fetch: async () => response
				});
			} catch (error) {
				rejected = error;
			}

			expect(rejected).toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'asset',
				runtimeId: 'fortran/preflight-test',
				profileId: 'preflight-v1'
			});
			expect((rejected as Error).message).not.toContain(secret);
			expect(cancelled).toBe(true);
			expect(readerRequested).toBe(false);
		}
	);

	it('cancels a failed HTTP response before returning the asset error', async () => {
		let cancelReason: unknown;
		let readerRequested = false;
		let arrayBufferRequested = false;
		const response = {
			url: '',
			ok: false,
			status: 503,
			headers: new Headers(),
			body: {
				async cancel(reason?: unknown) {
					cancelReason = reason;
				},
				getReader() {
					readerRequested = true;
					throw new Error('failed HTTP response body should not be read');
				}
			},
			async arrayBuffer() {
				arrayBufferRequested = true;
				throw new Error('failed HTTP response body should not be materialized');
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toMatchObject({
			name: 'AssetNotFoundError',
			code: 'asset-not-found',
			phase: 'asset',
			runtimeId: 'fortran/preflight-test',
			profileId: 'preflight-v1',
			recoverable: true
		});
		expect(cancelReason).toMatchObject({
			name: 'AssetNotFoundError',
			code: 'asset-not-found'
		});
		expect(readerRequested).toBe(false);
		expect(arrayBufferRequested).toBe(false);
	});

	it('rejects redirect targets outside the manifest asset root', async () => {
		const response = responseFor('https://example.test/runtime/loader.js');
		Object.defineProperty(response, 'url', {
			value: 'https://cdn.example.test/runtime/loader.js'
		});

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toThrow('outside its declared asset root');
	});

	it('rejects a redirect to a different file within the same asset root', async () => {
		const response = responseFor('https://example.test/runtime/loader.js');
		Object.defineProperty(response, 'url', {
			value: 'https://example.test/runtime/alternate.js'
		});

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toThrow('does not match its declared path');
	});

	it('rejects declared decompressed sizes above the execution limit without fetching', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[1]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch,
				limits: { maxAssetBytes: runtimeBytes.byteLength - 1 }
			})
		).rejects.toMatchObject({ name: 'AssetTooLargeError', code: 'asset-too-large' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('stops a stream as soon as its actual bytes exceed the limit', async () => {
		const declared = encoder.encode('four');
		const oversized = encoder.encode('sixsix');
		const asset: RuntimeRegistryAsset = {
			...assets[0]!,
			compressedSha256: sha256(declared),
			uncompressedSha256: sha256(declared),
			compressedBytes: declared.byteLength,
			uncompressedBytes: declared.byteLength
		};

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([asset]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => new Response(oversized),
				limits: { maxAssetBytes: 5 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			limit: 5,
			actual: oversized.byteLength
		});
	});

	it('returns typed timeout and pre-abort failures', async () => {
		vi.useFakeTimers();
		const fetch = vi.fn<typeof globalThis.fetch>(
			async (_input, init) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true
					});
				})
		);
		const pending = preflightRuntimeAssets({
			manifest: createManifest([assets[0]!]),
			runtimeId: 'fortran/preflight-test',
			rootUrl: 'https://example.test/',
			fetch,
			limits: { assetTimeoutMs: 10 }
		});
		const timedOut = expect(pending).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			timeoutMs: 10
		});
		await vi.advanceTimersByTimeAsync(11);
		await timedOut;

		const controller = new AbortController();
		controller.abort(new Error('stop'));
		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[0]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch,
				signal: controller.signal
			})
		).rejects.toMatchObject({ name: 'CancelledError', code: 'cancelled', phase: 'asset' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('rejects encoded assets that HTTP transparently decodes', async () => {
		let cancelReason: unknown;
		let readerRequested = false;
		let arrayBufferRequested = false;
		const response = {
			url: '',
			ok: true,
			status: 200,
			headers: new Headers({ 'content-encoding': 'gzip' }),
			body: {
				async cancel(reason?: unknown) {
					cancelReason = reason;
				},
				getReader() {
					readerRequested = true;
					throw new Error('transparently decoded response should not be read');
				}
			},
			async arrayBuffer() {
				arrayBufferRequested = true;
				throw new Error('transparently decoded response should not be materialized');
			}
		} as unknown as Response;

		await expect(
			preflightRuntimeAssets({
				manifest: createManifest([assets[1]!]),
				runtimeId: 'fortran/preflight-test',
				rootUrl: 'https://example.test/',
				fetch: async () => response
			})
		).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			phase: 'asset',
			runtimeId: 'fortran/preflight-test',
			profileId: 'preflight-v1'
		});
		expect(cancelReason).toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity'
		});
		expect(readerRequested).toBe(false);
		expect(arrayBufferRequested).toBe(false);
	});
});
