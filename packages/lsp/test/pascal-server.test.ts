import { afterEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => {
	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;
		constructor(_worker: Worker) {}
		listen() {
			return { dispose() {} };
		}
		dispose() {}
	}
	class MockWriter {
		constructor(_worker: Worker) {}
		dispose() {}
	}
	return { MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: transportMocks.MockReader,
	BrowserMessageWriter: transportMocks.MockWriter
}));

import { PASCAL_MAX_ASSET_BYTES } from '@wasm-idle/core';
import {
	BUNDLED_PASCAL_RUNTIME_PROFILE,
	BUNDLED_PASCAL_RUNNER_RECEIPT
} from '../src/bundledPascalRuntime.js';
import { getPascalLanguageServer } from '../src/pascal/server.js';
import {
	createPascalTestAssetResponse,
	pascalTestAssetBytes,
	type PascalTestAssetName
} from './pascal-fixture.js';

class ReadyWorker {
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		error: new Set<(event: ErrorEvent) => void>()
	};
	readonly messages: unknown[] = [];
	readonly transfers: Transferable[][] = [];
	terminated = false;

	addEventListener(
		type: 'message' | 'error',
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
	) {
		if (type === 'message') {
			this.listeners.message.add(listener as (event: MessageEvent<unknown>) => void);
		} else {
			this.listeners.error.add(listener as (event: ErrorEvent) => void);
		}
	}

	removeEventListener(
		type: 'message' | 'error',
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
	) {
		if (type === 'message') {
			this.listeners.message.delete(listener as (event: MessageEvent<unknown>) => void);
		} else {
			this.listeners.error.delete(listener as (event: ErrorEvent) => void);
		}
	}

	postMessage(message: unknown, transfer: Transferable[] = []) {
		this.messages.push(message);
		this.transfers.push(transfer);
		for (const listener of this.listeners.message) {
			listener({ data: { type: 'ready' } } as MessageEvent<unknown>);
		}
	}

	terminate() {
		this.terminated = true;
	}
}

const currentUrl = 'https://app.example.com/wasm-idle/editor';
const rootUrl = '/wasm-idle/';

