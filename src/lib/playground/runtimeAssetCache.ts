/** Immutable bootstrap assets only: never store a worker, Wasm instance, or user filesystem. */
export class RuntimeAssetCache {
	private entries = new Map<string, { value: unknown; bytes: number }>();
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

	stats() {
		return {
			hits: this.hits,
			misses: this.misses,
			entries: this.entries.size,
			bytes: this.bytes,
			disposed: this.disposed
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.entries.clear();
		this.identities = new WeakMap();
		this.bytes = 0;
	}
}
