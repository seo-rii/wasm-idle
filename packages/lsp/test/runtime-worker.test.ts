import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadLanguageToolAsset: vi.fn()
}));

vi.mock('../src/assets.js', () => ({
	loadLanguageToolAsset: mocks.loadLanguageToolAsset
}));

import { runRuntimeWorkerDiagnostics } from '../src/runtime-worker.js';

describe('runRuntimeWorkerDiagnostics', () => {
	afterEach(() => {
		mocks.loadLanguageToolAsset.mockReset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('executes only receipt-verified worker bytes through a Blob URL', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const receipt = { bytes: workerBytes.byteLength, sha256: 'a'.repeat(64) };
		mocks.loadLanguageToolAsset.mockResolvedValue({ bytes: workerBytes });
		let workerBlob: Blob | undefined;
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			workerBlob = blob;
			return 'blob:verified-prolog-worker';
		});
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const workerConstructed = vi.fn();
		const workers: Array<{
			url: string | URL;
			messages: unknown[];
			terminated: boolean;
		}> = [];
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;
			messages: unknown[] = [];
			terminated = false;

			constructor(readonly url: string | URL) {
				workerConstructed(url);
				workers.push(this);
			}

			postMessage(message: unknown) {
				this.messages.push(message);
				this.onmessage?.({ data: { output: 'first ' } } as MessageEvent);
				this.onmessage?.({ data: { output: 'second' } } as MessageEvent);
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {
				this.terminated = true;
			}
		}
		vi.stubGlobal('Worker', FakeWorker);

		const message = { code: 'main :- true.', diagnose: true };
		const result = await runRuntimeWorkerDiagnostics({
			workerUrl: 'https://assets.example.com/wasm-prolog/runner-worker.js?v=pinned',
			workerReceipt: receipt,
			message,
			timeoutMs: 1234,
			timeoutMessage: 'Prolog diagnostics timed out'
		});

		expect(mocks.loadLanguageToolAsset).toHaveBeenCalledOnce();
		const [runtime, asset, config, reportProgress, loadOptions] =
			mocks.loadLanguageToolAsset.mock.calls[0];
		expect({ runtime, asset, config, loadOptions }).toMatchObject({
			runtime: 'prolog',
			asset: 'runner-worker.js',
			config: {
				baseUrl: 'https://assets.example.com/wasm-prolog/',
				integrity: { 'runner-worker.js': receipt },
				cache: 'no-store',
				redirect: 'error',
				requireExactResponseUrl: true
			},
			loadOptions: { timeoutMs: 1234 }
		});
		expect(config.loader()).toEqual(
			new URL('https://assets.example.com/wasm-prolog/runner-worker.js?v=pinned')
		);
		expect(reportProgress).toEqual(expect.any(Function));
		expect(createObjectUrl).toHaveBeenCalledOnce();
		expect(workerBlob?.type).toBe('text/javascript');
		expect(new Uint8Array(await workerBlob?.arrayBuffer())).toEqual(workerBytes);
		expect(workerConstructed).toHaveBeenCalledWith('blob:verified-prolog-worker');
		expect(workerConstructed.mock.invocationCallOrder[0]).toBeLessThan(
			revokeObjectUrl.mock.invocationCallOrder[0]
		);
		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:verified-prolog-worker');
		expect(workers[0]).toMatchObject({ messages: [message], terminated: true });
		expect(result).toEqual({ error: undefined, output: 'first second' });
	});

	it('preserves direct URL workers for runtimes without a worker receipt', async () => {
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const constructed = vi.fn();
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;

			constructor(url: string | URL) {
				constructed(url);
			}

			postMessage() {
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerUrl: 'https://assets.example.com/legacy-worker.js',
				message: {},
				timeoutMessage: 'Legacy diagnostics timed out'
			})
		).resolves.toEqual({ error: undefined, output: '' });

		expect(constructed).toHaveBeenCalledWith('https://assets.example.com/legacy-worker.js');
		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(createObjectUrl).not.toHaveBeenCalled();
	});

	it('rejects malformed receipts before loading or constructing a worker', async () => {
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerUrl: 'https://assets.example.com/wasm-prolog/runner-worker.js',
				workerReceipt: { bytes: 0, sha256: 'A'.repeat(64) },
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('Runtime diagnostic worker receipt is invalid');

		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(createObjectUrl).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
	});

	it('rejects non-UTF-8 worker bytes before creating executable content', async () => {
		mocks.loadLanguageToolAsset.mockResolvedValue({ bytes: Uint8Array.of(0xc3, 0x28) });
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerUrl: 'https://assets.example.com/wasm-prolog/runner-worker.js',
				workerReceipt: { bytes: 2, sha256: 'a'.repeat(64) },
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('Runtime diagnostic worker is not valid UTF-8 JavaScript');

		expect(createObjectUrl).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
	});

	it('revokes verified Blob URLs when worker construction fails', async () => {
		mocks.loadLanguageToolAsset.mockResolvedValue({
			bytes: new TextEncoder().encode('self.onmessage = () => undefined;')
		});
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-prolog-worker');
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		class ThrowingWorker {
			constructor() {
				throw new Error('worker construction failed');
			}
		}
		vi.stubGlobal('Worker', ThrowingWorker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerUrl: 'https://assets.example.com/wasm-prolog/runner-worker.js',
				workerReceipt: { bytes: 35, sha256: 'a'.repeat(64) },
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('worker construction failed');

		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:verified-prolog-worker');
	});
});