function installAssetFetch(overrides: Partial<Record<PascalTestAssetName, Uint8Array>> = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const requestUrl = new URL(
			typeof input === 'string' || input instanceof URL ? input : input.url
		);
		const response = createPascalTestAssetResponse(requestUrl, overrides);
		if (!response) throw new Error(`Unexpected Pascal asset request: ${requestUrl.href}`);
		return response;
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('getPascalLanguageServer host preflight', () => {
	it('verifies every runtime and runner asset before creating the outer worker', async () => {
		const fetchMock = installAssetFetch();
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);

		const handle = await getPascalLanguageServer({ rootUrl, currentUrl, createWorker });

		expect(createWorker).toHaveBeenCalledOnce();
		expect(new Set(fetchMock.mock.calls.map(([input]) => String(input)))).toEqual(
			new Set([
				`https://app.example.com/wasm-idle/wasm-pascal/runtime-manifest.v2.json?v=${BUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint}`,
				`https://app.example.com/wasm-idle/wasm-pascal/compiler.js.gz.bin?v=${BUNDLED_PASCAL_RUNTIME_PROFILE.compilerJavaScriptReceipt.sha256}`,
				`https://app.example.com/wasm-idle/wasm-pascal/rtl.js.bin?v=${BUNDLED_PASCAL_RUNTIME_PROFILE.rtlJavaScriptReceipt.sha256}`,
				`https://app.example.com/wasm-idle/wasm-pascal/system.pas.bin?v=${BUNDLED_PASCAL_RUNTIME_PROFILE.systemPascalReceipt.sha256}`,
				`https://app.example.com/wasm-idle/wasm-pascal/runner-worker.js?v=${BUNDLED_PASCAL_RUNNER_RECEIPT.sha256}`
			])
		);
		const init = worker.messages[0] as {
			type: string;
			options: Record<string, unknown> & {
				runnerWorkerBytes: Uint8Array;
				runtimePreflight: Record<string, unknown>;
			};
		};
		expect(init.type).toBe('init');
		expect(Object.keys(init.options).sort()).toEqual([
			'maxAssetBytes',
			'runnerWorkerBytes',
			'runtimePreflight',
			'workerReceipt'
		]);
		expect(init.options).toMatchObject({
			maxAssetBytes: PASCAL_MAX_ASSET_BYTES,
			workerReceipt: BUNDLED_PASCAL_RUNNER_RECEIPT,
			runtimePreflight: {
				protocol: 'wasm-idle-pascal-preflight',
				protocolVersion: 1,
				profileId: BUNDLED_PASCAL_RUNTIME_PROFILE.profileId,
				artifactRevision: BUNDLED_PASCAL_RUNTIME_PROFILE.artifactRevision,
				pas2jsVersion: BUNDLED_PASCAL_RUNTIME_PROFILE.pas2jsVersion,
				pas2jsRevision: BUNDLED_PASCAL_RUNTIME_PROFILE.pas2jsRevision,
				manifestFingerprint: BUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint
			}
		});
		expect(init.options.runnerWorkerBytes).toEqual(pascalTestAssetBytes['runner-worker.js']);
		expect(worker.transfers[0]).toHaveLength(5);
		expect(new Set(worker.transfers[0]).size).toBe(5);

		handle.dispose();
	});

	it('does not create the outer worker while the runner preflight is pending', async () => {
		let releaseRunner!: () => void;
		const runnerReady = new Promise<void>((resolve) => {
			releaseRunner = resolve;
		});
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			if (requestUrl.pathname.endsWith('/runner-worker.js')) await runnerReady;
			const response = createPascalTestAssetResponse(requestUrl);
			if (!response) throw new Error(`Unexpected Pascal asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);
		const startup = getPascalLanguageServer({ rootUrl, currentUrl, createWorker });

		await vi.waitFor(() =>
			expect(
				fetchMock.mock.calls.some(([input]) => String(input).includes('runner-worker.js'))
			).toBe(true)
		);
		expect(createWorker).not.toHaveBeenCalled();

		releaseRunner();
		const handle = await startup;
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it.each([
		['runner-worker.js', 'Runtime asset runner-worker.js compressed SHA-256 mismatch'],
		['compiler.js.gz.bin', 'Runtime asset compiler.js.gz.bin compressed SHA-256 mismatch']
	] as const)('rejects corrupt %s before creating the outer worker', async (asset, message) => {
		const corruptBytes = Uint8Array.from(pascalTestAssetBytes[asset]);
		corruptBytes[0] ^= 0xff;
		installAssetFetch({ [asset]: corruptBytes });
		const createWorker = vi.fn();

		await expect(
			getPascalLanguageServer({ rootUrl, currentUrl, createWorker })
		).rejects.toThrow(message);
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('preserves an already-aborted caller reason without fetching or creating a worker', async () => {
		const fetchMock = installAssetFetch();
		const createWorker = vi.fn();
		const controller = new AbortController();
		const reason = new DOMException('Pascal startup cancelled', 'AbortError');
		controller.abort(reason);

		await expect(
			getPascalLanguageServer({
				rootUrl,
				currentUrl,
				createWorker,
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('aborts every pending asset request when the caller cancels mid-preflight', async () => {
		const controller = new AbortController();
		const reason = new DOMException('cancel pending Pascal assets', 'AbortError');
		const fetchMock = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					const abort = () => reject(signal?.reason);
					signal?.addEventListener('abort', abort, { once: true });
					if (signal?.aborted) abort();
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const createWorker = vi.fn();
		const startup = getPascalLanguageServer({
			rootUrl,
			currentUrl,
			createWorker,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		controller.abort(reason);

		await expect(startup).rejects.toBe(reason);
		expect(createWorker).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
	});

	it('aborts sibling runtime requests when runner preflight fails', async () => {
		const runtimeSignals: AbortSignal[] = [];
		const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			if (requestUrl.pathname.endsWith('/runner-worker.js')) {
				const response = new Response('missing', { status: 404 });
				Object.defineProperty(response, 'url', { value: requestUrl.href });
				return Promise.resolve(response);
			}
			const signal = init?.signal as AbortSignal;
			runtimeSignals.push(signal);
			return new Promise<Response>((_resolve, reject) => {
				const abort = () => reject(signal.reason);
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) abort();
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const createWorker = vi.fn();
		const onStatus = vi.fn();

		await expect(
			getPascalLanguageServer({ rootUrl, currentUrl, createWorker, onStatus })
		).rejects.toThrow('Failed to load runner-worker.js: 404');
		expect(runtimeSignals.length).toBeGreaterThan(0);
		expect(runtimeSignals.every((signal) => signal.aborted)).toBe(true);
		expect(createWorker).not.toHaveBeenCalled();
		expect(onStatus.mock.calls[0]?.[0]).toEqual({
			state: 'loading',
			stage: 'pascal-assets',
			loaded: 0,
			total: 1
		});
		expect(onStatus.mock.calls.at(-1)?.[0]).toEqual({
			state: 'error',
			message: 'Failed to load runner-worker.js: 404'
		});
	});

	it('does not cache a failed preflight and succeeds on a later call', async () => {
		let corruptRunner = true;
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			const overrides: Partial<Record<PascalTestAssetName, Uint8Array>> = {};
			if (corruptRunner && requestUrl.pathname.endsWith('/runner-worker.js')) {
				const bytes = Uint8Array.from(pascalTestAssetBytes['runner-worker.js']);
				bytes[0] ^= 0xff;
				overrides['runner-worker.js'] = bytes;
			}
			const response = createPascalTestAssetResponse(requestUrl, overrides);
			if (!response) throw new Error(`Unexpected Pascal asset request: ${requestUrl.href}`);
			return response;
		});
		vi.stubGlobal('fetch', fetchMock);
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);

		await expect(
			getPascalLanguageServer({ rootUrl, currentUrl, createWorker })
		).rejects.toThrow('runner-worker.js compressed SHA-256 mismatch');
		expect(createWorker).not.toHaveBeenCalled();

		corruptRunner = false;
		const handle = await getPascalLanguageServer({ rootUrl, currentUrl, createWorker });
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it('times out preflight without constructing the outer worker', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: string | URL | Request, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						const abort = () => reject(signal?.reason);
						signal?.addEventListener('abort', abort, { once: true });
					})
			)
		);
		const createWorker = vi.fn();

		await expect(
			getPascalLanguageServer({ rootUrl, currentUrl, createWorker, assetTimeoutMs: 5 })
		).rejects.toThrow(/timed out/iu);
		expect(createWorker).not.toHaveBeenCalled();
	});
});
