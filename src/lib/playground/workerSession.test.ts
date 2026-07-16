import { describe, expect, it, vi } from 'vitest';
import { WorkerSession } from './workerSession';

class MockWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	terminate = vi.fn();
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
});
