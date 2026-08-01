import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

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
					new Response(new Uint8Array([0x1f, 0x8b, 0x08]), {
						status: 200,
						headers: { 'content-length': '3' }
					})
			)
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
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
				clangdWasmGz: expect.any(ArrayBuffer)
			}
		});
		expect(worker?.transfers[0]).toHaveLength(2);
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
		const wasmDeliveryBytes = new Uint8Array([0x1f, 0x8b, 0x08]);
		const wasmIntegrity = {
			bytes: wasmDeliveryBytes.byteLength,
			sha256: createHash('sha256').update(wasmDeliveryBytes).digest('hex'),
			uncompressedBytes: 64,
			uncompressedSha256: 'a'.repeat(64)
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
				clangdWasmGz: expect.any(ArrayBuffer),
				clangdWasmIntegrity: wasmIntegrity
			}
		});
		expect(worker?.transfers[0]).toHaveLength(2);
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
		vi.useFakeTimers();
		const loading = getCppLanguageServer({
			cpp: {
				baseUrl: 'https://static.example.com/clangd/',
				loader: ({ asset }) =>
					asset === 'clangd.js'
						? { data: 'export default async () => ({})' }
						: new Uint8Array(3)
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
