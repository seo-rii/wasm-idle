import {
	BusyError,
	RuntimeWorkerLifetimeController,
	type RuntimeWorkerLifetimePolicy
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface TestWorker {
	readonly id: number;
	disposed: boolean;
}

const createController = (policy: RuntimeWorkerLifetimePolicy) => {
	let nextId = 0;
	return new RuntimeWorkerLifetimeController<TestWorker>({
		policy,
		runtimeId: 'test-runtime',
		createWorker: () => ({ id: ++nextId, disposed: false }),
		disposeWorker: (worker) => {
			worker.disposed = true;
		}
	});
};

afterEach(() => {
	vi.useRealTimers();
});

describe('runtime worker lifetime controller', () => {
	it('disposes per-run workers when their lease is released', async () => {
		const controller = createController({ mode: 'per-run' });
		const first = await controller.acquire();
		const second = await controller.acquire();

		expect(first.worker).not.toBe(second.worker);
		expect(controller.activeWorkers).toBe(2);
		first.release();
		first.release();
		expect(first.worker.disposed).toBe(true);
		expect(controller.totalWorkers).toBe(1);
		second.release();
	});

	it('reuses a persistent worker until its idle timeout expires', async () => {
		vi.useFakeTimers();
		const controller = createController({
			mode: 'persistent',
			idleTimeoutMs: 1_000,
			evictOnMemoryPressure: true
		});
		const first = await controller.acquire();
		first.release();
		const second = await controller.acquire();

		expect(second.worker).toBe(first.worker);
		expect(first.worker.disposed).toBe(false);
		second.release();
		vi.advanceTimersByTime(999);
		expect(first.worker.disposed).toBe(false);
		vi.advanceTimersByTime(1);
		expect(first.worker.disposed).toBe(true);
		expect(controller.totalWorkers).toBe(0);
	});

	it('passes acquisition context only when a new worker must be created', async () => {
		const createdWith: Array<{ requestId: string }> = [];
		let nextId = 0;
		const controller = new RuntimeWorkerLifetimeController<TestWorker, { requestId: string }>({
			policy: {
				mode: 'persistent',
				idleTimeoutMs: 1_000,
				evictOnMemoryPressure: true
			},
			createWorker: (context) => {
				createdWith.push(context);
				return { id: ++nextId, disposed: false };
			},
			disposeWorker: (worker) => {
				worker.disposed = true;
			}
		});
		const firstContext = { requestId: 'first' };
		const reusedContext = { requestId: 'reuse' };
		const replacementContext = { requestId: 'replacement' };

		const first = await controller.acquire(firstContext);
		first.release();
		const reused = await controller.acquire(reusedContext);
		expect(reused.worker).toBe(first.worker);
		expect(createdWith).toEqual([firstContext]);
		reused.release({ reusable: false });

		const replacement = await controller.acquire(replacementContext);
		expect(replacement.worker).not.toBe(first.worker);
		expect(createdWith).toEqual([firstContext, replacementContext]);
		replacement.release({ reusable: false });
	});

	it('rejects overlapping persistent leases and exhausted pools', async () => {
		const persistent = createController({
			mode: 'persistent',
			idleTimeoutMs: 1_000,
			evictOnMemoryPressure: true
		});
		const persistentLease = await persistent.acquire();
		await expect(persistent.acquire()).rejects.toBeInstanceOf(BusyError);
		persistentLease.release();

		const pool = createController({
			mode: 'pool',
			idleTimeoutMs: 1_000,
			maxWorkers: 2,
			evictOnMemoryPressure: true
		});
		const first = await pool.acquire();
		const second = await pool.acquire();
		await expect(pool.acquire()).rejects.toBeInstanceOf(BusyError);
		first.release();
		const reused = await pool.acquire();
		expect(reused.worker).toBe(first.worker);
		reused.release({ reusable: false });
		expect(first.worker.disposed).toBe(true);
		second.release();
		pool.dispose();
	});

	it('evicts only idle workers under the declared memory-pressure policy', async () => {
		const retained = createController({
			mode: 'persistent',
			idleTimeoutMs: 1_000,
			evictOnMemoryPressure: false
		});
		const retainedLease = await retained.acquire();
		retainedLease.release();
		expect(retained.handleMemoryPressure()).toBe(0);
		expect(retained.idleWorkers).toBe(1);
		expect(retained.evictIdle()).toBe(1);

		const evicted = createController({
			mode: 'persistent',
			idleTimeoutMs: 1_000,
			evictOnMemoryPressure: true
		});
		const evictedLease = await evicted.acquire();
		evictedLease.release();
		expect(evicted.handleMemoryPressure()).toBe(1);
		expect(evictedLease.worker.disposed).toBe(true);
	});

	it('retires an exact managed worker once', async () => {
		const controller = createController({
			mode: 'persistent',
			idleTimeoutMs: 1_000,
			evictOnMemoryPressure: true
		});
		const lease = await controller.acquire();
		lease.release();

		expect(controller.retireWorker(lease.worker)).toBe(true);
		expect(controller.retireWorker(lease.worker)).toBe(false);
		expect(lease.worker.disposed).toBe(true);
		expect(controller.totalWorkers).toBe(0);
	});

	it('disposes workers that finish creating after controller disposal', async () => {
		let finishCreation!: (worker: TestWorker) => void;
		const creating = new Promise<TestWorker>((resolve) => {
			finishCreation = resolve;
		});
		const controller = new RuntimeWorkerLifetimeController<TestWorker>({
			policy: { mode: 'per-run' },
			createWorker: () => creating,
			disposeWorker: (worker) => {
				worker.disposed = true;
			}
		});
		const acquisition = controller.acquire();
		controller.dispose();
		const worker = { id: 1, disposed: false };
		finishCreation(worker);

		await expect(acquisition).rejects.toThrow('controller is disposed');
		expect(worker.disposed).toBe(true);
		await expect(controller.acquire()).rejects.toThrow('controller is disposed');
	});
});
