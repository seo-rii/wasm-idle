import { afterEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => {
	const profile = {
		profileId: 'ruby-test-profile',
		artifactRevision: 'a'.repeat(40),
		rubyVersion: '3.4.1',
		rubyRevision: 'b'.repeat(40),
		rubyWasmVersion: '2.9.3-2.9.4',
		rubyWasmRevision: 'c'.repeat(40),
		wasiSdkVersion: '22.0',
		manifestFingerprint: 'd'.repeat(64),
		manifestReceipt: { bytes: 128, sha256: 'e'.repeat(64) },
		moduleJavaScriptReceipt: { bytes: 64, sha256: 'f'.repeat(64) },
		wasmReceipt: {
			bytes: 32,
			sha256: '1'.repeat(64),
			uncompressedBytes: 8,
			uncompressedSha256: '2'.repeat(64)
		}
	};
	return {
		profile,
		preflightRubyRuntimeAssets: vi.fn(),
		snapshotRubyRuntimePreflightProfile: vi.fn((value: unknown) => value)
	};
});

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	RUBY_MAX_ASSET_BYTES: 40 * 1024 * 1024,
	RUBY_RUNTIME_PROFILE: coreMocks.profile,
	preflightRubyRuntimeAssets: coreMocks.preflightRubyRuntimeAssets,
	snapshotRubyRuntimePreflightProfile: coreMocks.snapshotRubyRuntimePreflightProfile
}));

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

import { getRubyLanguageServer } from '../src/ruby/server.js';

const currentUrl = 'https://app.example.com/wasm-idle/editor';
const rootUrl = '/wasm-idle/';

const createPayload = () => ({
	protocol: 'wasm-idle-ruby-preflight',
	protocolVersion: 1,
	profileId: coreMocks.profile.profileId,
	artifactRevision: coreMocks.profile.artifactRevision,
	rubyVersion: coreMocks.profile.rubyVersion,
	rubyRevision: coreMocks.profile.rubyRevision,
	rubyWasmVersion: coreMocks.profile.rubyWasmVersion,
	rubyWasmRevision: coreMocks.profile.rubyWasmRevision,
	wasiSdkVersion: coreMocks.profile.wasiSdkVersion,
	manifestFingerprint: coreMocks.profile.manifestFingerprint,
	manifestBytes: Uint8Array.of(1, 2, 3),
	moduleJavaScriptBytes: Uint8Array.of(4, 5),
	wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
});

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
		this.transfers.push(transfer);
		this.messages.push(structuredClone(message, { transfer }));
		for (const listener of this.listeners.message) {
			listener({ data: { type: 'ready' } } as MessageEvent<unknown>);
		}
	}

	terminate() {
		this.terminated = true;
	}
}

afterEach(() => {
	coreMocks.preflightRubyRuntimeAssets.mockReset();
	coreMocks.snapshotRubyRuntimePreflightProfile.mockClear();
	vi.restoreAllMocks();
});

