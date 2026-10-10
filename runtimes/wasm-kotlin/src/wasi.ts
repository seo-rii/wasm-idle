/**
 * Internal console ABI foundation, not a Kotlin compiler or runtime acceptance.
 *
 * ABI source: WebAssembly/wasi-libc@165235bc467d5fa52d424f5d82587dfb76ed9d54,
 * libc-bottom-half/headers/public/wasi/wasip1.h
 * SHA-256: db122dfbbd0a51c28c888aabc7163814e9b400689d4c76727b54e404e0e754b6
 *
 * Kotlin source: JetBrains/kotlin@4d78aae1e337cd40f69baa865aed950fe807a775,
 * libraries/stdlib/wasm/wasi/src/kotlin/io.kt
 * SHA-256: 86a8ef9ba4971704ac49113c6124c63b8625dd9fda3c39b6fa2650bcc42ae040
 * That source requests 20/26 bytes for subscription/event. This adapter requires
 * the standard 48/32-byte layouts; Kotlin allocator compatibility is unverified.
 * Linear-memory range checks cannot detect a smaller logical allocator object.
 */

export const WASI_CONSOLE_ABI = Object.freeze({
	subscriptionBytes: 48,
	eventBytes: 32,
	structureAlignment: 8,
	iovecBytes: 8,
	fdRead: 1,
	fdWrite: 2,
	hangup: 1
});

export const WASI_CONSOLE_ERRNO = Object.freeze({
	success: 0,
	badf: 8,
	fault: 21,
	fbig: 22,
	inval: 28,
	notsup: 58,
	overflow: 61
});

type WasiCall = (first: number, second: number, third: number, fourth: number) => number;

export interface KotlinWasiConsoleOptions {
	/** Use imported memory when imports can execute in the module's start function. */
	memory: () => WebAssembly.Memory;
	/** A complete input snapshot. EOF follows its last byte; streaming is unsupported. */
	stdin: Uint8Array;
	maxStdinBytes: number;
	/** Combined accepted stdout/stderr bytes, before UTF-8 decoding. */
	maxOutputBytes: number;
	maxIovecs?: number;
	maxSubscriptions?: number;
}

export interface KotlinWasiConsoleOutput {
	readonly stdout: string;
	readonly stderr: string;
	readonly outputBytes: number;
	readonly outputLimitExceeded: boolean;
}

export interface KotlinWasiConsole {
	readonly imports: {
		readonly wasi_snapshot_preview1: {
			readonly fd_read: WasiCall;
			readonly fd_write: WasiCall;
			readonly poll_oneoff: WasiCall;
		};
	};
	/** Flush each decoder once and close the console. Later imports return BADF. */
	finish(): KotlinWasiConsoleOutput;
}

const UINT32_MAX = 0xffff_ffff;

function limit(value: number, name: string, minimum = 0): number {
	if (!Number.isInteger(value) || value < minimum || value > UINT32_MAX) {
		throw new RangeError(`${name} must be an integer between ${minimum} and ${UINT32_MAX}`);
	}
	return value;
}

/** Wasm i32 parameters arrive signed, but pointers and sizes have unsigned meaning. */
function uint32(value: number): number | undefined {
	if (!Number.isInteger(value) || value < -0x8000_0000 || value > UINT32_MAX) {
		return undefined;
	}
	return value >>> 0;
}

function spanError(bufferBytes: number, pointer: number, bytes: number, alignment: number): number {
	if (pointer % alignment !== 0) return WASI_CONSOLE_ERRNO.inval;
	if (bytes > UINT32_MAX) return WASI_CONSOLE_ERRNO.overflow;
	if (pointer > bufferBytes || bytes > bufferBytes - pointer) return WASI_CONSOLE_ERRNO.fault;
	return WASI_CONSOLE_ERRNO.success;
}

function overlaps(first: number, firstBytes: number, second: number, secondBytes: number): boolean {
	return (
		firstBytes > 0 &&
		secondBytes > 0 &&
		first < second + secondBytes &&
		second < first + firstBytes
	);
}

interface Iovec {
	pointer: number;
	bytes: number;
}

type IovecsResult =
	| { errno: number; vectors?: never; bytes?: never; resultPointer?: never }
	| { errno: 0; vectors: Iovec[]; bytes: number; resultPointer: number };

