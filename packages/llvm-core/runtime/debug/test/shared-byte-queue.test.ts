import { describe, expect, it, vi } from 'vitest';

import { SharedByteQueue, createSharedByteQueue } from '../src/shared-byte-queue.js';

describe('SharedByteQueue', () => {
	it('restricts queue generations to positive signed 32-bit metadata', () => {
		const maximum = createSharedByteQueue(4096, 2_147_483_647);

		expect(new SharedByteQueue(maximum).generation).toBe(2_147_483_647);
		expect(() => createSharedByteQueue(4096, 2_147_483_648)).toThrow(
			/between 1 and 2147483647/u
		);
	});

	it('validates descriptor generations before comparing shared metadata', () => {
		const descriptor = createSharedByteQueue(4096, 13);

		expect(() => new SharedByteQueue({ ...descriptor, generation: 1.5 })).toThrow(
			/between 1 and 2147483647/u
		);
	});

	it('rejects descriptors that alias control and data storage', () => {
		const shared = new SharedArrayBuffer(4096);
		const header = new Int32Array(shared);
		Atomics.store(header, 4, 4096);
		Atomics.store(header, 6, 17);

		expect(
			() => new SharedByteQueue({ control: shared, data: shared, generation: 17 })
		).toThrow(/distinct control and data SharedArrayBuffers/u);
	});

	it('rejects a stale generation when reading closed state', () => {
		const descriptor = createSharedByteQueue(4096, 14);
		const queue = new SharedByteQueue(descriptor);
		const header = new Int32Array(descriptor.control);

		Atomics.store(header, 6, 15);

		expect(() => queue.closed).toThrow(/stale shared byte queue generation/u);
	});

	it('preserves bytes across partial writes and wrap-around reads', () => {
		const descriptor = createSharedByteQueue(4096, 7);
		const queue = new SharedByteQueue(descriptor);
		const prefix = new Uint8Array(4094).map((_, index) => index % 251);
		expect(queue.tryWrite(prefix)).toBe(prefix.length);

		const first = new Uint8Array(4092);
		expect(queue.tryRead(first)).toBe(first.length);
		expect(first).toEqual(prefix.subarray(0, 4092));
		expect(queue.tryWrite(Uint8Array.of(1, 2, 3, 4))).toBe(4);

		const second = new Uint8Array(6);
		expect(queue.tryRead(second)).toBe(6);
		expect(Array.from(second)).toEqual([prefix[4092], prefix[4093], 1, 2, 3, 4]);
	});

	it('applies backpressure and resumes an asynchronous writer after a read', async () => {
		const queue = new SharedByteQueue(createSharedByteQueue(4096, 8));
		const bytes = new Uint8Array(4098).map((_, index) => index % 251);
		const write = queue.write(bytes);
		await Promise.resolve();
		expect(queue.available).toBe(4096);

		const first = new Uint8Array(2);
		expect(await queue.read(first)).toBe(2);
		await write;
		expect(Array.from(first)).toEqual([0, 1]);

		const rest = new Uint8Array(4096);
		expect(queue.tryRead(rest)).toBe(4096);
		expect(rest).toEqual(bytes.subarray(2));
	});

	it('returns immediately from a zero-length asynchronous read', async () => {
		const queue = new SharedByteQueue(createSharedByteQueue(4096, 11));
		const controller = new AbortController();
		const read = queue.read(new Uint8Array(), controller.signal);

		controller.abort(new Error('zero-length read waited for a queue signal'));

		await expect(read).resolves.toBe(0);
	});

	it('does not wait for a zero-length blocking read', () => {
		const queue = new SharedByteQueue(createSharedByteQueue(4096, 12));
		const wait = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');

		expect(queue.readBlocking(new Uint8Array(), 1)).toBe(0);
		expect(wait).not.toHaveBeenCalled();
	});

	it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])(
		'rejects invalid blocking timeout %s before moving bytes',
		(timeoutMs) => {
			const readQueue = new SharedByteQueue(createSharedByteQueue(4096, 15));
			readQueue.tryWrite(Uint8Array.of(42));

			expect(() => readQueue.readBlocking(new Uint8Array(1), timeoutMs)).toThrow(
				/non-negative finite number or Infinity/u
			);
			expect(readQueue.available).toBe(1);

			const writeQueue = new SharedByteQueue(createSharedByteQueue(4096, 16));
			expect(() => writeQueue.writeBlocking(Uint8Array.of(42), timeoutMs)).toThrow(
				/non-negative finite number or Infinity/u
			);
			expect(writeQueue.available).toBe(0);
		}
	);

	it('returns EOF after close and rejects stale generations', async () => {
		const descriptor = createSharedByteQueue(4096, 9);
		const queue = new SharedByteQueue(descriptor);
		queue.close();
		expect(await queue.read(new Uint8Array(1))).toBe(0);
		expect(() => queue.tryWrite(Uint8Array.of(1))).toThrow(/closed/u);
		expect(
			() => new SharedByteQueue({ ...descriptor, generation: descriptor.generation + 1 })
		).toThrow(/stale/u);
	});

	it('removes abort listeners after an asynchronous wait completes', async () => {
		const queue = new SharedByteQueue(createSharedByteQueue(4096, 10));
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const destination = new Uint8Array(1);

		const read = queue.read(destination, controller.signal);
		await new Promise((resolve) => setTimeout(resolve, 0));
		queue.tryWrite(Uint8Array.of(42));

		expect(await read).toBe(1);
		expect(destination[0]).toBe(42);
		expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), {
			once: true
		});
		expect(removeEventListener).toHaveBeenCalledTimes(addEventListener.mock.calls.length);
	});
});