describe('getRubyLanguageServer host preflight', () => {
	it('preflights the canonical bundle before creating one worker and transfers three owned buffers', async () => {
		const payload = createPayload();
		coreMocks.preflightRubyRuntimeAssets.mockResolvedValue(payload);
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);

		const handle = await getRubyLanguageServer({ rootUrl, currentUrl, createWorker });

		expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledOnce();
		expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'https://app.example.com/wasm-idle/wasm-ruby/',
				manifestUrl: `https://app.example.com/wasm-idle/wasm-ruby/runtime-manifest.v2.json?v=${coreMocks.profile.manifestFingerprint}`,
				moduleUrl: `https://app.example.com/wasm-idle/wasm-ruby/runtime.mjs.bin?v=${coreMocks.profile.moduleJavaScriptReceipt.sha256}`,
				wasmUrl: `https://app.example.com/wasm-idle/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin?v=${coreMocks.profile.wasmReceipt.sha256}`,
				profile: coreMocks.profile,
				signal: expect.any(AbortSignal),
				maxAssetBytes: 40 * 1024 * 1024,
				timeoutMs: expect.any(Number),
				progress: expect.any(Function)
			})
		);
		expect(createWorker).toHaveBeenCalledOnce();
		expect(worker.transfers[0]).toHaveLength(3);
		expect(new Set(worker.transfers[0]).size).toBe(3);
		expect(worker.messages[0]).toMatchObject({
			type: 'init',
			options: {
				runtimePreflight: {
					protocol: 'wasm-idle-ruby-preflight',
					profileId: coreMocks.profile.profileId
				}
			}
		});
		expect(Object.keys((worker.messages[0] as { options: object }).options)).toEqual([
			'runtimePreflight'
		]);
		expect(payload.manifestBytes.byteLength).toBe(0);
		expect(payload.moduleJavaScriptBytes.byteLength).toBe(0);
		expect(payload.wasmBytes.byteLength).toBe(0);

		handle.dispose();
	});

	it('does not create the worker while preflight is pending', async () => {
		let release!: (payload: ReturnType<typeof createPayload>) => void;
		coreMocks.preflightRubyRuntimeAssets.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);
		const startup = getRubyLanguageServer({ rootUrl, currentUrl, createWorker });

		await vi.waitFor(() => expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledOnce());
		expect(createWorker).not.toHaveBeenCalled();

		release(createPayload());
		const handle = await startup;
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it('preserves caller cancellation, creates no worker, and retries with fresh bytes', async () => {
		const controller = new AbortController();
		const reason = new DOMException('cancel Ruby preflight', 'AbortError');
		let firstSignal: AbortSignal | undefined;
		coreMocks.preflightRubyRuntimeAssets
			.mockImplementationOnce((request: { signal?: AbortSignal }) => {
				firstSignal = request.signal;
				return new Promise((_resolve, reject) => {
					const abort = () => reject(request.signal?.reason);
					request.signal?.addEventListener('abort', abort, { once: true });
				});
			})
			.mockResolvedValueOnce(createPayload());
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);
		const startup = getRubyLanguageServer({
			rootUrl,
			currentUrl,
			createWorker,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledOnce());

		controller.abort(reason);

		await expect(startup).rejects.toBe(reason);
		expect(firstSignal?.aborted).toBe(true);
		expect(createWorker).not.toHaveBeenCalled();

		const handle = await getRubyLanguageServer({ rootUrl, currentUrl, createWorker });
		expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it('rejects partial custom trust before preflight or worker creation', async () => {
		const createWorker = vi.fn();

		await expect(
			getRubyLanguageServer({
				currentUrl,
				ruby: { moduleUrl: 'https://assets.example.com/ruby/runtime.mjs.bin' },
				createWorker
			})
		).rejects.toThrow('complete runtime profile');
		expect(coreMocks.preflightRubyRuntimeAssets).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('preserves explicit custom URLs only with one complete flat trust profile', async () => {
		coreMocks.preflightRubyRuntimeAssets.mockResolvedValue(createPayload());
		const worker = new ReadyWorker();
		const createWorker = vi.fn(() => worker as unknown as Worker);
		const customRuby = {
			...coreMocks.profile,
			baseUrl: 'https://assets.example.com/ruby/',
			manifestUrl: 'https://assets.example.com/ruby/runtime-manifest.v2.json',
			moduleUrl: 'https://assets.example.com/ruby/runtime.mjs.bin',
			wasmUrl: 'https://assets.example.com/ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin'
		};

		const handle = await getRubyLanguageServer({ currentUrl, ruby: customRuby, createWorker });

		expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: customRuby.baseUrl,
				manifestUrl: `${customRuby.manifestUrl}?v=${customRuby.manifestFingerprint}`,
				moduleUrl: `${customRuby.moduleUrl}?v=${customRuby.moduleJavaScriptReceipt.sha256}`,
				wasmUrl: `${customRuby.wasmUrl}?v=${customRuby.wasmReceipt.sha256}`,
				profile: expect.objectContaining({
					profileId: customRuby.profileId,
					manifestReceipt: customRuby.manifestReceipt,
					moduleJavaScriptReceipt: customRuby.moduleJavaScriptReceipt,
					wasmReceipt: customRuby.wasmReceipt
				})
			})
		);
		expect(createWorker).toHaveBeenCalledOnce();
		handle.dispose();
	});

	it.each([
		{
			label: 'cross-origin module',
			override: { moduleUrl: 'https://other.example.com/ruby/runtime.mjs.bin' }
		},
		{
			label: 'noncanonical Wasm path',
			override: { wasmUrl: 'https://assets.example.com/ruby/custom-runtime.wasm.gz.bin' }
		},
		{
			label: 'wrong manifest pin',
			override: {
				manifestUrl: `https://assets.example.com/ruby/runtime-manifest.v2.json?v=${'9'.repeat(64)}`
			}
		}
	])('rejects $label despite a complete profile', async ({ override }) => {
		const createWorker = vi.fn();

		await expect(
			getRubyLanguageServer({
				currentUrl,
				ruby: {
					...coreMocks.profile,
					baseUrl: 'https://assets.example.com/ruby/',
					...override
				},
				createWorker
			})
		).rejects.toThrow('canonical query-pinned path');
		expect(coreMocks.preflightRubyRuntimeAssets).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('retires bytes after a worker-construction failure and retries with a fresh preflight', async () => {
		const firstPayload = createPayload();
		const secondPayload = createPayload();
		coreMocks.preflightRubyRuntimeAssets
			.mockResolvedValueOnce(firstPayload)
			.mockResolvedValueOnce(secondPayload);
		const worker = new ReadyWorker();
		const createWorker = vi
			.fn<() => Worker>()
			.mockImplementationOnce(() => {
				throw new Error('worker construction failed');
			})
			.mockReturnValueOnce(worker as unknown as Worker);

		await expect(getRubyLanguageServer({ rootUrl, currentUrl, createWorker })).rejects.toThrow(
			'worker construction failed'
		);
		expect(firstPayload.manifestBytes.byteLength).toBeGreaterThan(0);

		const handle = await getRubyLanguageServer({ rootUrl, currentUrl, createWorker });
		expect(coreMocks.preflightRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(secondPayload.manifestBytes.byteLength).toBe(0);
		handle.dispose();
	});
});
