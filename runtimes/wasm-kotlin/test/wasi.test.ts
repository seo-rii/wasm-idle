import { describe, expect, it } from 'vitest';
import {
	createKotlinWasiConsole,
	WASI_CONSOLE_ABI as ABI,
	WASI_CONSOLE_ERRNO as ERRNO,
	type KotlinWasiConsoleOptions
} from '../src/wasi.js';

const RESULT = 16;
const IOVECS = 128;
const SUBSCRIPTIONS = 256;
const EVENTS = 512;
const DATA = 1_024;
const encoder = new TextEncoder();

function setup(stdin = new Uint8Array(), limits: Partial<KotlinWasiConsoleOptions> = {}) {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
	const console = createKotlinWasiConsole({
		memory: () => memory,
		stdin,
		maxStdinBytes: 8_192,
		maxOutputBytes: 8_192,
		...limits
	});
	return {
		memory,
		console,
		calls: console.imports.wasi_snapshot_preview1,
		view: () => new DataView(memory.buffer),
		bytes: () => new Uint8Array(memory.buffer)
	};
}

type Fixture = ReturnType<typeof setup>;

function vectors(fixture: Fixture, buffers: readonly { pointer: number; bytes: number }[]) {
	for (const [index, buffer] of buffers.entries()) {
		fixture.view().setUint32(IOVECS + index * 8, buffer.pointer, true);
		fixture.view().setUint32(IOVECS + index * 8 + 4, buffer.bytes, true);
	}
}

function write(fixture: Fixture, fd: number, bytes: Uint8Array) {
	fixture.bytes().set(bytes, DATA);
	vectors(fixture, [{ pointer: DATA, bytes: bytes.byteLength }]);
	return fixture.calls.fd_write(fd, IOVECS, 1, RESULT);
}

function subscription(fixture: Fixture, index: number, fd: number, type: number, userdata = 0n) {
	const pointer = SUBSCRIPTIONS + index * 48;
	fixture.view().setBigUint64(pointer, userdata, true);
	fixture.view().setUint8(pointer + 8, type);
	fixture.view().setUint32(pointer + 16, fd, true);
}

function event(fixture: Fixture, index = 0) {
	const pointer = EVENTS + index * 32;
	return {
		userdata: fixture.view().getBigUint64(pointer, true),
		error: fixture.view().getUint16(pointer + 8, true),
		type: fixture.view().getUint8(pointer + 10),
		bytes: fixture.view().getBigUint64(pointer + 16, true),
		flags: fixture.view().getUint16(pointer + 24, true)
	};
}

