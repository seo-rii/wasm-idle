import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchAsset = vi.hoisted(() => vi.fn());
const resolveReceipt = vi.hoisted(() =>
	vi.fn(async (_url: string, options: { assetRoot?: string }) =>
		options.assetRoot ? { sha256: 'a'.repeat(64), bytes: 8 } : undefined
	)
);
vi.mock('../src/external-asset.js', () => ({ fetchBoundedExternalAsset: fetchAsset }));
vi.mock('../src/persistent-assets.js', () => ({
	resolveLanguageToolPersistentReceipt: resolveReceipt
}));
vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: class {
		dispose() {}
	},
	BrowserMessageWriter: class {
		dispose() {}
	}
}));
import { createPythonLanguageServer } from '../src/python/language-server.js';

class WorkerProbe {
	listeners = new Map<string, Set<(event: any) => void>>();
	messages: any[] = [];
	terminated = false;
	addEventListener(type: string, handler: (event: any) => void) {
		const handlers = this.listeners.get(type) ?? new Set();
		handlers.add(handler);
		this.listeners.set(type, handlers);
	}
	removeEventListener(type: string, handler: (event: any) => void) {
		this.listeners.get(type)?.delete(handler);
	}
	emit(data: unknown) {
		for (const handler of [...(this.listeners.get('message') ?? [])]) handler({ data });
	}
	postMessage(message: any) {
		this.messages.push(message);
		if (message.type === 'init')
			this.emit({ type: message.runtimeModuleBridge ? 'runtime-module-request' : 'ready' });
		if (message.type === 'runtime-module')
			this.emit(message.error ? { type: 'error', error: message.error } : { type: 'ready' });
	}
	terminate() {
		this.terminated = true;
	}
}
const start = (worker: WorkerProbe, signal?: AbortSignal) =>
	createPythonLanguageServer({
		rootUrl: 'https://runtime.test/root/',
		createWorker: () => worker as unknown as Worker,
		signal
	});
const bytes = () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	fetchAsset.mockReset();
	resolveReceipt.mockReset();
});

describe('Python LSP host module handoff', () => {
	it.each(['timeout', 'abort'])(
		'settles %s while the receipt import is pending without creating a late worker',
		async (stop) => {
			vi.useFakeTimers();
			let release!: (receipt: { sha256: string; bytes: number }) => void;
			resolveReceipt.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			);
			const controller = new AbortController();
			const createWorker = vi.fn(() => new WorkerProbe() as unknown as Worker);
			const started = createPythonLanguageServer({
				rootUrl: 'https://runtime.test/root/',
				createWorker,
				signal: controller.signal,
				startupTimeoutMs: 20
			});
			const failed = expect(started).rejects.toThrow(
				stop === 'timeout' ? 'timed out' : 'cancel receipt import'
			);
			await vi.advanceTimersByTimeAsync(0);
			if (stop === 'timeout') await vi.advanceTimersByTimeAsync(20);
			else controller.abort(new Error('cancel receipt import'));
			await failed;
			release({ sha256: 'a'.repeat(64), bytes: 8 });
			await vi.advanceTimersByTimeAsync(0);
			expect(createWorker).not.toHaveBeenCalled();
		}
	);

	it('hands the same immutable module to recreated workers', async () => {
		fetchAsset.mockImplementation(async () => bytes());
		const first = new WorkerProbe(),
			second = new WorkerProbe();
		const a = await start(first),
			b = await start(second);
		const module = first.messages.find((message) => message.type === 'runtime-module').module;
		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(second.messages.find((message) => message.type === 'runtime-module').module).toBe(
			module
		);
		expect(fetchAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				integrity: expect.objectContaining({ sha256: 'a'.repeat(64) }),
				maxBytes: 8,
				signal: expect.any(AbortSignal)
			})
		);
		a.dispose();
		b.dispose();
	});

	it('retries a failed fetch in a new worker', async () => {
		fetchAsset.mockRejectedValueOnce(new Error('asset failure')).mockResolvedValueOnce(bytes());
		const first = new WorkerProbe();
		await expect(start(first)).rejects.toThrow('asset failure');
		expect(first.terminated).toBe(true);
		const next = await start(new WorkerProbe());
		next.dispose();
	});

	it('aborting one startup does not cancel another or post to the terminated worker', async () => {
		let release!: (value: Uint8Array) => void;
		fetchAsset
			.mockImplementationOnce(
				() =>
					new Promise<Uint8Array>((resolve) => {
						release = resolve;
					})
			)
			.mockResolvedValueOnce(bytes());
		const controller = new AbortController(),
			first = new WorkerProbe(),
			second = new WorkerProbe();
		const stopped = start(first, controller.signal);
		await vi.waitFor(() => expect(fetchAsset).toHaveBeenCalledTimes(1));
		controller.abort(new Error('cancel first'));
		await expect(stopped).rejects.toThrow('cancel first');
		const active = await start(second);
		release(bytes());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(first.terminated).toBe(true);
		expect(first.messages.filter((message) => message.type === 'runtime-module')).toEqual([]);
		expect(
			second.messages.find((message) => message.type === 'runtime-module').module
		).toBeInstanceOf(WebAssembly.Module);
		active.dispose();
	});
});
