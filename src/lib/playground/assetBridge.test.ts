import { afterEach, describe, expect, it, vi } from 'vitest';
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
		const asset = 'bin/memfs.wasm.gz';
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader: vi.fn().mockResolvedValue(Uint8Array.from(gzipSync(runtimeBytes))),
			integrity: {
				[asset]: {
					bytes: runtimeBytes.byteLength,
					sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
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
				error: `Runtime asset ${asset} SHA-256 mismatch: expected ${expectedSha256}, received 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81`
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

	it('rejects redirects outside the configured asset bases and omits credentials', async () => {
		const postMessage = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			url: 'https://evil.example.com/clang/tool.wasm',
			headers: { get: vi.fn(() => null) },
			body: null,
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
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
				.mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5, 6]) })
				.mockResolvedValueOnce({ done: true, value: undefined })
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
	});

	it('rejects an oversized asset before reading its response body', async () => {
		const postMessage = vi.fn();
		const read = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((name: string) =>
						name === 'content-length' ? String(128 * 1024 * 1024 + 1) : null
					)
				},
				body: { getReader: () => ({ read }) }
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
	});

	it('cancels a stream that crosses the runtime asset limit', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn();
		const reader = {
			read: vi.fn().mockResolvedValueOnce({
				done: false,
				value: { byteLength: 128 * 1024 * 1024 + 1 } as Uint8Array
			}),
			cancel
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
		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 20,
				ok: false,
				error: `Runtime asset ${asset} exceeds the ${128 * 1024 * 1024} byte limit`
			}
		});
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
