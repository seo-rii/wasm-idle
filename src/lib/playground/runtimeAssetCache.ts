type SharedAssetOperation = {
	controller: AbortController;
	promise: Promise<unknown>;
	consumers: Set<(progress: unknown) => void>;
	progress: Map<string, unknown>;
	settled: boolean;
	keyBytes: number;
};

const abortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');

/** Immutable bootstrap assets only: never store a worker, Wasm instance, or user filesystem. */
export class RuntimeAssetCache {
	private entries = new Map<string, { value: unknown; bytes: number }>();
	private inFlight = new Map<string, SharedAssetOperation>();
	private inFlightKeyBytes = 0;
	private identities = new WeakMap<object, number>();
	private nextIdentity = 0;
	private bytes = 0;
	private hits = 0;
	private misses = 0;
	private disposed = false;

	constructor(
		private readonly maxBytes = 256 * 1024 * 1024,
		private readonly maxEntries = 64
	) {
		if (
			!Number.isSafeInteger(maxBytes) ||
			maxBytes < 0 ||
			!Number.isSafeInteger(maxEntries) ||
			maxEntries < 0
		) {
			throw new TypeError('Runtime cache limits must be non-negative safe integers');
		}
	}

	/** Identity is owner-local; a custom loader must never alias another loader. */
	identity(value: object | undefined): number {
		if (!value) return 0;
		let identity = this.identities.get(value);
		if (identity === undefined) {
			identity = ++this.nextIdentity;
			this.identities.set(value, identity);
		}
		return identity;
	}

	get<T>(key: string): T | undefined {
		if (this.disposed) return undefined;
		const entry = this.entries.get(key);
		if (!entry) {
			this.misses++;
			return undefined;
		}
		this.hits++;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value as T;
	}

	/** Only the trusted host publishes fully verified results; failures are never retained. */
	set<T>(key: string, value: T, bytes: number): void {
		if (this.disposed) return;
		if (!Number.isSafeInteger(bytes) || bytes < 0)
			throw new TypeError('Invalid cache byte count');
		const charge = bytes + key.length * 2;
		if (this.maxEntries === 0 || charge > this.maxBytes) return;
		const previous = this.entries.get(key);
		if (previous) this.bytes -= previous.bytes;
		this.entries.delete(key);
		this.entries.set(key, { value, bytes: charge });
		this.bytes += charge;
		while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
			const oldest = this.entries.keys().next().value!;
			this.bytes -= this.entries.get(oldest)!.bytes;
			this.entries.delete(oldest);
		}
	}

	/** Share work, but give every consumer its own cancellation and progress subscription. */
	share<T, Progress = never>(
		key: string,
		signal: AbortSignal,
		start: (
			signal: AbortSignal,
			report: (progress: Progress, progressKey?: string) => void
		) => Promise<T>,
		onProgress?: (progress: Progress) => void
	): Promise<T> {
		if (signal.aborted) return Promise.reject(abortReason(signal));
		let operation = this.inFlight.get(key);
		if (!operation) {
			// A disabled or saturated owner cache still loads assets without retaining operations.
			if (
				this.disposed ||
				this.inFlight.size >= this.maxEntries ||
				this.inFlightKeyBytes + key.length * 2 > this.maxBytes
			) {
				return Promise.resolve().then(() => {
					if (signal.aborted) throw abortReason(signal);
					return start(signal, (progress) => onProgress?.(progress));
				});
			}
			const pending: SharedAssetOperation = {
				controller: new AbortController(),
				promise: undefined as unknown as Promise<unknown>,
				consumers: new Set(),
				progress: new Map(),
				settled: false,
				keyBytes: key.length * 2
			};
			this.inFlight.set(key, pending);
			this.inFlightKeyBytes += pending.keyBytes;
			pending.promise = Promise.resolve().then(() => {
				if (pending.controller.signal.aborted) throw abortReason(pending.controller.signal);
				return start(pending.controller.signal, (progress, progressKey = '') => {
					pending.progress.set(progressKey, progress);
					for (const consumer of pending.consumers) {
						try {
							consumer(progress);
						} catch {
							// One progress listener cannot interrupt another consumer's load.
						}
					}
				});
			});
			const cleanup = () => {
				pending.settled = true;
				pending.progress.clear();
				this.removeOperation(key, pending);
			};
			void pending.promise.then(cleanup, cleanup);
			operation = pending;
		}
		const shared = operation;
		return new Promise<T>((resolve, reject) => {
			let active = true;
			const receiveProgress = (progress: unknown) => {
				if (active) onProgress?.(progress as Progress);
			};
			const release = () => {
				active = false;
				signal.removeEventListener('abort', onAbort);
				shared.consumers.delete(receiveProgress);
				if (!shared.settled && shared.consumers.size === 0) {
					this.removeOperation(key, shared);
					shared.controller.abort(abortReason(signal));
				}
			};
			const onAbort = () => {
				if (!active) return;
				release();
				reject(abortReason(signal));
			};
			shared.consumers.add(receiveProgress);
			signal.addEventListener('abort', onAbort, { once: true });
			void shared.promise.then(
				(value) => {
					if (!active) return;
					release();
					resolve(value as T);
				},
				(error) => {
					if (!active) return;
					release();
					reject(error);
				}
			);
			for (const progress of shared.progress.values()) {
				try {
					receiveProgress(progress);
				} catch {
					// Progress is advisory, including replay to a late subscriber.
				}
			}
			if (signal.aborted) onAbort();
		});
	}

	private removeOperation(key: string, operation: SharedAssetOperation) {
		if (this.inFlight.get(key) !== operation) return;
		this.inFlight.delete(key);
		this.inFlightKeyBytes -= operation.keyBytes;
	}

	stats() {
		return {
			hits: this.hits,
			misses: this.misses,
			entries: this.entries.size,
			bytes: this.bytes,
			inFlight: this.inFlight.size,
			disposed: this.disposed
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.entries.clear();
		// Existing consumers may finish, but a disposed owner never retains their results.
		this.inFlight.clear();
		this.inFlightKeyBytes = 0;
		this.identities = new WeakMap();
		this.bytes = 0;
	}
}
