export const STATIC_STDIN_RING_PROTOCOL = 'wasm-idle-static-stdin-ring' as const;
export const STATIC_STDIN_RING_PROTOCOL_VERSION = 1 as const;
export const STATIC_STDIN_RING_CONTROL_SLOTS = 4 as const;
export const STATIC_STDIN_RING_CONTROL_BYTES =
	STATIC_STDIN_RING_CONTROL_SLOTS * Int32Array.BYTES_PER_ELEMENT;

export const STATIC_STDIN_RING_WRITE_INDEX = 0 as const;
export const STATIC_STDIN_RING_READ_INDEX = 1 as const;
export const STATIC_STDIN_RING_CLOSED_INDEX = 2 as const;
export const STATIC_STDIN_RING_CANCELLED_INDEX = 3 as const;

export interface StaticStdinRingDescriptor {
	readonly protocol: typeof STATIC_STDIN_RING_PROTOCOL;
	readonly protocolVersion: typeof STATIC_STDIN_RING_PROTOCOL_VERSION;
	readonly buffer: SharedArrayBuffer;
	readonly capacity: number;
	readonly controlBytes: typeof STATIC_STDIN_RING_CONTROL_BYTES;
}

export interface StaticStdinRingHostOptions {
	readonly capacity?: number;
	readonly maxBufferedBytes?: number;
}

export class StaticStdinRingOverflowError extends RangeError {
	readonly actual: number;
	readonly limit: number;

	constructor(actual: number, limit: number) {
		super(`Static stdin buffered bytes exceed ${limit}`);
		this.name = 'StaticStdinRingOverflowError';
		this.actual = actual;
		this.limit = limit;
	}
}

const DEFAULT_CAPACITY = 64 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 128 * 1024;
const inputEncoder = new TextEncoder();

export class StaticStdinRingHost {
	readonly descriptor: StaticStdinRingDescriptor;
	readonly maxBufferedBytes: number;

	private readonly control: Int32Array;
	private readonly data: Uint8Array;
	private readonly pending: Uint8Array[] = [];
	private pendingBytes = 0;
	private pendingOffset = 0;
	private closeRequested = false;
	private cancelled = false;

	constructor(options: StaticStdinRingHostOptions = {}) {
		const capacity = options.capacity ?? DEFAULT_CAPACITY;
		const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
		for (const [value, name] of [
			[capacity, 'Static stdin ring capacity'],
			[maxBufferedBytes, 'Static stdin maximum buffered bytes']
		] as const) {
			if (!Number.isSafeInteger(value) || value <= 0) {
				throw new TypeError(`${name} must be a positive safe integer`);
			}
		}
		if (maxBufferedBytes < capacity) {
			throw new TypeError('Static stdin maximum buffered bytes must cover the ring capacity');
		}
		if (typeof SharedArrayBuffer !== 'function') {
			throw new TypeError('SharedArrayBuffer is required for streaming static stdin');
		}

		const buffer = new SharedArrayBuffer(STATIC_STDIN_RING_CONTROL_BYTES + capacity);
		this.control = new Int32Array(buffer, 0, STATIC_STDIN_RING_CONTROL_SLOTS);
		this.data = new Uint8Array(buffer, STATIC_STDIN_RING_CONTROL_BYTES, capacity);
		this.maxBufferedBytes = maxBufferedBytes;
		this.descriptor = Object.freeze({
			protocol: STATIC_STDIN_RING_PROTOCOL,
			protocolVersion: STATIC_STDIN_RING_PROTOCOL_VERSION,
			buffer,
			capacity,
			controlBytes: STATIC_STDIN_RING_CONTROL_BYTES
		});
	}

	get bufferedBytes() {
		return this.ringBytes() + this.pendingBytes;
	}

	get isClosed() {
		return Atomics.load(this.control, STATIC_STDIN_RING_CLOSED_INDEX) === 1;
	}

	get isCancelled() {
		return this.cancelled;
	}

	enqueue(input: string) {
		if (this.cancelled) throw new Error('Static stdin ring is cancelled');
		if (this.closeRequested) throw new Error('Static stdin ring is closed');
		const bytes = inputEncoder.encode(input);
		if (bytes.byteLength === 0) return 0;

		this.flush();
		const actual = this.bufferedBytes + bytes.byteLength;
		if (actual > this.maxBufferedBytes) {
			throw new StaticStdinRingOverflowError(actual, this.maxBufferedBytes);
		}
		this.pending.push(bytes);
		this.pendingBytes += bytes.byteLength;
		this.flush();
		return bytes.byteLength;
	}

	close() {
		if (this.cancelled || this.closeRequested) return;
		this.closeRequested = true;
		this.flush();
	}

	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		this.closeRequested = true;
		this.pending.length = 0;
		this.pendingBytes = 0;
		this.pendingOffset = 0;
		Atomics.store(this.control, STATIC_STDIN_RING_CANCELLED_INDEX, 1);
		Atomics.store(this.control, STATIC_STDIN_RING_CLOSED_INDEX, 1);
		Atomics.notify(this.control, STATIC_STDIN_RING_WRITE_INDEX);
	}

	consumerRequestedInput() {
		this.flush();
	}

	private ringBytes() {
		const write = Atomics.load(this.control, STATIC_STDIN_RING_WRITE_INDEX);
		const read = Atomics.load(this.control, STATIC_STDIN_RING_READ_INDEX);
		const used = write - read;
		if (used < 0 || used > this.data.byteLength) {
			throw new Error('Static stdin ring counters are invalid');
		}
		return used;
	}

	private flush() {
		if (this.cancelled) return;
		let write = Atomics.load(this.control, STATIC_STDIN_RING_WRITE_INDEX);
		const read = Atomics.load(this.control, STATIC_STDIN_RING_READ_INDEX);
		const used = write - read;
		if (used < 0 || used > this.data.byteLength) {
			throw new Error('Static stdin ring counters are invalid');
		}

		let available = this.data.byteLength - used;
		let published = false;
		while (available > 0 && this.pending.length > 0) {
			const chunk = this.pending[0];
			const remaining = chunk.byteLength - this.pendingOffset;
			const count = Math.min(available, remaining);
			const start = write % this.data.byteLength;
			const first = Math.min(count, this.data.byteLength - start);
			this.data.set(chunk.subarray(this.pendingOffset, this.pendingOffset + first), start);
			if (first < count) {
				this.data.set(
					chunk.subarray(this.pendingOffset + first, this.pendingOffset + count),
					0
				);
			}

			write += count;
			available -= count;
			this.pendingOffset += count;
			this.pendingBytes -= count;
			published = true;
			if (this.pendingOffset === chunk.byteLength) {
				this.pending.shift();
				this.pendingOffset = 0;
			}
		}

		if (published) Atomics.store(this.control, STATIC_STDIN_RING_WRITE_INDEX, write);
		if (this.closeRequested && this.pendingBytes === 0) {
			Atomics.store(this.control, STATIC_STDIN_RING_CLOSED_INDEX, 1);
		}
		if (published || this.closeRequested) {
			Atomics.notify(this.control, STATIC_STDIN_RING_WRITE_INDEX);
		}
	}
}
