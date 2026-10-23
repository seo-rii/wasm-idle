/**
 * Immutable runtime code only; never retains instances, memories, imports or workers.
 * The byte budget counts input Wasm bytes, not engine compiled-code RSS.
 */
export class CompiledDebugModuleCache {
	private readonly entries = new Map<
		string,
		{ bytes: number; promise: Promise<WebAssembly.Module> }
	>();
	private sourceBytes = 0;

	constructor(
		private readonly maxEntries = 2,
		private readonly maxSourceBytes = 55_000_000
	) {
		if (
			!Number.isSafeInteger(maxEntries) ||
			maxEntries < 1 ||
			!Number.isSafeInteger(maxSourceBytes) ||
			maxSourceBytes < 1
		) {
			throw new RangeError('Compiled module cache budgets must be positive safe integers');
		}
	}

	/** Call only after every runtime asset has passed preflight integrity verification. */
	compile(sha256: string, bytes: ArrayBuffer): Promise<WebAssembly.Module> {
		if (!/^[a-f0-9]{64}$/u.test(sha256) || bytes.byteLength === 0) {
			throw new Error('Compiled debug modules require a verified digest and non-empty bytes');
		}
		const key = `${sha256}:${bytes.byteLength}`;
		const cached = this.entries.get(key);
		if (cached) {
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.promise;
		}
		if (bytes.byteLength > this.maxSourceBytes) return WebAssembly.compile(bytes);
		while (
			this.entries.size >= this.maxEntries ||
			this.sourceBytes + bytes.byteLength > this.maxSourceBytes
		) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.sourceBytes -= this.entries.get(oldest)!.bytes;
			this.entries.delete(oldest);
		}
		const entry = {
			bytes: bytes.byteLength,
			promise: WebAssembly.compile(bytes).catch((error) => {
				if (this.entries.get(key) === entry) {
					this.entries.delete(key);
					this.sourceBytes -= entry.bytes;
				}
				throw error;
			})
		};
		this.entries.set(key, entry);
		this.sourceBytes += entry.bytes;
		return entry.promise;
	}
}
