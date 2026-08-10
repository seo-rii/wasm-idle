import { createHash } from 'node:crypto';
import { RUBY_RUNTIME_ASSET_PATH, type RubyRuntimeAssetReceipts } from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];
	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<unknown>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: unknown[] = [];
		terminated = false;

		constructor() {
			workers.push(this);
		}

		addEventListener(type: 'message' | 'error', listener: any) {
			this.listeners[type].add(listener);
		}

		removeEventListener(type: 'message' | 'error', listener: any) {
			this.listeners[type].delete(listener);
		}

		postMessage(message: any) {
			this.messages.push(message);
			if (message.type !== 'init') return;
			for (const listener of this.listeners.message) {
				listener({ data: { type: 'ready' } } as MessageEvent<unknown>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}
	class Reader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;
		constructor(public worker: unknown) {}
		listen() {
			return { dispose() {} };
		}
		dispose() {}
	}
	class Writer {
		constructor(public worker: unknown) {}
		dispose() {}
	}
	return { workers, FakeWorker, Reader, Writer };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: workerState.Reader,
	BrowserMessageWriter: workerState.Writer
}));

import { getRubyLanguageServer } from '../src/ruby/server.js';

const MODULE_URL = 'https://runtime.example/ruby/runtime.mjs?v=profile';
const WASM_URL = `https://runtime.example/ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`;
const moduleBytes = new TextEncoder().encode(
	`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url);`
);
const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const integrity = {
	'runtime.mjs': receipt(moduleBytes),
	[RUBY_RUNTIME_ASSET_PATH]: receipt(wasmBytes)
} satisfies RubyRuntimeAssetReceipts;

const responseFor = (bytes: Uint8Array, url: string) => {
	const response = new Response(bytes, {
		headers: { 'Content-Length': String(bytes.byteLength) }
	});
	Object.defineProperty(response, 'url', { value: url });
	return response;
};

afterEach(() => {
	workerState.workers.length = 0;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Ruby language server asset boundary', () => {
	it('preloads exact verified assets and passes detached bytes to the worker', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = input.toString();
			return responseFor(url === MODULE_URL ? moduleBytes : wasmBytes, url);
		});
		vi.stubGlobal('fetch', fetchMock);

		const handle = await getRubyLanguageServer({
			currentUrl: 'https://app.example/editor',
			ruby: { moduleUrl: MODULE_URL, integrity },
			createWorker: () => new workerState.FakeWorker() as unknown as Worker
		});

		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MODULE_URL, WASM_URL]);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			});
		}
		const init = workerState.workers[0].messages[0] as any;
		expect(init).toEqual({
			type: 'init',
			options: {
				moduleUrl: MODULE_URL,
				wasmUrl: WASM_URL,
				integrity,
				moduleBytes,
				wasmBytes
			}
		});
		expect(init.options.integrity).not.toBe(integrity);
		expect(init.options.integrity['runtime.mjs']).not.toBe(integrity['runtime.mjs']);
		expect(Object.isFrozen(init.options.integrity)).toBe(true);

		handle.dispose();
		expect(workerState.workers[0].terminated).toBe(true);
	});

	it.each(['runtime.mjs', RUBY_RUNTIME_ASSET_PATH] as const)(
		'rejects corrupt %s bytes before creating a worker',
		async (corruptAsset) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: RequestInfo | URL) => {
					const url = input.toString();
					const asset = url === MODULE_URL ? 'runtime.mjs' : RUBY_RUNTIME_ASSET_PATH;
					const expected = asset === 'runtime.mjs' ? moduleBytes : wasmBytes;
					const bytes =
						asset === corruptAsset
							? Uint8Array.from(expected, (value) => value ^ 1)
							: expected;
					return responseFor(bytes, url);
				})
			);

			await expect(
				getRubyLanguageServer({
					currentUrl: 'https://app.example/editor',
					ruby: { moduleUrl: MODULE_URL, integrity },
					createWorker: () => new workerState.FakeWorker() as unknown as Worker
				})
			).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'ruby' });
			expect(workerState.workers).toHaveLength(0);
		}
	);

	it('rejects invalid receipts and unresolved root URLs before fetching', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			getRubyLanguageServer({
				rootUrl: '/wasm-idle',
				ruby: {
					integrity: { ...integrity, unexpected: receipt(Uint8Array.of(1)) } as never
				},
				createWorker: () => new workerState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('must describe exactly two assets');
		await expect(
			getRubyLanguageServer({
				rootUrl: '/wasm-idle',
				ruby: { integrity },
				createWorker: () => new workerState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('must resolve to an absolute URL');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(workerState.workers).toHaveLength(0);
	});

	it('aborts the sibling preload after the first integrity failure', async () => {
		let wasmSignal: AbortSignal | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				const url = input.toString();
				if (url === MODULE_URL) {
					return Promise.resolve(
						responseFor(
							Uint8Array.from(moduleBytes, () => 0),
							url
						)
					);
				}
				wasmSignal = init?.signal || undefined;
				return new Promise<Response>(() => undefined);
			})
		);

		await expect(
			getRubyLanguageServer({
				currentUrl: 'https://app.example/editor',
				ruby: { moduleUrl: MODULE_URL, integrity },
				createWorker: () => new workerState.FakeWorker() as unknown as Worker
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
		expect(wasmSignal?.aborted).toBe(true);
		expect(workerState.workers).toHaveLength(0);
	});
});
