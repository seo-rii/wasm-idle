import { describe, expect, it } from 'vitest';

import {
	STATIC_STDIN_RING_CANCELLED_INDEX,
	STATIC_STDIN_RING_CLOSED_INDEX,
	STATIC_STDIN_RING_CONTROL_SLOTS,
	STATIC_STDIN_RING_READ_INDEX,
	STATIC_STDIN_RING_WRITE_INDEX,
	StaticStdinRingHost,
	StaticStdinRingOverflowError
} from './staticStdinRing';

function views(host: StaticStdinRingHost) {
	return {
		control: new Int32Array(host.descriptor.buffer, 0, STATIC_STDIN_RING_CONTROL_SLOTS),
		data: new Uint8Array(
			host.descriptor.buffer,
			host.descriptor.controlBytes,
			host.descriptor.capacity
		)
	};
}

describe('StaticStdinRingHost', () => {
	it('publishes UTF-8 input through a versioned shared descriptor', () => {
		const host = new StaticStdinRingHost({ capacity: 8, maxBufferedBytes: 16 });
		const { control, data } = views(host);

		expect(host.descriptor).toMatchObject({
			protocol: 'wasm-idle-static-stdin-ring',
			protocolVersion: 1,
			capacity: 8,
			controlBytes: 16
		});
		expect(host.enqueue('éA')).toBe(3);
		expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe(3);
		expect(Atomics.load(control, STATIC_STDIN_RING_READ_INDEX)).toBe(0);
		expect([...data.subarray(0, 3)]).toEqual([0xc3, 0xa9, 0x41]);
		expect(host.bufferedBytes).toBe(3);
	});

	it('keeps pending input bounded and publishes it after consumer progress', () => {
		const host = new StaticStdinRingHost({ capacity: 4, maxBufferedBytes: 8 });
		const { control, data } = views(host);

		host.enqueue('abcd');
		host.enqueue('efgh');
		expect(host.bufferedBytes).toBe(8);
		expect(() => host.enqueue('i')).toThrow(
			expect.objectContaining<Partial<StaticStdinRingOverflowError>>({
				name: 'StaticStdinRingOverflowError',
				actual: 9,
				limit: 8
			})
		);

		host.close();
		expect(host.isClosed).toBe(false);
		Atomics.store(control, STATIC_STDIN_RING_READ_INDEX, 4);
		host.consumerRequestedInput();

		expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe(8);
		expect([...data]).toEqual([...new TextEncoder().encode('efgh')]);
		expect(host.bufferedBytes).toBe(4);
		expect(host.isClosed).toBe(true);
	});

	it('wraps newly published bytes without reordering unread input', () => {
		const host = new StaticStdinRingHost({ capacity: 4, maxBufferedBytes: 8 });
		const { control, data } = views(host);
		host.enqueue('abcd');
		Atomics.store(control, STATIC_STDIN_RING_READ_INDEX, 3);

		host.enqueue('efg');

		expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe(7);
		const read = Atomics.load(control, STATIC_STDIN_RING_READ_INDEX);
		const write = Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX);
		const available = Array.from({ length: write - read }, (_, offset) => {
			return data[(read + offset) % data.byteLength];
		});
		expect(new TextDecoder().decode(new Uint8Array(available))).toBe('defg');
	});

	it('cancels waiters and discards input that was not published', () => {
		const host = new StaticStdinRingHost({ capacity: 4, maxBufferedBytes: 8 });
		const { control } = views(host);
		host.enqueue('abcdefgh');

		host.cancel();

		expect(host.isCancelled).toBe(true);
		expect(host.isClosed).toBe(true);
		expect(Atomics.load(control, STATIC_STDIN_RING_CANCELLED_INDEX)).toBe(1);
		expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);
		expect(host.bufferedBytes).toBe(4);
		expect(() => host.enqueue('late')).toThrow('Static stdin ring is cancelled');
	});

	it('rejects invalid or internally inconsistent bounds', () => {
		expect(() => new StaticStdinRingHost({ capacity: 0 })).toThrow(
			'Static stdin ring capacity must be a positive safe integer'
		);
		expect(() => new StaticStdinRingHost({ capacity: 8, maxBufferedBytes: 4 })).toThrow(
			'Static stdin maximum buffered bytes must cover the ring capacity'
		);
		const host = new StaticStdinRingHost({ capacity: 4, maxBufferedBytes: 8 });
		const { control } = views(host);
		Atomics.store(control, STATIC_STDIN_RING_READ_INDEX, 5);
		expect(() => host.consumerRequestedInput()).toThrow(
			'Static stdin ring counters are invalid'
		);
	});
});
