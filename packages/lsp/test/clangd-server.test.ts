import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as clangdWasm from '../src/clangd/wasm.js';
const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const deliveryBytes = Uint8Array.from(gzipSync(wasmBytes));
const headerTree = {
	schemaVersion: 1,
	version: 'llvm22:fixture',
	targetTriple: 'wasm32-wasi',
	resourceDir: '/lib/clang/22',
	files: {
		'/usr/include/wasm32-wasi/stdio.h': 'selected C headers',
		'/usr/include/c++/v1/vector': 'shared C++ headers',
		'/usr/include/wasm32-wasi/noeh/c++/v1/__config_site': 'selected C++ configuration',
		'/lib/clang/22/include/stddef.h': 'matching resource header'
	}
};
const headerBytes = new TextEncoder().encode(JSON.stringify(headerTree));
const headerDelivery = Uint8Array.from(gzipSync(headerBytes));
const jsBytes = new TextEncoder().encode('export default async () => ({})');
const receipt = (data: Uint8Array, uncompressed?: Uint8Array) => ({
	bytes: data.byteLength,
	sha256: createHash('sha256').update(data).digest('hex'),
	...(uncompressed
		? {
				uncompressedBytes: uncompressed.byteLength,
				uncompressedSha256: createHash('sha256').update(uncompressed).digest('hex')
			}
		: {})
});

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<any>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: any[] = [];
		transfers: Transferable[][] = [];
		terminated = false;

		constructor(private readonly autoReady = true) {
			workers.push(this);
		}

		addEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].add(handler);
		}

		removeEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].delete(handler);
		}

		postMessage(message: any, transfer: Transferable[] = []) {
			this.messages.push(message);
			this.transfers.push(transfer);
			if (message.type !== 'init' || !this.autoReady) return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'progress', value: 2, max: 3 } } as MessageEvent<any>);
			}
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready', value: 64 } } as MessageEvent<any>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}

	class MockReader {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	class MockWriter {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	return { workers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { getCppLanguageServer } from '../src/index.js';

describe('getCppLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(deliveryBytes, {
						status: 200,
						headers: { 'content-length': String(deliveryBytes.length) }
					})
			)
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('keeps receipt-less custom worker startup available without host Web Crypto', async () => {
		vi.stubGlobal('crypto', undefined);
		const prepare = vi.spyOn(clangdWasm, 'prepareClangdWasm');
		const handle = await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/worker-crypto/',
				loader: ({ asset }) => (asset === 'clangd.js' ? jsBytes : deliveryBytes)
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		const worker = mockState.workers[0];
		expect(worker.messages[0].assets.clangdModule).toBeUndefined();
		expect(new Uint8Array(worker.messages[0].assets.clangdWasmGz)).toEqual(deliveryBytes);
		expect(worker.transfers[0]).toHaveLength(2);
		expect(prepare).not.toHaveBeenCalled();
		handle.dispose();
	});
	it('starts clangd with a resolved base URL and sync hook', async () => {
		const status = vi.fn();
		const handle = await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://static.example.com/repl_20240807/clangd/'
			},
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toMatchObject({
			type: 'init',
			baseUrl: 'https://static.example.com/repl_20240807/clangd/',
			assets: {
				clangdJs: expect.any(ArrayBuffer),
				clangdModule: expect.any(WebAssembly.Module)
			}
		});
		expect(worker?.transfers[0]).toHaveLength(1);
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'startup',
			loaded: 0,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({ state: 'loading', loaded: 2, total: 3 });
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.syncFile?.('/workspace/problem.cpp');
		handle.syncFile?.('include\\header.hpp');

		expect(worker?.messages[1]).toEqual({
			type: 'sync-file',
			name: '/workspace/problem.cpp'
		});
		expect(worker?.messages[2]).toEqual({
			type: 'sync-file',
			name: '/workspace/include/header.hpp'
		});
		for (const path of [
			'/workspace/../../usr/include/injected.hpp',
			'/workspaceevil/prefix.cpp',
			'/tmp/outside.cpp',
			'file:///workspace/remote.cpp',
			'include/./nested.hpp',
			'include/bad\0.hpp'
		]) {
			expect(() => handle.syncFile?.(path)).toThrowError();
		}
		expect(worker?.messages).toHaveLength(3);

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});

	it('preloads clangd assets through the configured loader before worker init', async () => {
		const jsBytes = new TextEncoder().encode('export default async () => ({})');
		const wasmDeliveryBytes = deliveryBytes;
		const wasmIntegrity = {
			bytes: wasmDeliveryBytes.byteLength,
			sha256: createHash('sha256').update(wasmDeliveryBytes).digest('hex'),
			uncompressedBytes: wasmBytes.length,
			uncompressedSha256: createHash('sha256').update(wasmBytes).digest('hex')
		};
		const loader = vi.fn(async ({ asset }: { asset: string }) =>
			asset === 'clangd.js' ? jsBytes : wasmDeliveryBytes
		);
		await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://cdn.example.com/clangd',
				loader,
				integrity: {
					'clangd.js': {
						bytes: jsBytes.byteLength,
						sha256: createHash('sha256').update(jsBytes).digest('hex')
					},
					'clangd.wasm.gz': wasmIntegrity
				}
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		const worker = mockState.workers[0];

		expect(loader).toHaveBeenCalledTimes(2);
		expect(worker?.messages[0]).toMatchObject({
			type: 'init',
			baseUrl: 'https://cdn.example.com/clangd/',
			assets: {
				clangdJs: expect.any(ArrayBuffer),
				clangdModule: expect.any(WebAssembly.Module),
				clangdWasmSha256: wasmIntegrity.uncompressedSha256
			}
		});
		expect(worker?.transfers[0]).toHaveLength(1);
	});

	it('starts JS, headers and Wasm preparation concurrently and waits for verified headers', async () => {
		const headerAsset = 'headers/custom.json.gz';
		const pending = new Map<
			string,
			{ promise: Promise<Uint8Array>; resolve: (bytes: Uint8Array) => void }
		>();
		for (const asset of ['clangd.js', 'clangd.wasm.gz', headerAsset]) {
			let resolve!: (bytes: Uint8Array) => void;
			const promise = new Promise<Uint8Array>((yes) => {
				resolve = yes;
			});
			pending.set(asset, { promise, resolve });
		}
		const loader = vi.fn(({ asset }: { asset: string }) => pending.get(asset)!.promise);
		const starting = getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/parallel/',
				headers: headerAsset,
				loader,
				integrity: {
					'clangd.js': receipt(jsBytes),
					'clangd.wasm.gz': receipt(deliveryBytes, wasmBytes),
					[headerAsset]: receipt(headerDelivery, headerBytes)
				}
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
		expect(mockState.workers).toHaveLength(0);
		pending.get('clangd.js')!.resolve(jsBytes);
		pending.get('clangd.wasm.gz')!.resolve(deliveryBytes);
		await Promise.resolve();
		expect(mockState.workers).toHaveLength(0);
		pending.get(headerAsset)!.resolve(headerDelivery);
		const handle = await starting;
		expect(mockState.workers[0].messages[0].assets).toMatchObject({
			clangdModule: expect.any(WebAssembly.Module),
			clangdHeaders: headerTree
		});
		expect(mockState.workers[0].transfers[0]).toHaveLength(1);
		handle.dispose();
	});

	it.each([
		{ label: 'bare SHA-256', expected: receipt(headerDelivery).sha256 },
		{ label: 'compressed-only object', expected: receipt(headerDelivery) }
	])('accepts configured header assets pinned by $label', async ({ expected }) => {
		const headerAsset = 'headers/custom.json.gz';
		const loader = vi.fn(({ asset }: { asset: string }) =>
			asset === 'clangd.js' ? jsBytes : asset === headerAsset ? headerDelivery : deliveryBytes
		);
		const handle = await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/compressed-header-receipts/',
				headers: headerAsset,
				loader,
				integrity: {
					'clangd.js': receipt(jsBytes),
					'clangd.wasm.gz': receipt(deliveryBytes, wasmBytes),
					[headerAsset]: expected
				}
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		expect(loader).toHaveBeenCalledTimes(3);
		expect(mockState.workers[0].messages[0].assets.clangdHeaders).toEqual(headerTree);
		expect(mockState.workers[0].transfers[0]).toHaveLength(1);
		handle.dispose();
	});

	it.each([
		{
			label: 'digest only',
			logical: { uncompressedSha256: receipt(headerDelivery, headerBytes).uncompressedSha256 }
		},
		{ label: 'size only', logical: { uncompressedBytes: headerBytes.byteLength } }
	])('rejects partial logical header metadata: $label', async ({ logical }) => {
		const headerAsset = 'headers/custom.json.gz';
		await expect(
			getCppLanguageServer({
				cpp: {
					baseUrl: 'https://assets.example.com/partial-header-receipts/',
					headers: headerAsset,
					loader: ({ asset }) =>
						asset === 'clangd.js'
							? jsBytes
							: asset === headerAsset
								? headerDelivery
								: deliveryBytes,
					integrity: {
						'clangd.js': receipt(jsBytes),
						'clangd.wasm.gz': receipt(deliveryBytes, wasmBytes),
						[headerAsset]: { ...receipt(headerDelivery), ...logical }
					}
				},
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('missing uncompressed integrity metadata');
		expect(mockState.workers).toHaveLength(0);
	});

	it.each([
		{ label: 'compressed', expected: '0'.repeat(64) },
		{
			label: 'logical',
			expected: {
				...receipt(headerDelivery, headerBytes),
				uncompressedSha256: '0'.repeat(64)
			}
		}
	])('rejects incorrect $label header digests before worker startup', async ({ expected }) => {
		const headerAsset = 'headers/custom.json.gz';
		await expect(
			getCppLanguageServer({
				cpp: {
					baseUrl: 'https://assets.example.com/incorrect-header-receipts/',
					headers: headerAsset,
					loader: ({ asset }) =>
						asset === 'clangd.js'
							? jsBytes
							: asset === headerAsset
								? headerDelivery
								: deliveryBytes,
					integrity: {
						'clangd.js': receipt(jsBytes),
						'clangd.wasm.gz': receipt(deliveryBytes, wasmBytes),
						[headerAsset]: expected
					}
				},
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('SHA-256 mismatch');
		expect(mockState.workers).toHaveLength(0);
	});

	it('aborts all parallel asset consumers on caller cancellation', async () => {
		const controller = new AbortController();
		const signals: AbortSignal[] = [];
		const loader = vi.fn(({ signal }: { signal: AbortSignal }) => {
			signals.push(signal);
			return new Promise<Uint8Array>(() => {});
		});
		const starting = getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/cancel-parallel/',
				headers: 'clangd.headers.json.gz',
				loader
			},
			signal: controller.signal,
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		const rejected = expect(starting).rejects.toThrow('cancel parallel startup');
		await vi.waitFor(() => expect(signals).toHaveLength(3));
		controller.abort(new Error('cancel parallel startup'));
		await rejected;
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(mockState.workers).toHaveLength(0);
	});

	it('aborts siblings when one parallel asset preparation fails', async () => {
		const signals = new Map<string, AbortSignal>();
		let fail!: (error: Error) => void;
		const loader = vi.fn(({ asset, signal }: { asset: string; signal: AbortSignal }) => {
			signals.set(asset, signal);
			return new Promise<Uint8Array>((_resolve, reject) => {
				if (asset === 'clangd.js') fail = reject;
			});
		});
		const starting = getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/fail-parallel/',
				headers: 'clangd.headers.json.gz',
				loader
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		const rejected = expect(starting).rejects.toThrow('JS preparation failed');
		await vi.waitFor(() => expect(signals.size).toBe(3));
		fail(new Error('JS preparation failed'));
		await rejected;
		// The rejected JS operation has already disposed its lifecycle listener.
		// Downloads still running must receive the group abort.
		expect(signals.get('clangd.wasm.gz')?.aborted).toBe(true);
		expect(signals.get('clangd.headers.json.gz')?.aborted).toBe(true);
		expect(mockState.workers).toHaveLength(0);
	});

	it('keeps explicit embedded-header configurations on their two-asset loader contract', async () => {
		const loader = vi.fn(({ asset }: { asset: string }) =>
			asset === 'clangd.js' ? jsBytes : deliveryBytes
		);
		const handle = await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/embedded/',
				loader,
				headers: false,
				integrity: {
					'clangd.js': receipt(jsBytes),
					'clangd.wasm.gz': receipt(deliveryBytes, wasmBytes),
					'clangd.headers.json.gz': receipt(headerDelivery, headerBytes)
				}
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		expect(loader.mock.calls.map(([request]) => request.asset).sort()).toEqual([
			'clangd.js',
			'clangd.wasm.gz'
		]);
		expect(mockState.workers[0].messages[0].assets.clangdHeaders).toBeUndefined();
		handle.dispose();
	});

	it('rejects a configured header URL outside the allowed base before invoking a loader', async () => {
		const loader = vi.fn(() => deliveryBytes);
		await expect(
			getCppLanguageServer({
				cpp: {
					baseUrl: 'https://assets.example.com/clangd/',
					headers: 'https://outside.example.com/headers.json.gz',
					loader
				},
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('outside the allowed asset bases');
		expect(loader).not.toHaveBeenCalled();
		expect(mockState.workers).toHaveLength(0);
	});

	it('preserves caller HTTP cache, redirect and exact final URL policies', async () => {
		const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
			const url = String(input);
			const response = new Response(url.endsWith('clangd.js') ? jsBytes : deliveryBytes);
			Object.defineProperty(response, 'url', { value: url });
			return response;
		});
		vi.stubGlobal('fetch', fetch);
		const handle = await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://assets.example.com/custom-policy/',
				cache: 'no-store',
				redirect: 'error',
				requireExactResponseUrl: true
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		for (const call of fetch.mock.calls)
			expect(call[1]).toMatchObject({
				cache: 'no-store',
				redirect: 'error',
				credentials: 'omit'
			});
		handle.dispose();
	});

	it('preloads the same verified Objective-C headers used by execution', async () => {
		const headerBytes = new TextEncoder().encode(
			JSON.stringify({ 'objc/objc.h': 'typedef struct objc_object *id;' })
		);
		const foundationBytes = new TextEncoder().encode(
			JSON.stringify({ 'Foundation/Foundation.h': '@interface NSString @end' })
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const path = new URL(String(input)).pathname;
				return new Response(
					path.endsWith('foundation-headers.json') ? foundationBytes : headerBytes
				);
			})
		);
		const receipt = (bytes: Uint8Array) => ({
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
		const handle = await getCppLanguageServer({
			cpp: { baseUrl: 'https://assets.example.com/clangd/', loader: () => deliveryBytes },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			objectiveC: {
				baseUrl: 'https://assets.example.com/wasm-objectivec/',
				headersUrl: 'https://assets.example.com/wasm-objectivec/headers.json?v=pinned',
				foundationHeadersUrl:
					'https://assets.example.com/wasm-objectivec/foundation-headers.json?v=pinned',
				integrity: {
					'headers.json': receipt(headerBytes),
					'foundation-headers.json': receipt(foundationBytes)
				}
			}
		});
		expect(mockState.workers[0]?.messages[0].assets.objectiveCHeaders).toEqual({
			'objc/objc.h': 'typedef struct objc_object *id;',
			'Foundation/Foundation.h': '@interface NSString @end'
		});
		handle.dispose();
	});

	it('fails asset preflight before creating a worker', async () => {
		const status = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 404 }))
		);

		await expect(
			getCppLanguageServer({
				rootUrl: 'https://static.example.com/wasm-idle',
				currentUrl: 'https://app.example.com/wasm-idle/',
				createWorker: () => new mockState.FakeWorker() as unknown as Worker,
				onStatus: status
			})
		).rejects.toThrow('Failed to load clangd.js: 404');

		expect(mockState.workers).toHaveLength(0);
		expect(status).toHaveBeenLastCalledWith({
			state: 'error',
			message: 'Failed to load clangd.js: 404'
		});
	});

	it('propagates caller cancellation into asset preflight', async () => {
		const controller = new AbortController();
		const loader = vi.fn();
		controller.abort(new Error('clangd start cancelled'));

		await expect(
			getCppLanguageServer({
				cpp: {
					baseUrl: 'https://static.example.com/clangd/',
					loader
				},
				signal: controller.signal,
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('clangd start cancelled');

		expect(loader).not.toHaveBeenCalled();
		expect(mockState.workers).toHaveLength(0);
	});

	it('terminates a worker that never reports ready', async () => {
		vi.spyOn(clangdWasm, 'prepareClangdWasm').mockResolvedValue({
			module: new WebAssembly.Module(wasmBytes),
			bytes: wasmBytes.length,
			sha256: createHash('sha256').update(wasmBytes).digest('hex')
		});
		vi.useFakeTimers();
		const loading = getCppLanguageServer({
			cpp: {
				baseUrl: 'https://static.example.com/clangd/',
				loader: ({ asset }) =>
					asset === 'clangd.js'
						? { data: 'export default async () => ({})' }
						: deliveryBytes
			},
			startupTimeoutMs: 25,
			createWorker: () => new mockState.FakeWorker(false) as unknown as Worker
		});
		const rejection = expect(loading).rejects.toThrow(
			'Language server startup timed out after 25 ms'
		);

		await vi.advanceTimersByTimeAsync(0);
		expect(mockState.workers).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(mockState.workers[0]?.terminated).toBe(true);
	});
});