/** Validate every descriptor and buffer before a call can change memory or consume input. */
function readIovecs(
	view: DataView,
	vectorPointer: number,
	vectorCount: number,
	resultPointer: number,
	maxIovecs: number
): IovecsResult {
	const pointer = uint32(vectorPointer);
	const count = uint32(vectorCount);
	const result = uint32(resultPointer);
	if (pointer === undefined || count === undefined || result === undefined || count > maxIovecs) {
		return { errno: WASI_CONSOLE_ERRNO.inval };
	}
	const tableError = spanError(view.byteLength, pointer, count * WASI_CONSOLE_ABI.iovecBytes, 4);
	if (tableError) return { errno: tableError };
	const resultError = spanError(view.byteLength, result, 4, 4);
	if (resultError) return { errno: resultError };
	const vectors: Iovec[] = [];
	let bytes = 0;
	for (let index = 0; index < count; index++) {
		const offset = pointer + index * WASI_CONSOLE_ABI.iovecBytes;
		const vector = {
			pointer: view.getUint32(offset, true),
			bytes: view.getUint32(offset + 4, true)
		};
		const bufferError = spanError(view.byteLength, vector.pointer, vector.bytes, 1);
		if (bufferError) return { errno: bufferError };
		if (vector.bytes > UINT32_MAX - bytes) return { errno: WASI_CONSOLE_ERRNO.overflow };
		bytes += vector.bytes;
		vectors.push(vector);
	}
	return { errno: 0, vectors, bytes, resultPointer: result };
}

/**
 * Provides only three implemented Preview 1 imports. Missing imports fail linking;
 * there are no filesystem, socket, clock, random, or broad success stubs.
 * Shared memory is rejected because this single-threaded adapter cannot validate
 * guest descriptors atomically while another thread mutates them.
 */
