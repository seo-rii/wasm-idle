import { describe, expect, it, vi } from 'vitest';
import { WorkerSession } from './workerSession';

class MockWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	terminate = vi.fn();
}

class ThrowingHandlerCleanupWorker {
	private messageHandler: ((event: MessageEvent) => void) | null = null;
	private errorHandler: ((event: ErrorEvent) => void) | null = null;
	private messageErrorHandler: ((event: MessageEvent) => void) | null = null;
	terminate = vi.fn();

	constructor(private readonly cleanupError: Error) {}

	get onmessage() {
		return this.messageHandler;
	}

	set onmessage(handler: ((event: MessageEvent) => void) | null) {
		if (handler === null) throw this.cleanupError;
		this.messageHandler = handler;
	}

	get onerror() {
		return this.errorHandler;
	}

	set onerror(handler: ((event: ErrorEvent) => void) | null) {
		if (handler === null) throw this.cleanupError;
		this.errorHandler = handler;
	}

	get onmessageerror() {
		return this.messageErrorHandler;
	}

	set onmessageerror(handler: ((event: MessageEvent) => void) | null) {
		if (handler === null) throw this.cleanupError;
		this.messageErrorHandler = handler;
	}
}

async function expectStaleWorkerHandlerIgnored(
	selectHandler: (worker: MockWorker) => ((event: never) => void) | null,
	event: ErrorEvent | MessageEvent
) {
	const oldWorker = new MockWorker();
	const nextWorker = new MockWorker();
	const session = new WorkerSession({ label: 'TinyGo' });
	await session.waitForLoad(oldWorker as unknown as Worker, (resolve) => resolve());
	const staleHandler = selectHandler(oldWorker);
	await session.waitForLoad(nextWorker as unknown as Worker, (resolve) => resolve());
	const rejectRun = vi.fn();
	const operation = session.beginRun(nextWorker as unknown as Worker, rejectRun);

	staleHandler?.(event as never);

	expect(rejectRun).not.toHaveBeenCalled();
	expect(nextWorker.terminate).not.toHaveBeenCalled();
	expect(session.complete(operation)).toBe(true);
}

describe('WorkerSession', () => {
	it('rejects and disposes a worker that fails while loading', async () => {
		const worker = new MockWorker();
		const onDispose = vi.fn();
		const session = new WorkerSession({ label: 'Lua', onDispose });
		const load = session.waitForLoad(worker as unknown as Worker, () => {});

		worker.onerror?.({
			message: 'syntax error',
			filename: '/lua-worker.js',
			lineno: 7,
			colno: 3
		} as ErrorEvent);

		await expect(load).rejects.toBe(
			'Lua worker script error: syntax error (/lua-worker.js:7:3)'
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onDispose).toHaveBeenCalledWith(worker);
	});

	it('rejects when asynchronous worker initialization throws', async () => {
		const session = new WorkerSession({ label: 'Go' });

		const load = session.load(async () => {
			await Promise.resolve();
			throw new Error('worker import failed');
		});

		await expect(load).rejects.toThrow('worker import failed');
	});

	it('routes script errors to the active run after load has settled', async () => {
		const worker = new MockWorker();
		const session = new WorkerSession({ label: 'TypeScript' });
		await session.waitForLoad(worker as unknown as Worker, (resolve) => resolve());
		let rejectRun: ((reason?: unknown) => void) | undefined;
		const run = new Promise<void>((_resolve, reject) => {
			rejectRun = reject;
		});
		session.beginRun(worker as unknown as Worker, rejectRun!);

		worker.onerror?.({ message: 'crashed' } as ErrorEvent);

		await expect(run).rejects.toBe('TypeScript worker script error: crashed');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('rejects an active run when worker messages cannot be deserialized', async () => {
		const worker = new MockWorker();
		const session = new WorkerSession({ label: () => 'JavaScript' });
		let rejectRun: ((reason?: unknown) => void) | undefined;
		const run = new Promise<void>((_resolve, reject) => {
			rejectRun = reject;
		});
		session.beginRun(worker as unknown as Worker, rejectRun!);

		worker.onmessageerror?.({} as MessageEvent);

		await expect(run).rejects.toBe('JavaScript worker message deserialization failed');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('ignores a stale script error after attaching a replacement worker', async () => {
		await expectStaleWorkerHandlerIgnored((worker) => worker.onerror, {
			message: 'old worker crashed'
		} as ErrorEvent);
	});

	it('ignores a stale message error after attaching a replacement worker', async () => {
		await expectStaleWorkerHandlerIgnored(
			(worker) => worker.onmessageerror,
			{} as MessageEvent
		);
	});

	it('rejects the active operation and clears handlers when terminated', async () => {
		const worker = new MockWorker();
		const session = new WorkerSession({ label: 'Ruby' });
		const load = session.waitForLoad(worker as unknown as Worker, () => {});

		session.terminate();

		await expect(load).rejects.toBe('Process terminated');
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('preserves the termination reason when worker cleanup throws', async () => {
		const worker = new MockWorker();
		worker.terminate.mockImplementation(() => {
			throw new Error('worker termination failed');
		});
		const onDispose = vi.fn(() => {
			throw new Error('worker disposal callback failed');
		});
		const session = new WorkerSession({ label: 'Ruby', onDispose });
		const load = session.waitForLoad(worker as unknown as Worker, () => {});
		const reason = new Error('cancel worker startup');

		expect(() => session.terminate(reason)).not.toThrow();

		await expect(load).rejects.toBe(reason);
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onDispose).toHaveBeenCalledWith(worker);
	});

	it('settles the operation when every handler cleanup setter throws', async () => {
		const cleanupError = new Error('worker handler cleanup failed');
		const worker = new ThrowingHandlerCleanupWorker(cleanupError);
		const onDispose = vi.fn();
		const session = new WorkerSession({ label: 'AssemblyScript', onDispose });
		const reason = new Error('AssemblyScript callback failed');
		const load = session.waitForLoad(worker as unknown as Worker, (_resolve, reject) => {
			reject(reason);
		});

		const outcome = await Promise.race([
			load.catch((error) => error),
			new Promise((resolve) => setTimeout(() => resolve('still pending'), 25))
		]);

		expect(outcome).toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onDispose).toHaveBeenCalledWith(worker);
	});

	it('releases a compiler worker without ending the active debug operation', () => {
		const worker = new MockWorker();
		const onDispose = vi.fn();
		const reject = vi.fn();
		const session = new WorkerSession({ label: 'Clang', onDispose });
		const operation = session.beginRun(worker as unknown as Worker, reject);

		expect(session.release(worker as unknown as Worker)).toBe(true);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onDispose).not.toHaveBeenCalled();
		expect(reject).not.toHaveBeenCalled();
		expect(session.complete(operation)).toBe(true);
	});
});
