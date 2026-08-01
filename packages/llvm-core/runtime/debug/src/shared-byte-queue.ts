import type { SharedByteQueueDescriptor } from './types.js';

const READ_OFFSET = 0;
const WRITE_OFFSET = 1;
const STATE = 2;
const EPOCH = 3;
const CAPACITY = 4;
const INTERRUPT = 5;
const GENERATION = 6;
const CONTROL_LENGTH = 7;
const MINIMUM_CAPACITY = 4 * 1024;
const MAXIMUM_CAPACITY = 16 * 1024 * 1024;
const MAXIMUM_GENERATION = 2_147_483_647;

function validateCapacity(capacity: number) {
	if (
		!Number.isSafeInteger(capacity) ||
		capacity < MINIMUM_CAPACITY ||
		capacity > MAXIMUM_CAPACITY ||
		(capacity & (capacity - 1)) !== 0
	) {
		throw new RangeError(
			'shared-ring-v1 capacity must be a power of two between 4096 and 16777216 bytes'
		);
	}
}

function validateGeneration(generation: number) {
	if (!Number.isInteger(generation) || generation < 1 || generation > MAXIMUM_GENERATION) {
		throw new RangeError(
			'shared byte queue generation must be an integer between 1 and 2147483647'
		);
	}
}

function sleep(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function createSharedByteQueue(
	capacity = 64 * 1024,
	generation = 1
): SharedByteQueueDescriptor {
	validateCapacity(capacity);
	validateGeneration(generation);
	const control = new SharedArrayBuffer(CONTROL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
	const header = new Int32Array(control);
	Atomics.store(header, CAPACITY, capacity);
	Atomics.store(header, GENERATION, generation);
	return {
		control,
		data: new SharedArrayBuffer(capacity),
		generation
	};
}

export class SharedByteQueue {
	readonly capacity: number;
	readonly generation: number;
	private readonly bytes: Uint8Array;
	private readonly header: Int32Array;

	constructor(readonly descriptor: SharedByteQueueDescriptor) {
		if (
			!(descriptor.control instanceof SharedArrayBuffer) ||
			!(descriptor.data instanceof SharedArrayBuffer)
		) {
			throw new TypeError('shared-ring-v1 requires control and data SharedArrayBuffers');
		}
		if (descriptor.control.byteLength < CONTROL_LENGTH * Int32Array.BYTES_PER_ELEMENT) {
			throw new RangeError('shared-ring-v1 control buffer is too small');
		}
		this.header = new Int32Array(descriptor.control);
		this.bytes = new Uint8Array(descriptor.data);
		this.capacity = this.bytes.byteLength;
		validateCapacity(this.capacity);
		validateGeneration(descriptor.generation);
		this.generation = descriptor.generation;
		if (Atomics.load(this.header, CAPACITY) !== this.capacity) {
			throw new Error('shared-ring-v1 capacity metadata does not match its data buffer');
		}
		this.assertGeneration();
	}

	get closed() {
		this.assertGeneration();
		return Atomics.load(this.header, STATE) !== 0;
	}

	get available() {
		this.assertGeneration();
		const read = Atomics.load(this.header, READ_OFFSET) >>> 0;
		const write = Atomics.load(this.header, WRITE_OFFSET) >>> 0;
		const available = (write - read) >>> 0;
		if (available > this.capacity) {
			throw new Error('shared-ring-v1 cursor invariant was violated');
		}
		return available;
	}

	get remaining() {
		return this.capacity - this.available;
	}

	close() {
		this.assertGeneration();
		Atomics.store(this.header, STATE, 1);
		this.notify();
	}

	interrupt() {
		this.assertGeneration();
		Atomics.add(this.header, INTERRUPT, 1);
		this.notify();
	}

	tryRead(destination: Uint8Array): number {
		this.assertGeneration();
		const available = this.available;
		const length = Math.min(destination.byteLength, available);
		if (length === 0) return 0;

		const readCursor = Atomics.load(this.header, READ_OFFSET) >>> 0;
		const readOffset = readCursor & (this.capacity - 1);
		const firstLength = Math.min(length, this.capacity - readOffset);
		destination.set(this.bytes.subarray(readOffset, readOffset + firstLength));
		if (firstLength < length) {
			destination.set(this.bytes.subarray(0, length - firstLength), firstLength);
		}

		Atomics.store(this.header, READ_OFFSET, (readCursor + length) | 0);
		this.notify();
		return length;
	}

	tryWrite(source: Uint8Array): number {
		this.assertGeneration();
		if (this.closed) throw new Error('cannot write to a closed shared byte queue');
		const remaining = this.remaining;
		const length = Math.min(source.byteLength, remaining);
		if (length === 0) return 0;

		const writeCursor = Atomics.load(this.header, WRITE_OFFSET) >>> 0;
		const writeOffset = writeCursor & (this.capacity - 1);
		const firstLength = Math.min(length, this.capacity - writeOffset);
		this.bytes.set(source.subarray(0, firstLength), writeOffset);
		if (firstLength < length) {
			this.bytes.set(source.subarray(firstLength, length), 0);
		}

		Atomics.store(this.header, WRITE_OFFSET, (writeCursor + length) | 0);
		this.notify();
		return length;
	}

	async read(destination: Uint8Array, signal?: AbortSignal): Promise<number> {
		signal?.throwIfAborted();
		if (destination.byteLength === 0) return 0;
		while (true) {
			signal?.throwIfAborted();
			const epoch = Atomics.load(this.header, EPOCH);
			const length = this.tryRead(destination);
			if (length > 0 || this.closed) return length;
			await this.waitForSignal(epoch, signal);
		}
	}

	async write(source: Uint8Array, signal?: AbortSignal): Promise<void> {
		let offset = 0;
		while (offset < source.byteLength) {
			signal?.throwIfAborted();
			const epoch = Atomics.load(this.header, EPOCH);
			offset += this.tryWrite(source.subarray(offset));
			if (offset < source.byteLength) await this.waitForSignal(epoch, signal);
		}
	}

	readBlocking(destination: Uint8Array, timeoutMs = Infinity): number {
		if (destination.byteLength === 0) return 0;
		const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Infinity;
		while (true) {
			const epoch = Atomics.load(this.header, EPOCH);
			const length = this.tryRead(destination);
			if (length > 0 || this.closed) return length;
			const remaining = deadline - Date.now();
			if (remaining <= 0) return 0;
			Atomics.wait(this.header, EPOCH, epoch, remaining);
		}
	}

	writeBlocking(source: Uint8Array, timeoutMs = Infinity): number {
		const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Infinity;
		let offset = 0;
		while (offset < source.byteLength) {
			const epoch = Atomics.load(this.header, EPOCH);
			offset += this.tryWrite(source.subarray(offset));
			if (offset === source.byteLength) break;
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			Atomics.wait(this.header, EPOCH, epoch, remaining);
		}
		return offset;
	}

	private assertGeneration() {
		if (Atomics.load(this.header, GENERATION) !== this.generation) {
			throw new Error('stale shared byte queue generation');
		}
	}

	private notify() {
		Atomics.add(this.header, EPOCH, 1);
		Atomics.notify(this.header, EPOCH);
	}

	private async waitForSignal(before: number, signal?: AbortSignal) {
		const waitAsync = (
			Atomics as typeof Atomics & {
				waitAsync?: (
					array: Int32Array,
					index: number,
					value: number,
					timeout?: number
				) => { value: Promise<'ok' | 'not-equal' | 'timed-out'> | string };
			}
		).waitAsync;
		let wait: Promise<unknown>;
		if (waitAsync) {
			const result = waitAsync(this.header, EPOCH, before, 100);
			if (typeof result.value !== 'string') {
				wait = result.value;
			} else {
				wait = Promise.resolve();
			}
		} else {
			wait = sleep(1);
		}
		if (!signal) {
			await wait;
			return;
		}
		signal.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			const aborted = () => {
				signal.removeEventListener('abort', aborted);
				reject(signal.reason);
			};
			signal.addEventListener('abort', aborted, { once: true });
			void wait.then(
				() => {
					signal.removeEventListener('abort', aborted);
					resolve();
				},
				(error) => {
					signal.removeEventListener('abort', aborted);
					reject(error);
				}
			);
		});
	}
}
