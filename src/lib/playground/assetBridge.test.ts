import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { RUNTIME_LOAD_ASSETS } from '$lib/playground/assets';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('WorkerAssetBridge progress', () => {
	it('does not mark an asset complete from the first chunk when its total is unknown', () => {
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'clang',
			{ baseUrl: '/clang/', useAssetBridge: true },
			progress
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 64 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0);

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 64 * 1024, total: 128 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0.1);

		bridge.handleMessage({
			data: { assetProgress: { asset, loaded: 128 * 1024, total: 128 * 1024 } }
		} as MessageEvent);
		expect(progress.set).toHaveBeenLastCalledWith(0.2);
	});
});

describe('WorkerAssetBridge asset requests', () => {
	it('rejects assets outside the runtime allowlist before calling the loader', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});

		expect(
			bridge.handleMessage({
				data: {
					assetRequest: { id: 7, asset: 'https://example.com/private-resource' }
				}
			} as MessageEvent)
		).toBe(true);

		await vi.waitFor(() => {
			expect(postMessage).toHaveBeenCalledWith({
				assetResponse: {
					id: 7,
					ok: false,
					error: 'Unexpected clang runtime asset: https://example.com/private-resource'
				}
			});
		});
		expect(loader).not.toHaveBeenCalled();
	});

	it('continues loading assets declared for the runtime', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 8, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(loader).toHaveBeenCalledWith({
			runtime: 'clang',
			asset,
			reportProgress: expect.any(Function),
			signal: expect.any(AbortSignal)
		});
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 8, ok: true, mimeType: undefined }
		});
	});

	it('aborts an uncooperative custom loader without fallback or late progress', async () => {
		let resolveLoader!: (value: null) => void;
		let markLoaderStarted!: () => void;
		const loaderStarted = new Promise<void>((resolve) => {
			markLoaderStarted = resolve;
		});
		let loaderRequest:
			| {
					reportProgress: (loaded: number, total?: number) => void;
			  }
			| undefined;
		const loader = vi.fn(
			(request: { reportProgress: (loaded: number, total?: number) => void }) => {
				loaderRequest = request;
				markLoaderStarted();
				return new Promise<null>((resolve) => {
					resolveLoader = resolve;
				});
			}
		);
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader,
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const loadAsset = (
			bridge as unknown as {
				loadAsset(assetName: string, signal: AbortSignal): Promise<unknown>;
			}
		).loadAsset.bind(bridge);
		const controller = new AbortController();
		const reason = new Error('stop custom runtime asset loader');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = loadAsset(asset, controller.signal);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await loaderStarted;
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
			loaderRequest?.reportProgress(1, 1);
			resolveLoader(null);
			await Promise.resolve();
			await Promise.resolve();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(progress.set).not.toHaveBeenCalled();
			expect(postMessage).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveLoader(null);
			await loading.catch(() => {});
		}
	});

	it.each([
		{ label: 'bare', wrap: (blob: Blob) => blob },
		{
			label: 'wrapped',
			wrap: (blob: Blob) => ({ data: blob, mimeType: 'application/wasm' })
		}
	])('aborts stalled $label loader-owned Blob materialization', async ({ wrap }) => {
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
		const blob = new Blob([], { type: 'application/octet-stream' });
		Object.defineProperty(blob, 'arrayBuffer', { value: arrayBuffer });
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockResolvedValue(wrap(blob)),
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const loadAsset = (
			bridge as unknown as {
				loadAsset(assetName: string, signal: AbortSignal): Promise<unknown>;
			}
		).loadAsset.bind(bridge);
		const controller = new AbortController();
		const reason = new Error('stop loader-owned Blob materialization');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = loadAsset(asset, controller.signal);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await materializationStarted;
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
			const abortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await Promise.resolve();
			await Promise.resolve();
			expect(progress.set).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await loading.catch(() => {});
		}
	});

	it('loads an integrity-pinned Clang runtime manifest through the bridge', async () => {
		const postMessage = vi.fn();
		const bytes = new Uint8Array([1, 2, 3]);
		const asset = 'runtime-manifest.v1.json';
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(bytes),
			integrity: {
				[asset]: {
					bytes: bytes.byteLength,
					sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 24, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 24, ok: true }
		});
	});

	it('verifies and transfers the decoded bytes of gzip delivery assets', async () => {
		const postMessage = vi.fn();
		const runtimeBytes = new Uint8Array([1, 2, 3]);
		const deliveryBytes = Uint8Array.from(gzipSync(runtimeBytes));
		const asset = 'bin/memfs.wasm.gz';
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(deliveryBytes),
			integrity: {
				[asset]: {
					bytes: deliveryBytes.byteLength,
					sha256: createHash('sha256').update(deliveryBytes).digest('hex'),
					uncompressedBytes: runtimeBytes.byteLength,
					uncompressedSha256:
						'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 25, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		const response = postMessage.mock.calls[0]?.[0];
		expect(response, response?.assetResponse?.error).toMatchObject({
			assetResponse: { id: 25, ok: true }
		});
		expect(new Uint8Array(response.assetResponse.bytes)).toEqual(runtimeBytes);
	});

	it('accepts HTTP gzip responses already decoded by content encoding', async () => {
		const postMessage = vi.fn();
		const runtimeBytes = new Uint8Array([1, 2, 3]);
		const deliveryBytes = Uint8Array.from(gzipSync(runtimeBytes));
		const asset = 'bin/memfs.wasm.gz';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(runtimeBytes, {
					headers: {
						'content-encoding': 'gzip',
						'content-length': String(runtimeBytes.byteLength),
						'content-type': 'application/wasm'
					}
				})
			)
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			integrity: {
				[asset]: {
					bytes: deliveryBytes.byteLength,
					sha256: createHash('sha256').update(deliveryBytes).digest('hex'),
					uncompressedBytes: runtimeBytes.byteLength,
					uncompressedSha256:
						'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 27, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		const response = postMessage.mock.calls[0]?.[0];
		expect(response, response?.assetResponse?.error).toMatchObject({
			assetResponse: { id: 27, ok: true }
		});
		expect(new Uint8Array(response.assetResponse.bytes)).toEqual(runtimeBytes);
	});

	it('rejects gzip delivery bytes whose compressed digest does not match', async () => {
		const postMessage = vi.fn();
		const runtimeBytes = new Uint8Array([1, 2, 3]);
		const deliveryBytes = Uint8Array.from(gzipSync(runtimeBytes));
		const asset = 'bin/memfs.wasm.gz';
		const expectedSha256 = '0'.repeat(64);
		const actualSha256 = createHash('sha256').update(deliveryBytes).digest('hex');
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(deliveryBytes),
			integrity: {
				[asset]: {
					bytes: deliveryBytes.byteLength,
					sha256: expectedSha256,
					uncompressedBytes: runtimeBytes.byteLength,
					uncompressedSha256:
						'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 26, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 26,
				ok: false,
				error: `Runtime asset ${asset} compressed SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`
			}
		});
	});

	it('verifies configured asset sizes and SHA-256 digests before transfer', async () => {
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			integrity: {
				[asset]: {
					bytes: 3,
					sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 16, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 16, ok: true }
		});
	});

	it('disposes promptly while integrity verification is stalled', async () => {
		let markDigestStarted!: () => void;
		const digestStarted = new Promise<void>((resolve) => {
			markDigestStarted = resolve;
		});
		let rejectDigest!: (reason: unknown) => void;
		const digestPending = new Promise<ArrayBuffer>((_resolve, reject) => {
			rejectDigest = reject;
		});
		vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => {
			markDigestStarted();
			return digestPending;
		});
		let loadSignal: AbortSignal | undefined;
		let addEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		const bytes = new Uint8Array([1, 2, 3]);
		const loader = vi.fn((request: { signal?: AbortSignal }) => {
			loadSignal = request.signal;
			if (loadSignal) {
				addEventListener = vi.spyOn(loadSignal, 'addEventListener');
				removeEventListener = vi.spyOn(loadSignal, 'removeEventListener');
			}
			return bytes;
		});
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			integrity: {
				[asset]: { bytes: bytes.byteLength, sha256: '0'.repeat(64) }
			},
			useAssetBridge: true
		});
		const respond = (
			bridge as unknown as {
				respond(request: { id: number; asset: string }): Promise<void>;
			}
		).respond.bind(bridge);
		const responding = respond({ id: 31, asset });
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const lateFailure = new Error('late integrity digest failure');

		try {
			await digestStarted;
			bridge.dispose();
			const outcome = await Promise.race([
				responding.then(
					() => ({ status: 'resolved' as const }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'resolved' });
			expect(loadSignal?.aborted).toBe(true);
			const abortRegistrations = addEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations ?? []) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(postMessage).not.toHaveBeenCalled();
			rejectDigest(lateFailure);
			await digestPending.catch(() => undefined);
			await Promise.resolve();
			expect(postMessage).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			rejectDigest(lateFailure);
			await digestPending.catch(() => undefined);
			await responding;
		}
	});

	it('rejects an asset whose SHA-256 digest does not match', async () => {
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const expectedSha256 = '0'.repeat(64);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			integrity: { [asset]: { sha256: expectedSha256 } },
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 17, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 17,
				ok: false,
				error: `Runtime asset ${asset} uncompressed SHA-256 mismatch: expected ${expectedSha256}, received 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81`
			}
		});
	});

	it('rejects requested assets omitted from a configured integrity manifest', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			integrity: {
				[RUNTIME_LOAD_ASSETS.clang[1]]: { sha256: 'a'.repeat(64) }
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 18, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(loader).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 18,
				ok: false,
				error: `Runtime asset ${asset} is missing integrity metadata`
			}
		});
	});

	it('validates an integrity manifest MIME type', async () => {
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue({
				data: new Uint8Array([1, 2, 3]),
				mimeType: 'text/plain; charset=utf-8'
			}),
			integrity: {
				[asset]: {
					sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
					mediaType: 'application/wasm'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 21, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 21,
				ok: false,
				error: `Runtime asset ${asset} MIME type mismatch: expected application/wasm, received text/plain`
			}
		});
	});

	it('rejects loader URLs outside the configured asset bases', async () => {
		const postMessage = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			loader: vi.fn().mockResolvedValue('https://assets.example.com/private/tool.wasm'),
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 22, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(fetchMock).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 22,
				ok: false,
				error: `Runtime asset ${asset} URL is outside the allowed asset bases: https://assets.example.com/private/tool.wasm`
			}
		});
	});

	it.each([
		[
			'credentials',
			'https://user:secret@assets.example.com/clang/tool.wasm',
			'URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.com/clang/tool.wasm#token',
			'URL must not include a fragment'
		]
	])('rejects loader URLs containing %s before fetching', async (_kind, url, errorSuffix) => {
		const postMessage = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			loader: vi.fn().mockResolvedValue(url),
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 29, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(fetchMock).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 29,
				ok: false,
				error: `Runtime asset ${asset} ${errorSuffix}`
			}
		});
	});

	it('rejects redirects outside the configured asset bases and omits credentials', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			url: 'https://evil.example.com/clang/tool.wasm',
			headers: { get: vi.fn(() => null) },
			body: { cancel },
			arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
		});
		vi.stubGlobal('fetch', fetchMock);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 23, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(fetchMock).toHaveBeenCalledWith(
			`https://assets.example.com/clang/${asset}`,
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 23,
				ok: false,
				error: `Runtime asset ${asset} URL is outside the allowed asset bases: https://evil.example.com/clang/tool.wasm`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('aborts an uncooperative asset fetch and cancels its late response', async () => {
		let resolveFetch!: (response: unknown) => void;
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		const fetchMock = vi.fn(() => {
			markFetchStarted();
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const assetUrl = `https://assets.example.com/clang/${asset}`;
		const lateResponse = {
			ok: true,
			status: 200,
			url: assetUrl,
			headers: new Headers(),
			body: { cancel, getReader }
		};
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: 'https://assets.example.com/clang/',
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();
		const loadAsset = (
			bridge as unknown as {
				loadAsset(assetName: string, signal: AbortSignal): Promise<unknown>;
			}
		).loadAsset.bind(bridge);
		const controller = new AbortController();
		const reason = new Error('stop application asset fetch');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = loadAsset(asset, controller.signal);
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
			expect(progress.set).not.toHaveBeenCalled();
			expect(postMessage).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('aborts stalled bodyless response materialization without late progress', async () => {
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
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const assetUrl = `https://assets.example.com/clang/${asset}`;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url: assetUrl,
				headers: new Headers(),
				body: null,
				arrayBuffer
			})
		);
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'clang',
			{
				baseUrl: 'https://assets.example.com/clang/',
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();
		const loadAsset = (
			bridge as unknown as {
				loadAsset(assetName: string, signal: AbortSignal): Promise<unknown>;
			}
		).loadAsset.bind(bridge);
		const controller = new AbortController();
		const reason = new Error('stop bodyless application asset read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = loadAsset(asset, controller.signal);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await materializationStarted;
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
			const abortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await Promise.resolve();
			await Promise.resolve();
			expect(progress.set).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await loading.catch(() => {});
		}
	});

	it('rejects a relative final response URL before reading its body', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const arrayBuffer = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url: 'tool.wasm',
				headers: new Headers(),
				body: { cancel, getReader },
				arrayBuffer
			})
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 25, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 25,
				ok: false,
				error: `Runtime asset ${asset} has an invalid final response URL: tool.wasm`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each([
		[
			'credentials',
			'https://user:secret@assets.example.com/clang/tool.wasm',
			'URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.com/clang/tool.wasm#token',
			'URL must not include a fragment'
		]
	])(
		'rejects final response URLs containing %s before reading',
		async (_kind, url, errorSuffix) => {
			const postMessage = vi.fn();
			const cancel = vi.fn(async () => undefined);
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
			const asset = RUNTIME_LOAD_ASSETS.clang[0];
			const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
				baseUrl: 'https://assets.example.com/clang/',
				useAssetBridge: true
			});

			bridge.handleMessage({
				data: { assetRequest: { id: 30, asset } }
			} as MessageEvent);

			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			expect(postMessage).toHaveBeenCalledWith({
				assetResponse: {
					id: 30,
					ok: false,
					error: `Runtime asset ${asset} ${errorSuffix}`
				}
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
		}
	);

	it('cancels a failed HTTP response before reporting its status', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
				url: '',
				headers: new Headers(),
				body: { cancel }
			})
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 26, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 26,
				ok: false,
				error: `Failed to load ${asset}: 503`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('copies loader-owned buffers before transferring them to a worker', async () => {
		const postMessage = vi.fn();
		const bytes = new Uint8Array([1, 2, 3]);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(bytes),
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 12, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		const transferred = postMessage.mock.calls[0]?.[1]?.[0] as ArrayBuffer;
		expect(transferred).not.toBe(bytes.buffer);
		expect([...new Uint8Array(transferred)]).toEqual([...bytes]);
	});

	it('transfers loader buffers directly only with explicit ownership', async () => {
		const postMessage = vi.fn();
		const bytes = new Uint8Array([4, 5, 6]);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue({ data: bytes, transferOwnership: true }),
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 13, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage.mock.calls[0]?.[1]?.[0]).toBe(bytes.buffer);
	});

	it('assembles streamed fetches without retaining copied chunks', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5, 6]) })
				.mockResolvedValueOnce({ done: true, value: undefined }),
			cancel,
			releaseLock
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) => {
						if (name === 'content-length') return '4';
						if (name === 'content-type') return 'application/wasm';
						return null;
					})
				},
				body: { getReader: () => reader }
			})
		);
		const copySpy = vi.spyOn(Uint8Array, 'from');
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 14, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(copySpy).not.toHaveBeenCalled();
		const transferred = postMessage.mock.calls[0]?.[1]?.[0] as ArrayBuffer;
		expect([...new Uint8Array(transferred)]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(cancel).not.toHaveBeenCalled();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it.each([
		['content-length', ''],
		['content-length', '-1'],
		['content-length', '1.5'],
		['content-length', '1e2'],
		['content-length', '3, 3'],
		['content-length', '9007199254740992'],
		['x-wasm-idle-original-content-length', 'invalid']
	])('rejects an invalid %s before reading its response body: %s', async (header, value) => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const arrayBuffer = vi.fn();
		const headers = new Headers({ [header]: value });
		if (header === 'x-wasm-idle-original-content-length') {
			headers.set('content-length', '3');
		}
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: '',
				headers,
				body: { cancel, getReader },
				arrayBuffer
			})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 27, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 27,
				ok: false,
				error: `Runtime asset ${asset} has an invalid ${header}: ${value}`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('rejects an oversized asset before reading its response body', async () => {
		const postMessage = vi.fn();
		const read = vi.fn();
		const cancel = vi.fn(async () => undefined);
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
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 15, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(read).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 15,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${128 * 1024 * 1024} byte limit`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('cancels a stream that crosses the runtime asset limit', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const reader = {
			read: vi.fn().mockResolvedValueOnce({
				done: false,
				value: { byteLength: 128 * 1024 * 1024 + 1 } as Uint8Array
			}),
			cancel,
			releaseLock
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: { get: vi.fn(() => null) },
				body: { getReader: () => reader }
			})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 20, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 20,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${128 * 1024 * 1024} byte limit`
			}
		});
	});

	it('cancels and releases a response reader when streaming fails', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('asset stream failed'));
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: '',
				headers: new Headers(),
				body: { getReader: () => ({ cancel, read, releaseLock }) }
			})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: 'https://assets.example.com/clang/',
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 28, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 28,
				ok: false,
				error: 'asset stream failed'
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('aborts stale loads and never forwards their response after rebind', async () => {
		const firstWorkerPostMessage = vi.fn();
		const secondWorkerPostMessage = vi.fn();
		let firstSignal: AbortSignal | undefined;
		let resolveFirstLoad!: (value: Uint8Array) => void;
		const firstLoader = vi.fn(
			(request: { signal?: AbortSignal }) =>
				new Promise<Uint8Array>((resolve) => {
					firstSignal = request.signal;
					resolveFirstLoad = resolve;
				})
		);
		const bridge = new WorkerAssetBridge(
			{ postMessage: firstWorkerPostMessage } as unknown as Worker,
			'clang',
			{ baseUrl: '/clang/', loader: firstLoader, useAssetBridge: true }
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 9, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(firstLoader).toHaveBeenCalledOnce());

		const secondLoader = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
		bridge.rebind({ postMessage: secondWorkerPostMessage } as unknown as Worker, {
			baseUrl: '/clang/',
			loader: secondLoader,
			useAssetBridge: true
		});
		expect(firstSignal?.aborted).toBe(true);

		resolveFirstLoad(new Uint8Array([1, 2, 3]));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(firstWorkerPostMessage).not.toHaveBeenCalled();
		expect(secondWorkerPostMessage).not.toHaveBeenCalled();

		bridge.handleMessage({
			data: { assetRequest: { id: 10, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(secondWorkerPostMessage).toHaveBeenCalledOnce());
		expect(secondWorkerPostMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 10, ok: true }
		});
	});

	it('aborts active loads when disposed', async () => {
		const postMessage = vi.fn();
		let signal: AbortSignal | undefined;
		let resolveLoad!: (value: Uint8Array) => void;
		const loader = vi.fn(
			(request: { signal?: AbortSignal }) =>
				new Promise<Uint8Array>((resolve) => {
					signal = request.signal;
					resolveLoad = resolve;
				})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 11, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

		bridge.dispose();
		expect(signal?.aborted).toBe(true);
		resolveLoad(new Uint8Array([1, 2, 3]));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('contains worker postMessage failures while delivering a response', async () => {
		const postMessage = vi.fn(() => {
			throw new DOMException('Worker is gone', 'InvalidStateError');
		});
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 19, asset: RUNTIME_LOAD_ASSETS.clang[0] } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
	});
});
