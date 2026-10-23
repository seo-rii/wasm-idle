import type { Message } from 'vscode-jsonrpc';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** Raw Content-Length framing; no Lean syntax or language features are implemented here. */
export function frameMessage(message: Message): Uint8Array {
	const content = encoder.encode(JSON.stringify(message));
	if (content.length > MAX_MESSAGE_BYTES) throw new Error('Lean LSP message exceeds 8 MiB.');
	const header = encoder.encode(`Content-Length: ${content.length}\r\n\r\n`);
	const frame = new Uint8Array(header.length + content.length);
	frame.set(header);
	frame.set(content, header.length);
	return frame;
}

export class LspFrameDecoder {
	private pending = new Uint8Array();
	private contentLength: number | undefined;

	push(chunk: Uint8Array): Message[] {
		const pending = new Uint8Array(this.pending.length + chunk.length);
		pending.set(this.pending);
		pending.set(chunk, this.pending.length);
		this.pending = pending;
		const messages: Message[] = [];
		while (true) {
			if (this.contentLength === undefined) {
				let end = -1;
				for (let i = 0; i + 3 < this.pending.length; i++) {
					if (
						this.pending[i] === 13 &&
						this.pending[i + 1] === 10 &&
						this.pending[i + 2] === 13 &&
						this.pending[i + 3] === 10
					) {
						end = i;
						break;
					}
				}
				if (end < 0) {
					if (this.pending.length > 8192)
						throw new Error('Lean LSP header exceeds 8 KiB.');
					break;
				}
				const header = decoder.decode(this.pending.subarray(0, end));
				const lengths = header
					.split('\r\n')
					.map((line) => /^Content-Length: ([0-9]+)$/i.exec(line))
					.filter((match) => match !== null);
				if (end > 8192 || lengths.length !== 1) throw new Error('Invalid Lean LSP header.');
				const length = Number(lengths[0][1]);
				if (!Number.isSafeInteger(length) || length < 1 || length > MAX_MESSAGE_BYTES)
					throw new Error('Invalid Lean LSP content length.');
				this.contentLength = length;
				this.pending = this.pending.slice(end + 4);
			}
			if (this.pending.length < this.contentLength) break;
			const message: Message = JSON.parse(
				decoder.decode(this.pending.subarray(0, this.contentLength))
			);
			if (!message || message.jsonrpc !== '2.0')
				throw new Error('Invalid Lean JSON-RPC message.');
			messages.push(message);
			this.pending = this.pending.slice(this.contentLength);
			this.contentLength = undefined;
		}
		return messages;
	}
}

/** Bounded synchronous stdin for the original Wasm process and its pthreads. */
export class LeanStdin {
	readonly capacity = MAX_MESSAGE_BYTES + 8192;
	readonly buffer = new SharedArrayBuffer(16 + this.capacity);
	readonly descriptor = { buffer: this.buffer, capacity: this.capacity };
	private readonly control = new Int32Array(this.buffer, 0, 4);
	private readonly bytes = new Uint8Array(this.buffer, 16);
	private readonly range = Math.floor(2 ** 32 / this.capacity) * this.capacity;

	write(message: Message) {
		if (Atomics.load(this.control, 2)) throw new Error('Lean process stdin is closed.');
		const frame = frameMessage(message);
		const write = Atomics.load(this.control, 0) >>> 0;
		const read = Atomics.load(this.control, 1) >>> 0;
		const used = (write - read + this.range) % this.range;
		if (frame.length > this.capacity - used)
			throw new Error('Lean process stdin buffer is full.');
		const offset = write % this.capacity;
		const first = Math.min(frame.length, this.capacity - offset);
		this.bytes.set(frame.subarray(0, first), offset);
		this.bytes.set(frame.subarray(first), 0);
		Atomics.store(this.control, 0, (write + frame.length) % this.range);
		Atomics.notify(this.control, 0);
	}

	close() {
		Atomics.store(this.control, 2, 1);
		Atomics.notify(this.control, 0);
	}
}
