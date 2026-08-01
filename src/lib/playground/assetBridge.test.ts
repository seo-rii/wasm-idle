import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { RUNTIME_LOAD_ASSETS } from '$lib/playground/assets';
import { WorkerAssetBridge, boundedUtf8ByteLength } from '$lib/playground/assetBridge';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const setBridgeAssetByteLimit = (bridge: WorkerAssetBridge, maxAssetBytes: number) => {
	(bridge as unknown as { maxAssetBytes: number }).maxAssetBytes = maxAssetBytes;
};

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
	it('counts UTF-8 bytes without materializing an oversized encoded buffer', () => {
		expect(boundedUtf8ByteLength('Aé𐀀\ud800', 100)).toBe(10);
		expect(boundedUtf8ByteLength('€€', 5)).toBe(6);
	});

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

	it.each([
		{ label: 'bare', wrap: (blob: Blob) => blob },
		{
			label: 'wrapped',
			wrap: (blob: Blob) => ({ data: blob, mimeType: 'application/wasm' })
		}
	])('rejects an oversized $label loader-owned Blob before materialization', async ({ wrap }) => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const byteLimit = 2;
		const arrayBuffer = vi.fn().mockResolvedValue(Uint8Array.of(1, 2, 3).buffer);
		const blob = new Blob([Uint8Array.of(1, 2, 3)], {
			type: 'application/octet-stream'
		});
		Object.defineProperties(blob, {
			size: { value: 0 },
			arrayBuffer: { value: arrayBuffer }
		});
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockResolvedValue(wrap(blob)),
				useAssetBridge: true
			},
			progress
		);
		setBridgeAssetByteLimit(bridge, byteLimit);
		progress.set.mockClear();

		bridge.handleMessage({
			data: { assetRequest: { id: 33, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 33,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
			}
		});
		expect(postMessage.mock.calls[0]).toHaveLength(1);
		expect(arrayBuffer).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it.each([
		{
			label: 'bare Blob returning an oversized array-like',
			wrap: (blob: Blob) => blob,
			materialize: () => ({ length: Number.MAX_SAFE_INTEGER })
		},
		{
			label: 'wrapped Blob returning an oversized array-like',
			wrap: (blob: Blob) => ({ data: blob }),
			materialize: () => ({ length: Number.MAX_SAFE_INTEGER })
		},
		{
			label: 'bare Blob returning a numeric length',
			wrap: (blob: Blob) => blob,
			materialize: () => Number.MAX_SAFE_INTEGER
		},
		{
			label: 'wrapped Blob returning a numeric length',
			wrap: (blob: Blob) => ({ data: blob }),
			materialize: () => Number.MAX_SAFE_INTEGER
		}
	])('rejects a $label without materializing byte storage', async ({ wrap, materialize }) => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const blob = new Blob([Uint8Array.of(1)]);
		const arrayBuffer = vi.fn().mockResolvedValue(materialize());
		Object.defineProperty(blob, 'arrayBuffer', { value: arrayBuffer });
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockReturnValue(wrap(blob)),
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();

		bridge.handleMessage({
			data: { assetRequest: { id: 35, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 35,
				ok: false,
				error: `Runtime asset ${asset} materialization did not return an ArrayBuffer`
			}
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it.each([
		{
			label: 'bare ArrayBuffer',
			create: () => {
				const data = Uint8Array.of(1, 2, 3).buffer;
				Object.defineProperty(data, 'byteLength', { value: 0 });
				return data;
			}
		},
		{
			label: 'wrapped ArrayBuffer',
			create: () => {
				const data = Uint8Array.of(1, 2, 3).buffer;
				Object.defineProperty(data, 'byteLength', { value: 0 });
				return { data, transferOwnership: true };
			}
		},
		{
			label: 'bare Uint8Array',
			create: () => {
				const data = Uint8Array.of(1, 2, 3);
				Object.defineProperty(data, 'byteLength', { value: 0 });
				return data;
			}
		},
		{
			label: 'wrapped Uint8Array',
			create: () => {
				const data = Uint8Array.of(1, 2, 3);
				Object.defineProperty(data, 'byteLength', { value: 0 });
				return { data, transferOwnership: true };
			}
		}
	])(
		'rejects oversized $label results before progress or response transfer',
		async ({ create }) => {
			const asset = RUNTIME_LOAD_ASSETS.clang[0];
			const byteLimit = 2;
			const postMessage = vi.fn();
			const progress = { set: vi.fn() };
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			const bridge = new WorkerAssetBridge(
				{ postMessage } as unknown as Worker,
				'clang',
				{
					baseUrl: '/clang/',
					loader: vi.fn().mockResolvedValue(create()),
					useAssetBridge: true
				},
				progress
			);
			setBridgeAssetByteLimit(bridge, byteLimit);
			progress.set.mockClear();

			bridge.handleMessage({
				data: { assetRequest: { id: 34, asset } }
			} as MessageEvent);

			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			expect(postMessage).toHaveBeenCalledWith({
				assetResponse: {
					id: 34,
					ok: false,
					error: `Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
				}
			});
			expect(postMessage.mock.calls[0]).toHaveLength(1);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(progress.set).not.toHaveBeenCalled();
		}
	);

	it.each([
		{
			label: 'bare ArrayBuffer',
			create: () => {
				const data = Uint8Array.of(1, 2, 3).buffer;
				structuredClone(data, { transfer: [data] });
				return data;
			}
		},
		{
			label: 'wrapped ArrayBuffer',
			create: () => {
				const data = Uint8Array.of(1, 2, 3).buffer;
				structuredClone(data, { transfer: [data] });
				return { data, transferOwnership: true };
			}
		},
		{
			label: 'bare Uint8Array',
			create: () => {
				const data = Uint8Array.of(1, 2, 3);
				structuredClone(data.buffer, { transfer: [data.buffer] });
				return data;
			}
		},
		{
			label: 'wrapped Uint8Array',
			create: () => {
				const data = Uint8Array.of(1, 2, 3);
				structuredClone(data.buffer, { transfer: [data.buffer] });
				return { data, transferOwnership: true };
			}
		}
	])('rejects a detached $label without falling back to the network', async ({ create }) => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockReturnValue(create()),
				useAssetBridge: true
			},
			progress
		);
		progress.set.mockClear();

		bridge.handleMessage({
			data: { assetRequest: { id: 37, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 37,
				ok: false,
				error: `Runtime asset ${asset} byte data is detached or invalid`
			}
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('rejects an oversized string before encoding, progress, or transfer', async () => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const byteLimit = 2;
		const encode = vi.spyOn(TextEncoder.prototype, 'encode');
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockResolvedValue({ data: '€' }),
				useAssetBridge: true
			},
			progress
		);
		setBridgeAssetByteLimit(bridge, byteLimit);
		progress.set.mockClear();

		bridge.handleMessage({
			data: { assetRequest: { id: 36, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(encode).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 36,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
			}
		});
		expect(postMessage.mock.calls[0]).toHaveLength(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('rejects a shadowed oversized encoded result before progress or transfer', async () => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const byteLimit = 2;
		const encoded = Uint8Array.of(1, 2, 3);
		Object.defineProperty(encoded, 'byteLength', { value: 0 });
		const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValue(encoded);
		const postMessage = vi.fn();
		const progress = { set: vi.fn() };
		const bridge = new WorkerAssetBridge(
			{ postMessage } as unknown as Worker,
			'clang',
			{
				baseUrl: '/clang/',
				loader: vi.fn().mockResolvedValue({ data: 'A' }),
				useAssetBridge: true
			},
			progress
		);
		setBridgeAssetByteLimit(bridge, byteLimit);
		progress.set.mockClear();

		bridge.handleMessage({
			data: { assetRequest: { id: 37, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(encode).toHaveBeenCalledWith('A');
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 37,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
			}
		});
		expect(postMessage.mock.calls[0]).toHaveLength(1);
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('allows a loader-owned Blob at the exact intrinsic byte limit to materialize', async () => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const byteLimit = 2;
		const arrayBuffer = vi.fn().mockResolvedValue(Uint8Array.of(1, 2).buffer);
		const blob = new Blob([Uint8Array.of(1, 2)], { type: 'application/octet-stream' });
		Object.defineProperties(blob, {
			size: { value: byteLimit + 1 },
			arrayBuffer: { value: arrayBuffer }
		});
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(blob),
			useAssetBridge: true
		});
		setBridgeAssetByteLimit(bridge, byteLimit);

		bridge.handleMessage({
			data: { assetRequest: { id: 35, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(arrayBuffer).toHaveBeenCalledOnce();
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 35, ok: true }
		});
	});

	it('copies a bounded view instead of transferring a larger shadowed backing buffer', async () => {
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const backing = Uint8Array.of(1, 2, 3).buffer;
		Object.defineProperty(backing, 'byteLength', { value: 2 });
		const data = new Uint8Array(backing, 0, 2);
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue({ data, transferOwnership: true }),
			useAssetBridge: true
		});
		setBridgeAssetByteLimit(bridge, 2);

		bridge.handleMessage({
			data: { assetRequest: { id: 38, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		const response = postMessage.mock.calls[0]?.[0].assetResponse;
		expect(response).toMatchObject({ id: 38, ok: true });
		expect(response.bytes).not.toBe(backing);
		expect(new Uint8Array(response.bytes)).toEqual(Uint8Array.of(1, 2));
		expect(postMessage.mock.calls[0]?.[1]).toEqual([response.bytes]);
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

	it('disposes stalled gzip decompression without publishing a response', async () => {
		const deliveryBytes = Uint8Array.from(gzipSync(Uint8Array.of(1, 2, 3), { level: 9 }));
		let loadSignal: AbortSignal | undefined;
		let addEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		const loader = vi.fn((request: { signal?: AbortSignal }) => {
			loadSignal = request.signal;
			if (loadSignal) {
				addEventListener = vi.spyOn(loadSignal, 'addEventListener');
				removeEventListener = vi.spyOn(loadSignal, 'removeEventListener');
			}
			return deliveryBytes;
		});
		let outputController!: ReadableStreamDefaultController<Uint8Array>;
		let cancellationReason: unknown;
		const decompressed = new ReadableStream<Uint8Array>({
			start(controller) {
				outputController = controller;
			},
			cancel(reason) {
				cancellationReason = reason;
			}
		});
		const getReader = vi.spyOn(decompressed, 'getReader');
		const writable = new WritableStream<Uint8Array>();
		vi.stubGlobal(
			'DecompressionStream',
			class {
				readonly readable = decompressed;
				readonly writable = writable;
			}
		);
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			useAssetBridge: true
		});
		const asset = 'bin/memfs.wasm.gz';
		const respond = (
			bridge as unknown as {
				respond(request: { id: number; asset: string }): Promise<void>;
			}
		).respond.bind(bridge);
		const responding = respond({ id: 32, asset });
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await vi.waitFor(() => expect(getReader).toHaveBeenCalledOnce());
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
			expect(cancellationReason).toBe(loadSignal?.reason);
			const abortRegistrations = addEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations ?? []) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(postMessage).not.toHaveBeenCalled();
			try {
				outputController.close();
			} catch {}
			await Promise.resolve();
			await Promise.resolve();
			expect(postMessage).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			try {
				outputController.close();
			} catch {}
			await responding;
		}
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

	it.each([
		{
			label: 'bare Uint8Array',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				return { bytes, result: bytes };
			}
		},
		{
			label: 'ownership-wrapped Uint8Array',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				return { bytes, result: { data: bytes, transferOwnership: true } };
			}
		},
		{
			label: 'bare ArrayBuffer',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				return { bytes, result: bytes.buffer };
			}
		},
		{
			label: 'ownership-wrapped ArrayBuffer',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				return { bytes, result: { data: bytes.buffer, transferOwnership: true } };
			}
		},
		{
			label: 'bare Blob materialization',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				const blob = new Blob([bytes]);
				Object.defineProperty(blob, 'arrayBuffer', {
					value: vi.fn(async () => bytes.buffer)
				});
				return { bytes, result: blob };
			}
		},
		{
			label: 'wrapped Blob materialization',
			create: () => {
				const bytes = Uint8Array.of(1, 2, 3);
				const blob = new Blob([bytes]);
				Object.defineProperty(blob, 'arrayBuffer', {
					value: vi.fn(async () => bytes.buffer)
				});
				return { bytes, result: { data: blob, transferOwnership: true } };
			}
		},
		{
			label: 'SharedArrayBuffer view',
			create: () => {
				const bytes = new Uint8Array(new SharedArrayBuffer(3));
				bytes.set([1, 2, 3]);
				return { bytes, result: bytes };
			}
		}
	])(
		'snapshots a mutable $label before asynchronous integrity verification',
		async ({ create }) => {
			let markDigestStarted!: () => void;
			const digestStarted = new Promise<void>((resolve) => {
				markDigestStarted = resolve;
			});
			let resolveDigest!: (value: ArrayBuffer) => void;
			const digestPending = new Promise<ArrayBuffer>((resolve) => {
				resolveDigest = resolve;
			});
			vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => {
				markDigestStarted();
				return digestPending;
			});
			const { bytes, result } = create();
			const originalBytes = Uint8Array.from(bytes);
			const expectedSha256 = createHash('sha256').update(originalBytes).digest('hex');
			const expectedDigest = Uint8Array.from(
				createHash('sha256').update(originalBytes).digest()
			).buffer;
			const postMessage = vi.fn();
			const asset = RUNTIME_LOAD_ASSETS.clang[0];
			const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
				baseUrl: '/clang/',
				loader: vi.fn().mockReturnValue(result),
				integrity: {
					[asset]: { bytes: originalBytes.byteLength, sha256: expectedSha256 }
				},
				useAssetBridge: true
			});

			bridge.handleMessage({
				data: { assetRequest: { id: 32, asset } }
			} as MessageEvent);
			await digestStarted;
			bytes[0] = 9;
			resolveDigest(expectedDigest);

			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
			const response = postMessage.mock.calls[0]?.[0];
			expect(response).toMatchObject({ assetResponse: { id: 32, ok: true } });
			expect(new Uint8Array(response.assetResponse.bytes)).toEqual(originalBytes);
		}
	);

	it.each([
		{
			label: 'Uint8Array',
			create: () => runInNewContext('new Uint8Array([7, 8, 9])') as Uint8Array
		},
		{
			label: 'ArrayBuffer',
			create: () => runInNewContext('new Uint8Array([7, 8, 9]).buffer') as ArrayBuffer
		}
	])('accepts and snapshots a cross-realm $label loader result', async ({ create }) => {
		const postMessage = vi.fn();
		const result = create();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockReturnValue(result),
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		bridge.handleMessage({
			data: { assetRequest: { id: 33, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		const response = postMessage.mock.calls[0]?.[0];
		expect(response).toMatchObject({ assetResponse: { id: 33, ok: true } });
		expect(new Uint8Array(response.assetResponse.bytes)).toEqual(Uint8Array.of(7, 8, 9));
	});

	it.each([
		{ label: 'bare', wrap: (blob: Blob) => blob },
		{ label: 'wrapped', wrap: (blob: Blob) => ({ data: blob }) }
	])('accepts a $label cross-realm Blob loader result', async ({ wrap }) => {
		const iframe = document.createElement('iframe');
		document.body.append(iframe);
		const CrossRealmBlob = (iframe.contentWindow as (Window & { Blob: typeof Blob }) | null)
			?.Blob;
		if (!CrossRealmBlob) throw new Error('Cross-realm Blob is unavailable');
		const blob = new CrossRealmBlob([Uint8Array.of(7, 8, 9)]);
		const postMessage = vi.fn();
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockReturnValue(wrap(blob)),
			useAssetBridge: true
		});
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		try {
			expect(blob).not.toBeInstanceOf(Blob);
			bridge.handleMessage({
				data: { assetRequest: { id: 34, asset } }
			} as MessageEvent);
			await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

			const response = postMessage.mock.calls[0]?.[0];
			expect(response).toMatchObject({ assetResponse: { id: 34, ok: true } });
			expect(new Uint8Array(response.assetResponse.bytes)).toEqual(Uint8Array.of(7, 8, 9));
		} finally {
			iframe.remove();
		}
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
				error: `Runtime asset ${asset} URL is outside the allowed asset bases`
			}
		});
		expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toContain('private/tool.wasm');
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

	it('rejects a substituted response inside the configured asset base before reading', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const arrayBuffer = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			url: 'https://assets.example.com/clang/alternate.wasm?token=secret',
			redirected: true,
			headers: { get: vi.fn(() => null) },
			body: { cancel, getReader },
			arrayBuffer
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
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 23,
				ok: false,
				error: `Runtime asset ${asset} final response URL does not match the requested asset`
			}
		});
		expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toContain('token=secret');
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('accepts an exact final response URL with least-authority fetch options', async () => {
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.python[0];
		const assetUrl = `https://assets.example.com/python/${asset}`;
		const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: assetUrl,
			redirected: false,
			headers: new Headers({ 'content-length': '3' }),
			body: null,
			arrayBuffer
		});
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'python', {
			baseUrl: 'https://assets.example.com/python/',
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 31, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(fetchMock).toHaveBeenCalledWith(
			assetUrl,
			expect.objectContaining({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(arrayBuffer).toHaveBeenCalledOnce();
		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 31, ok: true }
		});
	});

	it('rejects invalid bodyless response materialization without allocating byte storage', async () => {
		const postMessage = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.python[0];
		const assetUrl = `https://assets.example.com/python/${asset}`;
		const arrayBuffer = vi.fn().mockResolvedValue({ length: Number.MAX_SAFE_INTEGER });
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: assetUrl,
			redirected: false,
			headers: new Headers(),
			body: null,
			arrayBuffer
		});
		vi.stubGlobal('fetch', fetchMock);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'python', {
			baseUrl: 'https://assets.example.com/python/',
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 36, asset } }
		} as MessageEvent);

		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 36,
				ok: false,
				error: `Runtime asset ${asset} materialization did not return an ArrayBuffer`
			}
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
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

	it.each([
		['while cancellation and the read remain pending', false],
		['when cancellation settles the read first', true]
	])('aborts a stalled bridge stream read %s', async (_case, settleReadOnCancel) => {
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
		let resolveCancel!: () => void;
		const cancelPending = new Promise<void>((resolve) => {
			resolveCancel = resolve;
		});
		const cancel = vi.fn(() => {
			if (settleReadOnCancel) {
				resolveRead({ done: true, value: undefined });
				return Promise.resolve();
			}
			return cancelPending;
		});
		const releaseLock = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const assetUrl = `https://assets.example.com/clang/${asset}`;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				url: assetUrl,
				headers: new Headers(),
				body: { getReader: () => ({ read, cancel, releaseLock }) }
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
		const reason = new Error('stop bridge asset stream read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = loadAsset(asset, controller.signal);
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
			expect(abortRegistrations).toHaveLength(2);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(progress.set).not.toHaveBeenCalled();
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
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
				error: `Runtime asset ${asset} final response URL does not match the requested asset`
			}
		});
		expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toContain('tool.wasm');
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each([
		['credentials', 'https://user:secret@assets.example.com/clang/tool.wasm'],
		['a fragment', 'https://assets.example.com/clang/tool.wasm#token']
	])('rejects final response URLs containing %s before reading', async (_kind, url) => {
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
				error: `Runtime asset ${asset} final response URL does not match the requested asset`
			}
		});
		expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toContain(url);
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'reports a failed HTTP response without awaiting %s cancellation',
		async (cancellationMode) => {
			let resolveResponse!: (message: unknown) => void;
			const responsePosted = new Promise<unknown>((resolve) => {
				resolveResponse = resolve;
			});
			const postMessage = vi.fn((message: unknown) => resolveResponse(message));
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			let cancelReason: unknown;
			const cancel = vi.fn((reason?: unknown) => {
				cancelReason = reason;
				if (cancellationMode === 'throw') throw new Error('cleanup threw');
				if (cancellationMode === 'reject') {
					return Promise.reject(new Error('cleanup rejected'));
				}
				return stalledCancellation;
			});
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
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				bridge.handleMessage({
					data: { assetRequest: { id: 26, asset } }
				} as MessageEvent);
				const outcome = await Promise.race([
					responsePosted.then((message) => ({ status: 'posted' as const, message })),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome).toEqual({
					status: 'posted',
					message: {
						assetResponse: {
							id: 26,
							ok: false,
							error: `Failed to load ${asset}: 503`
						}
					}
				});
				expect(postMessage).toHaveBeenCalledOnce();
				expect(cancel).toHaveBeenCalledOnce();
				expect(cancel.mock.calls[0]?.[0]).toBe(cancelReason);
				expect(cancelReason).toMatchObject({
					message: `Failed to load ${asset}: 503`
				});
				expect(
					(bridge as unknown as { activeLoads: Set<AbortController> }).activeLoads.size
				).toBe(0);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
			}
		}
	);

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

	it('snapshots loader buffers even when explicit ownership transfer is requested', async () => {
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

		const transferred = postMessage.mock.calls[0]?.[1]?.[0] as ArrayBuffer;
		expect(transferred).not.toBe(bytes.buffer);
		expect(new Uint8Array(transferred)).toEqual(bytes);
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
		['x-wasm-idle-original-content-length', 'sensitive-length-token']
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
				error: `Runtime asset ${asset} has an invalid ${header}`
			}
		});
		if (value) expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toContain(value);
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
		const byteLimit = 2;
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const reader = {
			read: vi.fn().mockResolvedValueOnce({
				done: false,
				value: Uint8Array.of(1, 2, 3)
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
		setBridgeAssetByteLimit(bridge, byteLimit);
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
				error: `Runtime asset ${asset} exceeds the ${byteLimit} byte limit`
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