export function createKotlinWasiConsole(options: KotlinWasiConsoleOptions): KotlinWasiConsole {
	const maxStdinBytes = limit(options.maxStdinBytes, 'maxStdinBytes');
	const maxOutputBytes = limit(options.maxOutputBytes, 'maxOutputBytes');
	const maxIovecs = limit(options.maxIovecs ?? 1_024, 'maxIovecs', 1);
	const maxSubscriptions = limit(options.maxSubscriptions ?? 1_024, 'maxSubscriptions', 1);
	if (!(options.stdin instanceof Uint8Array)) throw new TypeError('stdin must be a Uint8Array');
	if (options.stdin.byteLength > maxStdinBytes)
		throw new RangeError('stdin exceeds maxStdinBytes');
	const input = new Uint8Array(options.stdin);
	const streams = [
		{ decoder: new TextDecoder('utf-8', { ignoreBOM: true }), chunks: [] as string[] },
		{ decoder: new TextDecoder('utf-8', { ignoreBOM: true }), chunks: [] as string[] }
	] as const;
	let inputPosition = 0;
	let outputBytes = 0;
	let outputLimitExceeded = false;
	let finished: KotlinWasiConsoleOutput | undefined;

	function memoryBuffer(): ArrayBuffer | undefined {
		const buffer = options.memory().buffer;
		if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) return;
		return buffer as ArrayBuffer;
	}

	const fd_read: WasiCall = (fd, iovs, iovsLen, nread) => {
		if (finished || fd !== 0) return WASI_CONSOLE_ERRNO.badf;
		const buffer = memoryBuffer();
		if (!buffer) return WASI_CONSOLE_ERRNO.notsup;
		const view = new DataView(buffer);
		const result = readIovecs(view, iovs, iovsLen, nread, maxIovecs);
		if (!result.vectors) return result.errno;
		// A count cannot overwrite data it is supposed to describe.
		if (
			result.vectors.some((vector) =>
				overlaps(vector.pointer, vector.bytes, result.resultPointer, 4)
			)
		) {
			return WASI_CONSOLE_ERRNO.inval;
		}
		const target = new Uint8Array(buffer);
		let read = 0;
		for (const vector of result.vectors) {
			const bytes = Math.min(vector.bytes, input.byteLength - inputPosition);
			target.set(input.subarray(inputPosition, inputPosition + bytes), vector.pointer);
			inputPosition += bytes;
			read += bytes;
		}
		view.setUint32(result.resultPointer, read, true);
		return WASI_CONSOLE_ERRNO.success;
	};

	const fd_write: WasiCall = (fd, iovs, iovsLen, nwritten) => {
		if (finished || (fd !== 1 && fd !== 2)) return WASI_CONSOLE_ERRNO.badf;
		const buffer = memoryBuffer();
		if (!buffer) return WASI_CONSOLE_ERRNO.notsup;
		const view = new DataView(buffer);
		const result = readIovecs(view, iovs, iovsLen, nwritten, maxIovecs);
		if (!result.vectors) return result.errno;
		if (result.bytes > maxOutputBytes - outputBytes) {
			// The sticky flag records the rejection; stream and guest counters remain unchanged.
			outputLimitExceeded = true;
			return WASI_CONSOLE_ERRNO.fbig;
		}
		const stream = fd === 1 ? streams[0] : streams[1];
		for (const vector of result.vectors) {
			const chunk = stream.decoder.decode(
				new Uint8Array(buffer, vector.pointer, vector.bytes),
				{
					stream: true
				}
			);
			if (chunk) stream.chunks.push(chunk);
		}
		outputBytes += result.bytes;
		view.setUint32(result.resultPointer, result.bytes, true);
		return WASI_CONSOLE_ERRNO.success;
	};

	const poll_oneoff: WasiCall = (inPointer, outPointer, nsubscriptions, nevents) => {
		if (finished) return WASI_CONSOLE_ERRNO.badf;
		const inputPointer = uint32(inPointer);
		const outputPointer = uint32(outPointer);
		const count = uint32(nsubscriptions);
		const resultPointer = uint32(nevents);
		if (
			inputPointer === undefined ||
			outputPointer === undefined ||
			count === undefined ||
			resultPointer === undefined ||
			count === 0 ||
			count > maxSubscriptions
		)
			return WASI_CONSOLE_ERRNO.inval;
		const buffer = memoryBuffer();
		if (!buffer) return WASI_CONSOLE_ERRNO.notsup;
		const view = new DataView(buffer);
		const outputLength = count * WASI_CONSOLE_ABI.eventBytes;
		const spans: readonly [number, number, number][] = [
			[inputPointer, count * WASI_CONSOLE_ABI.subscriptionBytes, 8],
			[outputPointer, outputLength, 8],
			[resultPointer, 4, 4]
		];
		for (const [pointer, bytes, alignment] of spans) {
			const error = spanError(buffer.byteLength, pointer, bytes, alignment);
			if (error) return error;
		}
		if (overlaps(outputPointer, outputLength, resultPointer, 4))
			return WASI_CONSOLE_ERRNO.inval;
		// Snapshot all subscriptions before writing, so overlapping input/output is safe.
		const events: {
			userdata: bigint;
			type: number;
			error: number;
			bytes: number;
			flags: number;
		}[] = [];
		for (let index = 0; index < count; index++) {
			const offset = inputPointer + index * WASI_CONSOLE_ABI.subscriptionBytes;
			const type = view.getUint8(offset + 8);
			if (type === 0) return WASI_CONSOLE_ERRNO.notsup;
			if (type !== WASI_CONSOLE_ABI.fdRead && type !== WASI_CONSOLE_ABI.fdWrite)
				return WASI_CONSOLE_ERRNO.inval;
			const fd = view.getUint32(offset + 16, true);
			const readable = type === WASI_CONSOLE_ABI.fdRead && fd === 0;
			const writable = type === WASI_CONSOLE_ABI.fdWrite && (fd === 1 || fd === 2);
			const available = readable
				? input.byteLength - inputPosition
				: writable
					? maxOutputBytes - outputBytes
					: 0;
			const error =
				readable || writable
					? writable && available === 0
						? WASI_CONSOLE_ERRNO.fbig
						: WASI_CONSOLE_ERRNO.success
					: WASI_CONSOLE_ERRNO.badf;
			events.push({
				userdata: view.getBigUint64(offset, true),
				type,
				error,
				bytes: available,
				flags: readable && available === 0 ? WASI_CONSOLE_ABI.hangup : 0
			});
		}
		// Zero standard padding too. Canary tests require the entire 32-byte allocation.
		new Uint8Array(buffer, outputPointer, outputLength).fill(0);
		for (const [index, event] of events.entries()) {
			const offset = outputPointer + index * WASI_CONSOLE_ABI.eventBytes;
			view.setBigUint64(offset, event.userdata, true);
			view.setUint16(offset + 8, event.error, true);
			view.setUint8(offset + 10, event.type);
			view.setBigUint64(offset + 16, BigInt(event.bytes), true);
			view.setUint16(offset + 24, event.flags, true);
		}
		view.setUint32(resultPointer, events.length, true);
		return WASI_CONSOLE_ERRNO.success;
	};

	return Object.freeze({
		imports: Object.freeze({
			wasi_snapshot_preview1: Object.freeze({ fd_read, fd_write, poll_oneoff })
		}),
		finish() {
			if (!finished) {
				for (const stream of streams) {
					const trailing = stream.decoder.decode();
					if (trailing) stream.chunks.push(trailing);
				}
				finished = Object.freeze({
					stdout: streams[0].chunks.join(''),
					stderr: streams[1].chunks.join(''),
					outputBytes,
					outputLimitExceeded
				});
			}
			return finished;
		}
	});
}
