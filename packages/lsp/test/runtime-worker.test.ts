import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWK_RUNTIME_WORKER_PATH } from '@wasm-idle/core';

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
		const receipt = {
			bytes: workerBytes.byteLength,
			sha256: createHash('sha256').update(workerBytes).digest('hex')
		};
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
			messageArgumentCounts: number[];
			terminated: boolean;
		}> = [];
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;
			messages: unknown[] = [];
			messageArgumentCounts: number[] = [];
			terminated = false;

			constructor(readonly url: string | URL) {
				workerConstructed(url);
				workers.push(this);
			}

			postMessage(message: unknown, ...additional: unknown[]) {
				this.messages.push(message);
				this.messageArgumentCounts.push(1 + additional.length);
				this.onmessage?.({ data: { output: 'first ' } } as MessageEvent);
				this.onmessage?.({ data: { output: 'second' } } as MessageEvent);
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {
				this.terminated = true;
			}
		}
		vi.stubGlobal('Worker', FakeWorker);

		const runtimeBytes = Uint8Array.of(1, 2, 3);
		const message = { code: 'main :- true.', diagnose: true, runtimeBytes };
		const result = await runRuntimeWorkerDiagnostics({
			runtime: 'prolog',
			workerReceipt: receipt,
			workerBytes,
			message,
			timeoutMs: 1234,
			timeoutMessage: 'Prolog diagnostics timed out'
		});

		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(createObjectUrl).toHaveBeenCalledOnce();
		expect(workerBlob?.type).toBe('text/javascript');
		expect(new Uint8Array(await workerBlob?.arrayBuffer())).toEqual(workerBytes);
		expect(workerConstructed).toHaveBeenCalledWith('blob:verified-prolog-worker');
		expect(workerConstructed.mock.invocationCallOrder[0]).toBeLessThan(
			revokeObjectUrl.mock.invocationCallOrder[0]
		);
		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:verified-prolog-worker');
		expect(workers[0]).toMatchObject({
			messages: [message],
			messageArgumentCounts: [1],
			terminated: true
		});
		expect(runtimeBytes).toEqual(Uint8Array.of(1, 2, 3));
		expect(runtimeBytes.buffer.byteLength).toBe(3);
		expect(result).toEqual({ error: undefined, output: 'first second' });
	});

	it('loads a receipt-pinned Tcl worker through the Tcl allowlist', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const receipt = { bytes: workerBytes.byteLength, sha256: 'c'.repeat(64) };
		mocks.loadLanguageToolAsset.mockResolvedValue({ bytes: workerBytes });
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-tcl-worker');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;

			postMessage() {
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker);

		await expect(
			runRuntimeWorkerDiagnostics({
				runtime: 'tcl',
				workerUrl: 'https://assets.example.com/wasm-tcl/runner-worker.js?v=pinned',
				workerReceipt: receipt,
				message: {},
				timeoutMessage: 'Tcl diagnostics timed out'
			})
		).resolves.toEqual({ error: undefined, output: '' });

		expect(mocks.loadLanguageToolAsset).toHaveBeenCalledWith(
			'tcl',
			'runner-worker.js',
			expect.objectContaining({
				baseUrl: 'https://assets.example.com/wasm-tcl/',
				integrity: { 'runner-worker.js': receipt },
				requireExactResponseUrl: true
			}),
			expect.any(Function),
			{ timeoutMs: 5000 }
		);
	});

	it('uses the configured v2 AWK worker identity for loading and verification', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const receipt = { bytes: workerBytes.byteLength, sha256: 'c'.repeat(64) };
		mocks.loadLanguageToolAsset.mockResolvedValue({ bytes: workerBytes });
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-awk-worker');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;

			postMessage() {
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker);

		await expect(
			runRuntimeWorkerDiagnostics({
				runtime: 'awk',
				workerAsset: AWK_RUNTIME_WORKER_PATH,
				workerUrl: `https://assets.example.com/wasm-awk/${AWK_RUNTIME_WORKER_PATH}?v=pinned`,
				workerReceipt: receipt,
				message: {},
				timeoutMessage: 'AWK diagnostics timed out'
			})
		).resolves.toEqual({ error: undefined, output: '' });

		expect(mocks.loadLanguageToolAsset).toHaveBeenCalledWith(
			'awk',
			AWK_RUNTIME_WORKER_PATH,
			expect.objectContaining({
				baseUrl: 'https://assets.example.com/wasm-awk/',
				integrity: { [AWK_RUNTIME_WORKER_PATH]: receipt },
				requireExactResponseUrl: true
			}),
			expect.any(Function),
			{ timeoutMs: 5000 }
		);

		await expect(
			runRuntimeWorkerDiagnostics({
				runtime: 'awk',
				workerAsset: AWK_RUNTIME_WORKER_PATH,
				workerReceipt: { ...receipt, sha256: '0'.repeat(64) },
				workerBytes,
				message: {},
				timeoutMessage: 'AWK diagnostics timed out'
			})
		).rejects.toThrow(`${AWK_RUNTIME_WORKER_PATH} compressed SHA-256 mismatch`);
	});

	it('transfers explicitly owned runtime payload buffers to the nested worker', async () => {
		const posted = vi.fn();
		class FakeWorker {
			onerror: ((event: ErrorEvent) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;

			postMessage(message: unknown, transfer?: Transferable[]) {
				posted(message, transfer);
				this.onmessage?.({ data: { results: true } } as MessageEvent);
			}

			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker);
		const goShimBytes = Uint8Array.of(1, 2);
		const wasmBytes = Uint8Array.of(3, 4);
		const message = {
			runtimePreflight: { goShimBytes, wasmBytes },
			code: 'BEGIN { print 1 }'
		};

		await expect(
			runRuntimeWorkerDiagnostics({
				workerUrl: 'https://assets.example.com/verified-awk-runner.js',
				message,
				messageTransfer: [goShimBytes.buffer, wasmBytes.buffer],
				timeoutMessage: 'AWK diagnostics timed out'
			})
		).resolves.toEqual({ error: undefined, output: '' });

		expect(posted).toHaveBeenCalledWith(message, [goShimBytes.buffer, wasmBytes.buffer]);
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

	it('requires a receipt for direct bytes and a URL for the receipt-only fallback', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const receipt = {
			bytes: workerBytes.byteLength,
			sha256: createHash('sha256').update(workerBytes).digest('hex')
		};
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerBytes,
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('worker bytes require an integrity receipt');
		await expect(
			runRuntimeWorkerDiagnostics({
				workerReceipt: receipt,
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('worker URL is required');

		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
	});

	it('rejects non-UTF-8 worker bytes before creating executable content', async () => {
		const workerBytes = Uint8Array.of(0xc3, 0x28);
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerReceipt: {
					bytes: workerBytes.byteLength,
					sha256: createHash('sha256').update(workerBytes).digest('hex')
				},
				workerBytes,
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('Runtime diagnostic worker is not valid UTF-8 JavaScript');

		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(createObjectUrl).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
	});

	it('revokes verified Blob URLs when worker construction fails', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
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
				workerReceipt: {
					bytes: workerBytes.byteLength,
					sha256: createHash('sha256').update(workerBytes).digest('hex')
				},
				workerBytes,
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('worker construction failed');

		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:verified-prolog-worker');
		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
	});

	it('rejects direct worker byte integrity mismatches without fetching or creating a Blob', async () => {
		const workerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);

		await expect(
			runRuntimeWorkerDiagnostics({
				workerReceipt: { bytes: workerBytes.byteLength, sha256: '0'.repeat(64) },
				workerBytes,
				message: {},
				timeoutMessage: 'Prolog diagnostics timed out'
			})
		).rejects.toThrow('runner-worker.js compressed SHA-256 mismatch');

		expect(mocks.loadLanguageToolAsset).not.toHaveBeenCalled();
		expect(createObjectUrl).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
	});
});
