import { BusyError, RuntimeConfigurationError } from './errors.js';
import {
	defineRuntimeWorkerLifetimePolicy,
	type RuntimeWorkerLifetimePolicy
} from './runtime-manifest.js';

export interface RuntimeWorkerLease<Worker> {
	readonly worker: Worker;
	release(options?: { readonly reusable?: boolean }): void;
}

export interface RuntimeWorkerLifetimeControllerOptions<Worker> {
	readonly policy: RuntimeWorkerLifetimePolicy;
	readonly createWorker: () => Worker | Promise<Worker>;
	readonly disposeWorker: (worker: Worker) => void;
	readonly runtimeId?: string;
}

interface WorkerEntry<Worker> {
	readonly worker: Worker;
	busy: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
}

export class RuntimeWorkerLifetimeController<Worker> {
	readonly policy: RuntimeWorkerLifetimePolicy;
	private readonly entries: WorkerEntry<Worker>[] = [];
	private creating = 0;
	private disposed = false;

	constructor(private readonly options: RuntimeWorkerLifetimeControllerOptions<Worker>) {
		this.policy = defineRuntimeWorkerLifetimePolicy(
			options.policy,
			options.runtimeId ?? 'runtime'
		);
	}

	get activeWorkers() {
		return this.entries.filter((entry) => entry.busy).length + this.creating;
	}

	get idleWorkers() {
		return this.entries.filter((entry) => !entry.busy).length;
	}

	get totalWorkers() {
		return this.entries.length + this.creating;
	}

	async acquire(): Promise<RuntimeWorkerLease<Worker>> {
		this.requireActive();
		if (this.policy.mode !== 'per-run') {
			const idleEntry = this.entries.find((entry) => !entry.busy);
			if (idleEntry) {
				this.cancelIdleTimer(idleEntry);
				idleEntry.busy = true;
				return this.createLease(idleEntry);
			}
		}

		const maxWorkers =
			this.policy.mode === 'persistent'
				? 1
				: this.policy.mode === 'pool'
					? this.policy.maxWorkers
					: Number.POSITIVE_INFINITY;
		if (this.totalWorkers >= maxWorkers) {
			throw new BusyError(
				`Runtime worker capacity is exhausted for ${this.options.runtimeId ?? 'runtime'}`
			);
		}

		this.creating += 1;
		let worker: Worker;
		try {
			worker = await this.options.createWorker();
		} finally {
			this.creating -= 1;
		}
		if (this.disposed) {
			this.options.disposeWorker(worker);
			throw new RuntimeConfigurationError('Runtime worker lifetime controller is disposed', {
				phase: 'dispose',
				runtimeId: this.options.runtimeId
			});
		}
		const entry: WorkerEntry<Worker> = { worker, busy: true };
		this.entries.push(entry);
		return this.createLease(entry);
	}

	handleMemoryPressure() {
		if (this.policy.mode === 'per-run' || !this.policy.evictOnMemoryPressure) {
			return 0;
		}
		return this.evictIdle();
	}

	evictIdle() {
		const idleEntries = this.entries.filter((entry) => !entry.busy);
		for (const entry of idleEntries) this.removeAndDispose(entry);
		return idleEntries.length;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of [...this.entries]) this.removeAndDispose(entry);
	}

	private requireActive() {
		if (!this.disposed) return;
		throw new RuntimeConfigurationError('Runtime worker lifetime controller is disposed', {
			phase: 'dispose',
			runtimeId: this.options.runtimeId
		});
	}

	private createLease(entry: WorkerEntry<Worker>): RuntimeWorkerLease<Worker> {
		let released = false;
		return Object.freeze({
			worker: entry.worker,
			release: (options: { readonly reusable?: boolean } = {}) => {
				if (released) return;
				released = true;
				this.release(entry, options.reusable ?? true);
			}
		});
	}

	private release(entry: WorkerEntry<Worker>, reusable: boolean) {
		if (!this.entries.includes(entry)) return;
		entry.busy = false;
		if (!reusable || this.policy.mode === 'per-run') {
			this.removeAndDispose(entry);
			return;
		}
		entry.idleTimer = setTimeout(() => {
			entry.idleTimer = undefined;
			if (!entry.busy && this.entries.includes(entry)) this.removeAndDispose(entry);
		}, this.policy.idleTimeoutMs);
	}

	private cancelIdleTimer(entry: WorkerEntry<Worker>) {
		if (entry.idleTimer === undefined) return;
		clearTimeout(entry.idleTimer);
		entry.idleTimer = undefined;
	}

	private removeAndDispose(entry: WorkerEntry<Worker>) {
		const index = this.entries.indexOf(entry);
		if (index < 0) return;
		this.entries.splice(index, 1);
		this.cancelIdleTimer(entry);
		this.options.disposeWorker(entry.worker);
	}
}