describe('internal Kotlin WASI Preview 1 console ABI foundation', () => {
	it('snapshots bounded stdin and scatters exact bytes through EOF', () => {
		const stdin = encoder.encode('한글\r\n\nfinal');
		const fixture = setup(stdin);
		stdin.fill(0);
		vectors(fixture, [
			{ pointer: DATA, bytes: 3 },
			{ pointer: DATA + 3, bytes: 32 }
		]);
		expect(fixture.calls.fd_read(0, IOVECS, 2, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(14);
		expect(new TextDecoder().decode(fixture.bytes().subarray(DATA, DATA + 14))).toBe(
			'한글\r\n\nfinal'
		);
		fixture.bytes().fill(0xaa, DATA, DATA + 35);
		expect(fixture.calls.fd_read(0, IOVECS, 2, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(0);
		expect(fixture.bytes().subarray(DATA, DATA + 35)).toEqual(new Uint8Array(35).fill(0xaa));
	});

	it('supports one-byte reads, zero-length vectors, and empty stdin', () => {
		const fixture = setup(encoder.encode('A\n'));
		vectors(fixture, [
			{ pointer: DATA, bytes: 0 },
			{ pointer: DATA + 1, bytes: 1 }
		]);
		for (const expected of [65, 10]) {
			expect(fixture.calls.fd_read(0, IOVECS, 2, RESULT)).toBe(ERRNO.success);
			expect(fixture.view().getUint32(RESULT, true)).toBe(1);
			expect(fixture.bytes()[DATA + 1]).toBe(expected);
		}
		expect(fixture.calls.fd_read(0, IOVECS, 0, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(0);
		const empty = setup();
		vectors(empty, [{ pointer: DATA, bytes: 1 }]);
		expect(empty.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(empty.view().getUint32(RESULT, true)).toBe(0);
	});

	it('returns standard events without consuming input, including EOF readiness', () => {
		const fixture = setup(encoder.encode('abc'));
		const userdata = 0xfedc_ba98_7654_3210n;
		subscription(fixture, 0, 0, ABI.fdRead, userdata);
		fixture.bytes().fill(0xaa, EVENTS - 8, EVENTS + 40);
		for (let repetition = 0; repetition < 2; repetition++) {
			expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(ERRNO.success);
			expect(fixture.view().getUint32(RESULT, true)).toBe(1);
			expect(event(fixture)).toEqual({ userdata, error: 0, type: 1, bytes: 3n, flags: 0 });
		}
		expect(fixture.bytes().subarray(EVENTS - 8, EVENTS)).toEqual(new Uint8Array(8).fill(0xaa));
		expect(fixture.bytes().subarray(EVENTS + 32, EVENTS + 40)).toEqual(
			new Uint8Array(8).fill(0xaa)
		);
		expect(fixture.bytes().subarray(EVENTS + 26, EVENTS + 32)).toEqual(new Uint8Array(6));
		vectors(fixture, [{ pointer: DATA, bytes: 3 }]);
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(new TextDecoder().decode(fixture.bytes().subarray(DATA, DATA + 3))).toBe('abc');
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(ERRNO.success);
		expect(event(fixture)).toEqual({
			userdata,
			error: 0,
			type: 1,
			bytes: 0n,
			flags: ABI.hangup
		});
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(0);
	});

	it('reports write capacity and descriptor errors per subscription', () => {
		const fixture = setup(undefined, { maxOutputBytes: 4 });
		subscription(fixture, 0, 1, ABI.fdWrite, 11n);
		subscription(fixture, 1, 2, ABI.fdWrite, 22n);
		subscription(fixture, 2, 9, ABI.fdRead, 33n);
		subscription(fixture, 3, 1, ABI.fdRead, 44n);
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 4, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(4);
		expect(event(fixture, 0)).toEqual({
			userdata: 11n,
			error: 0,
			type: 2,
			bytes: 4n,
			flags: 0
		});
		expect(event(fixture, 1)).toEqual({
			userdata: 22n,
			error: 0,
			type: 2,
			bytes: 4n,
			flags: 0
		});
		expect(event(fixture, 2)).toEqual({
			userdata: 33n,
			error: ERRNO.badf,
			type: 1,
			bytes: 0n,
			flags: 0
		});
		expect(event(fixture, 3)).toEqual({
			userdata: 44n,
			error: ERRNO.badf,
			type: 1,
			bytes: 0n,
			flags: 0
		});
		expect(write(fixture, 1, encoder.encode('abcd'))).toBe(ERRNO.success);
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(ERRNO.success);
		expect(event(fixture).error).toBe(ERRNO.fbig);
		expect(event(fixture).bytes).toBe(0n);
	});

	it('decodes each UTF-8 stream across writes and vectors, preserving BOM and newlines', () => {
		const fixture = setup();
		const bytes = encoder.encode('\ufeff한😀\r\n');
		for (const byte of bytes) {
			expect(write(fixture, 1, new Uint8Array([byte]))).toBe(ERRNO.success);
			expect(write(fixture, 2, encoder.encode('!'))).toBe(ERRNO.success);
		}
		fixture.bytes().set([0xe2, 0x82, 0xac], DATA);
		vectors(fixture, [
			{ pointer: DATA, bytes: 1 },
			{ pointer: DATA + 1, bytes: 2 }
		]);
		expect(fixture.calls.fd_write(2, IOVECS, 2, RESULT)).toBe(ERRNO.success);
		expect(fixture.view().getUint32(RESULT, true)).toBe(3);
		expect(fixture.console.finish()).toEqual({
			stdout: '\ufeff한😀\r\n',
			stderr: '!'.repeat(bytes.byteLength) + '€',
			outputBytes: bytes.byteLength * 2 + 3,
			outputLimitExceeded: false
		});
	});

	it('flushes incomplete UTF-8 once and seals the finished console', () => {
		const fixture = setup();
		expect(write(fixture, 1, new Uint8Array([0xe3]))).toBe(ERRNO.success);
		expect(write(fixture, 2, new Uint8Array([0xf0, 0x9f]))).toBe(ERRNO.success);
		const output = fixture.console.finish();
		expect(output.stdout).toBe('�');
		expect(output.stderr).toBe('�');
		expect(output.outputBytes).toBe(3);
		expect(fixture.console.finish()).toBe(output);
		expect(write(fixture, 1, encoder.encode('later'))).toBe(ERRNO.badf);
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.badf);
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(ERRNO.badf);
	});

	it('rejects a whole write over the combined raw byte budget', () => {
		const fixture = setup(undefined, { maxOutputBytes: 4 });
		expect(write(fixture, 1, encoder.encode('한'))).toBe(ERRNO.success);
		fixture.view().setUint32(RESULT, 0xabcd_ef12, true);
		expect(write(fixture, 2, encoder.encode('😀'))).toBe(ERRNO.fbig);
		expect(fixture.view().getUint32(RESULT, true)).toBe(0xabcd_ef12);
		expect(write(fixture, 2, encoder.encode('!'))).toBe(ERRNO.success);
		expect(fixture.console.finish()).toEqual({
			stdout: '한',
			stderr: '!',
			outputBytes: 4,
			outputLimitExceeded: true
		});
	});

	it('does not change decoder state when a later vector is invalid or exceeds the budget', () => {
		const fixture = setup(undefined, { maxOutputBytes: 3 });
		expect(write(fixture, 1, new Uint8Array([0xe3]))).toBe(ERRNO.success);
		fixture.bytes().set([0x81, 0x82], DATA);
		vectors(fixture, [
			{ pointer: DATA, bytes: 2 },
			{ pointer: 65_535, bytes: 2 }
		]);
		expect(fixture.calls.fd_write(1, IOVECS, 2, RESULT)).toBe(ERRNO.fault);
		vectors(fixture, [
			{ pointer: DATA, bytes: 2 },
			{ pointer: DATA, bytes: 1 }
		]);
		expect(fixture.calls.fd_write(1, IOVECS, 2, RESULT)).toBe(ERRNO.fbig);
		expect(write(fixture, 1, new Uint8Array([0x81, 0x82]))).toBe(ERRNO.success);
		expect(fixture.console.finish()).toEqual({
			stdout: 'あ',
			stderr: '',
			outputBytes: 3,
			outputLimitExceeded: true
		});
	});

	it('validates all read buffers before consuming input or writing anything', () => {
		const fixture = setup(encoder.encode('abc'));
		vectors(fixture, [
			{ pointer: DATA, bytes: 1 },
			{ pointer: 65_535, bytes: 2 }
		]);
		fixture.bytes().fill(0xaa, DATA, DATA + 3);
		fixture.view().setUint32(RESULT, 0xabcd_ef12, true);
		const before = fixture.bytes().slice();
		expect(fixture.calls.fd_read(0, IOVECS, 2, RESULT)).toBe(ERRNO.fault);
		expect(fixture.bytes()).toEqual(before);
		vectors(fixture, [{ pointer: DATA, bytes: 3 }]);
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(new TextDecoder().decode(fixture.bytes().subarray(DATA, DATA + 3))).toBe('abc');
	});

	it.each([
		[-8, 1, RESULT, ERRNO.fault],
		[IOVECS, 1, -4, ERRNO.fault],
		[IOVECS + 1, 1, RESULT, ERRNO.inval],
		[IOVECS, 1, RESULT + 1, ERRNO.inval],
		[IOVECS, 2, RESULT, ERRNO.inval],
		[IOVECS, 0x1_0000_0000, RESULT, ERRNO.inval],
		[IOVECS, -1, RESULT, ERRNO.inval],
		[IOVECS, Number.NaN, RESULT, ERRNO.inval]
	])('rejects invalid iovec metadata (%s, %s, %s)', (pointer, count, result, expected) => {
		const fixture = setup(encoder.encode('abc'), { maxIovecs: 1 });
		vectors(fixture, [{ pointer: DATA, bytes: 3 }]);
		const before = fixture.bytes().slice();
		expect(fixture.calls.fd_read(0, pointer, count, result)).toBe(expected);
		expect(fixture.calls.fd_write(1, pointer, count, result)).toBe(expected);
		expect(fixture.bytes()).toEqual(before);
		expect(fixture.console.finish().outputBytes).toBe(0);
	});

	it('rejects buffer address overflow and aliases that corrupt read counters', () => {
		const fixture = setup(encoder.encode('abc'));
		vectors(fixture, [{ pointer: 0xffff_fffc, bytes: 8 }]);
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.fault);
		expect(fixture.calls.fd_write(1, IOVECS, 1, RESULT)).toBe(ERRNO.fault);
		vectors(fixture, [{ pointer: RESULT, bytes: 3 }]);
		const before = fixture.bytes().slice();
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.inval);
		expect(fixture.bytes()).toEqual(before);
	});

	it('rejects vector table multiplication overflow before reading descriptors', () => {
		const fixture = setup(undefined, { maxIovecs: 0x2000_0000 });
		fixture.view().setUint32(RESULT, 99, true);
		expect(fixture.calls.fd_read(0, IOVECS, 0x2000_0000, RESULT)).toBe(ERRNO.overflow);
		expect(fixture.calls.fd_write(1, IOVECS, 0x2000_0000, RESULT)).toBe(ERRNO.overflow);
		expect(fixture.view().getUint32(RESULT, true)).toBe(99);
		expect(fixture.console.finish().outputBytes).toBe(0);
	});

	it('rejects a total iovec length above size_t even when every buffer is in bounds', () => {
		const memory = new WebAssembly.Memory({ initial: 16 });
		const console = createKotlinWasiConsole({
			memory: () => memory,
			stdin: encoder.encode('abc'),
			maxStdinBytes: 3,
			maxOutputBytes: 0xffff_ffff,
			maxIovecs: 4_096
		});
		const view = new DataView(memory.buffer);
		for (let index = 0; index < 4_096; index++) {
			view.setUint32(IOVECS + index * 8, 0, true);
			view.setUint32(IOVECS + index * 8 + 4, memory.buffer.byteLength, true);
		}
		view.setUint32(RESULT, 99, true);
		const calls = console.imports.wasi_snapshot_preview1;
		expect(calls.fd_read(0, IOVECS, 4_096, RESULT)).toBe(ERRNO.overflow);
		expect(calls.fd_write(1, IOVECS, 4_096, RESULT)).toBe(ERRNO.overflow);
		expect(view.getUint32(RESULT, true)).toBe(99);
		view.setUint32(IOVECS, DATA, true);
		view.setUint32(IOVECS + 4, 3, true);
		expect(calls.fd_read(0, IOVECS, 1, RESULT)).toBe(0);
		expect(new TextDecoder().decode(new Uint8Array(memory.buffer, DATA, 3))).toBe('abc');
		expect(console.finish().outputBytes).toBe(0);
	});

	it('takes a fresh memory view after growth', () => {
		const fixture = setup(encoder.encode('new'));
		fixture.memory.grow(1);
		vectors(fixture, [{ pointer: 70_000, bytes: 3 }]);
		expect(fixture.calls.fd_read(0, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(fixture.calls.fd_write(1, IOVECS, 1, RESULT)).toBe(ERRNO.success);
		expect(fixture.console.finish().stdout).toBe('new');
	});

	it.each([
		[SUBSCRIPTIONS + 1, EVENTS, 1, RESULT, ERRNO.inval],
		[SUBSCRIPTIONS, EVENTS + 1, 1, RESULT, ERRNO.inval],
		[SUBSCRIPTIONS, EVENTS, 1, RESULT + 1, ERRNO.inval],
		[65_512, EVENTS, 1, RESULT, ERRNO.fault],
		[SUBSCRIPTIONS, 65_512, 1, RESULT, ERRNO.fault],
		[SUBSCRIPTIONS, EVENTS, 0, RESULT, ERRNO.inval],
		[SUBSCRIPTIONS, EVENTS, 3, RESULT, ERRNO.inval],
		[SUBSCRIPTIONS, EVENTS, 1, EVENTS, ERRNO.inval]
	])(
		'requires bounded full-sized aligned poll allocations (%s, %s, %s)',
		(input, output, count, result, expected) => {
			const fixture = setup(undefined, { maxSubscriptions: 2 });
			subscription(fixture, 0, 0, ABI.fdRead);
			const before = fixture.bytes().slice();
			expect(fixture.calls.poll_oneoff(input, output, count, result)).toBe(expected);
			expect(fixture.bytes()).toEqual(before);
		}
	);

	it.each([0, 3])(
		'rejects unsupported or malformed subscription type %s without partial events',
		(type) => {
			const fixture = setup();
			subscription(fixture, 0, 0, ABI.fdRead);
			subscription(fixture, 1, 0, type);
			fixture.bytes().fill(0xaa, EVENTS, EVENTS + 64);
			fixture.view().setUint32(RESULT, 99, true);
			const before = fixture.bytes().slice();
			expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 2, RESULT)).toBe(
				type === 0 ? ERRNO.notsup : ERRNO.inval
			);
			expect(fixture.bytes()).toEqual(before);
		}
	);

	it('snapshots subscriptions when input and output allocations overlap', () => {
		const fixture = setup(encoder.encode('abc'));
		subscription(fixture, 0, 0, ABI.fdRead, 100n);
		subscription(fixture, 1, 2, ABI.fdWrite, 200n);
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, SUBSCRIPTIONS, 2, RESULT)).toBe(
			ERRNO.success
		);
		expect(fixture.view().getBigUint64(SUBSCRIPTIONS, true)).toBe(100n);
		expect(fixture.view().getBigUint64(SUBSCRIPTIONS + 32, true)).toBe(200n);
	});

	it('rejects shared memory and exposes only implemented imports', () => {
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
		const fixture = setup(undefined, { memory: () => memory });
		expect(fixture.calls.fd_read(0, IOVECS, 0, RESULT)).toBe(ERRNO.notsup);
		expect(fixture.calls.fd_write(1, IOVECS, 0, RESULT)).toBe(ERRNO.notsup);
		expect(fixture.calls.poll_oneoff(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(ERRNO.notsup);
		expect(Object.keys(fixture.calls)).toEqual(['fd_read', 'fd_write', 'poll_oneoff']);
		expect(fixture.calls.fd_read(1, IOVECS, 0, RESULT)).toBe(ERRNO.badf);
		expect(fixture.calls.fd_write(0, IOVECS, 0, RESULT)).toBe(ERRNO.badf);
	});

	it('rejects excessive stdin and invalid limit configuration before allocating its snapshot', () => {
		expect(() => setup(encoder.encode('abc'), { maxStdinBytes: 2 })).toThrow('stdin exceeds');
		expect(() => setup(undefined, { maxOutputBytes: -1 })).toThrow(RangeError);
		expect(() => setup(undefined, { maxIovecs: 0 })).toThrow(RangeError);
		expect(() => setup(undefined, { maxSubscriptions: 1.5 })).toThrow(RangeError);
	});
});

/*
 * ABI microprobe compiled with installed WABT 1.0.39 from this module:
 * (module
 *   (import "env" "memory" (memory 1))
 *   (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
 *   (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
 *   (import "wasi_snapshot_preview1" "poll_oneoff" (func $poll (param i32 i32 i32 i32) (result i32)))
 *   (func (export "read") (param i32 i32 i32 i32) (result i32)
 *     local.get 0 local.get 1 local.get 2 local.get 3 call $read)
 *   (func (export "write") (param i32 i32 i32 i32) (result i32)
 *     local.get 0 local.get 1 local.get 2 local.get 3 call $write)
 *   (func (export "poll") (param i32 i32 i32 i32) (result i32)
 *     local.get 0 local.get 1 local.get 2 local.get 3 call $poll))
 * It is not a Kotlin-generated fixture, compiler probe, or browser acceptance.
 */
const wasiAbiMicroprobe = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 9, 1, 96, 4, 127, 127, 127, 127, 1, 127, 2, 119, 4, 3, 101, 110,
	118, 6, 109, 101, 109, 111, 114, 121, 2, 0, 1, 22, 119, 97, 115, 105, 95, 115, 110, 97, 112,
	115, 104, 111, 116, 95, 112, 114, 101, 118, 105, 101, 119, 49, 7, 102, 100, 95, 114, 101, 97,
	100, 0, 0, 22, 119, 97, 115, 105, 95, 115, 110, 97, 112, 115, 104, 111, 116, 95, 112, 114, 101,
	118, 105, 101, 119, 49, 8, 102, 100, 95, 119, 114, 105, 116, 101, 0, 0, 22, 119, 97, 115, 105,
	95, 115, 110, 97, 112, 115, 104, 111, 116, 95, 112, 114, 101, 118, 105, 101, 119, 49, 11, 112,
	111, 108, 108, 95, 111, 110, 101, 111, 102, 102, 0, 0, 3, 4, 3, 0, 0, 0, 7, 23, 3, 4, 114, 101,
	97, 100, 0, 3, 5, 119, 114, 105, 116, 101, 0, 4, 4, 112, 111, 108, 108, 0, 5, 10, 40, 3, 12, 0,
	32, 0, 32, 1, 32, 2, 32, 3, 16, 0, 11, 12, 0, 32, 0, 32, 1, 32, 2, 32, 3, 16, 1, 11, 12, 0, 32,
	0, 32, 1, 32, 2, 32, 3, 16, 2, 11
]);

describe('actual WebAssembly.Instance ABI microprobe, not Kotlin acceptance', () => {
	it('calls poll/read/write imports through Wasm function bodies with standard canaries and EOF', () => {
		const fixture = setup(encoder.encode('input 한글\n'));
		const instance = new WebAssembly.Instance(new WebAssembly.Module(wasiAbiMicroprobe), {
			...fixture.console.imports,
			env: { memory: fixture.memory }
		});
		const calls = instance.exports as Record<
			'read' | 'write' | 'poll',
			(a: number, b: number, c: number, d: number) => number
		>;
		subscription(fixture, 0, 0, ABI.fdRead, 0xf000_0000_0000_0001n);
		fixture.bytes().fill(0xaa, EVENTS - 8, EVENTS + 40);
		expect(calls.poll(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(0);
		expect(event(fixture)).toEqual({
			userdata: 0xf000_0000_0000_0001n,
			error: 0,
			type: 1,
			bytes: 13n,
			flags: 0
		});
		expect(fixture.bytes().subarray(EVENTS + 32, EVENTS + 40)).toEqual(
			new Uint8Array(8).fill(0xaa)
		);
		vectors(fixture, [{ pointer: DATA, bytes: 13 }]);
		expect(calls.read(0, IOVECS, 1, RESULT)).toBe(0);
		expect(fixture.view().getUint32(RESULT, true)).toBe(13);
		expect(calls.write(1, IOVECS, 1, RESULT)).toBe(0);
		expect(calls.write(2, IOVECS, 1, RESULT)).toBe(0);
		expect(calls.poll(SUBSCRIPTIONS, EVENTS, 1, RESULT)).toBe(0);
		expect(event(fixture).bytes).toBe(0n);
		expect(calls.read(0, IOVECS, 1, RESULT)).toBe(0);
		expect(fixture.view().getUint32(RESULT, true)).toBe(0);
		expect(fixture.console.finish()).toEqual({
			stdout: 'input 한글\n',
			stderr: 'input 한글\n',
			outputBytes: 26,
			outputLimitExceeded: false
		});
	});
});
