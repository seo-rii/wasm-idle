import { createWasmIdleSharedBuffer, isSharedBufferBackedView } from './sharedBuffer';

const HEADER_BYTES = 16;
const COMMAND_BYTES = 65_536;
const MAX_QUEUED_COMMANDS = 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** One published command plus a bounded UI queue; consumption wakes the next producer write. */
export class DebugCommandMailbox {
	readonly buffer = createWasmIdleSharedBuffer(HEADER_BYTES + COMMAND_BYTES);
	private queued: Uint8Array[] = [];
	constructor(private readonly label = 'Lua') {}

	reset() {
		this.queued = [];
		new Int32Array(this.buffer, 0, 4).fill(0);
	}

	send(command: string) {
		const header = new Int32Array(this.buffer, 0, 4);
		if (!isSharedBufferBackedView(header))
			throw new Error(`${this.label} debugging requires SharedArrayBuffer.`);
		if (Atomics.load(header, 2)) throw new Error(`${this.label} debugger is closed.`);
		const bytes = encoder.encode(command);
		if (!bytes.length || bytes.length > COMMAND_BYTES) {
			throw new RangeError(
				`${this.label} debugger commands must contain 1–${COMMAND_BYTES} UTF-8 bytes.`
			);
		}
		if (this.queued.length >= MAX_QUEUED_COMMANDS)
			throw new Error(`${this.label} debugger command queue is full.`);
		this.queued.push(bytes);
		this.flush();
	}

	flush() {
		const header = new Int32Array(this.buffer, 0, 4);
		if (!this.queued.length || Atomics.load(header, 1) !== 0 || Atomics.load(header, 2)) return;
		const bytes = this.queued.shift()!;
		new Uint8Array(this.buffer, HEADER_BYTES, bytes.length).set(bytes);
		Atomics.store(header, 1, bytes.length);
		Atomics.add(header, 0, 1);
		Atomics.notify(header, 0);
	}

	close() {
		this.queued = [];
		const header = new Int32Array(this.buffer, 0, 4);
		if (!isSharedBufferBackedView(header)) return;
		Atomics.store(header, 2, 1);
		Atomics.add(header, 0, 1);
		Atomics.notify(header, 0);
	}
}

export function readDebugCommand(
	buffer: SharedArrayBuffer,
	blocking: boolean,
	onConsumed: () => void,
	label = 'Lua'
): string | null {
	const header = new Int32Array(buffer, 0, 4);
	if (!isSharedBufferBackedView(header) || buffer.byteLength !== HEADER_BYTES + COMMAND_BYTES) {
		throw new Error(`Invalid ${label} debugger command buffer.`);
	}
	for (;;) {
		const sequence = Atomics.load(header, 0);
		if (Atomics.load(header, 2)) return null;
		const size = Atomics.load(header, 1);
		if (size < 0 || size > COMMAND_BYTES)
			throw new Error(`Invalid ${label} debugger command length.`);
		if (size) {
			// Browser TextDecoder rejects shared views; copy while this slot is owned by the reader.
			const command = decoder.decode(new Uint8Array(buffer, HEADER_BYTES, size).slice());
			Atomics.store(header, 1, 0);
			onConsumed();
			return command;
		}
		if (!blocking) return '';
		Atomics.wait(header, 0, sequence);
	}
}
