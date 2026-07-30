import { SharedByteQueue } from './shared-byte-queue.js';
import type {
	DapEvent,
	DapMessage,
	DapRequest,
	DapRequestOptions,
	DapRequestSession,
	DapResponse,
	SharedByteQueueDescriptor
} from './types.js';

const HEADER_SEPARATOR = new TextEncoder().encode('\r\n\r\n');
const CONTENT_LENGTH_PATTERN = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/iu;
const MAXIMUM_DAP_HEADER_BYTES = 8 * 1024;
const MAXIMUM_DAP_BODY_BYTES = 16 * 1024 * 1024;

function concatBytes(left: Uint8Array, right: Uint8Array) {
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array) {
	outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
		for (let offset = 0; offset < needle.byteLength; offset += 1) {
			if (haystack[index + offset] !== needle[offset]) continue outer;
		}
		return index;
	}
	return -1;
}

export function resolveDapTimeout(value: number | undefined, defaultValue: number, label: string) {
	const timeoutMs = value ?? defaultValue;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError(`${label} must be a positive finite timeout in milliseconds`);
	}
	return timeoutMs;
}

export function encodeDapMessage(message: DapMessage): Uint8Array {
	const body = new TextEncoder().encode(JSON.stringify(message));
	const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
	return concatBytes(header, body);
}

export class DapMessageParser {
	private buffer = new Uint8Array();

	push(chunk: Uint8Array): DapMessage[] {
		if (chunk.byteLength > 0) this.buffer = concatBytes(this.buffer, chunk);
		const messages: DapMessage[] = [];

		while (true) {
			const separator = indexOfSequence(this.buffer, HEADER_SEPARATOR);
			if (separator < 0) {
				if (this.buffer.byteLength > MAXIMUM_DAP_HEADER_BYTES) {
					throw new Error('invalid DAP frame: DAP header exceeds 8 KiB');
				}
				break;
			}
			if (separator > MAXIMUM_DAP_HEADER_BYTES) {
				throw new Error('invalid DAP frame: DAP header exceeds 8 KiB');
			}
			const header = new TextDecoder().decode(this.buffer.subarray(0, separator + 2));
			const match = CONTENT_LENGTH_PATTERN.exec(header);
			if (!match) throw new Error('invalid DAP frame: missing Content-Length header');
			const contentLength = Number(match[1]);
			if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
				throw new Error('invalid DAP frame: invalid Content-Length header');
			}
			if (contentLength > MAXIMUM_DAP_BODY_BYTES) {
				throw new Error('invalid DAP frame: DAP body exceeds 16 MiB');
			}
			const bodyStart = separator + HEADER_SEPARATOR.byteLength;
			const frameEnd = bodyStart + contentLength;
			if (this.buffer.byteLength < frameEnd) break;

			const value: unknown = JSON.parse(
				new TextDecoder().decode(this.buffer.subarray(bodyStart, frameEnd))
			);
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new Error('invalid DAP frame body');
			}
			messages.push(value as DapMessage);
			this.buffer = this.buffer.slice(frameEnd);
		}

		return messages;
	}
}

interface PendingRequest {
	command: string;
	resolve: (body: unknown) => void;
	reject: (error: Error) => void;
	sendTimeout?: ReturnType<typeof setTimeout>;
	responseTimeout?: ReturnType<typeof setTimeout>;
}

export interface DapClientOptions {
	input: SharedByteQueueDescriptor;
	output: SharedByteQueueDescriptor;
	requestTimeoutMs?: number;
	transportWriteTimeoutMs?: number;
	/** Receives event-listener exceptions without closing the DAP transport. */
	onEventError?: (error: unknown, event: DapEvent) => void;
}

export class DapClient implements DapRequestSession {
	private readonly input: SharedByteQueue;
	private readonly output: SharedByteQueue;
	private readonly parser = new DapMessageParser();
	private readonly pending = new Map<number, PendingRequest>();
	private readonly eventListeners = new Set<(event: DapEvent) => void>();
	private readonly abortController = new AbortController();
	private readonly requestTimeoutMs: number;
	private readonly transportWriteTimeoutMs: number;
	private readonly onEventError?: DapClientOptions['onEventError'];
	private readLoopPromise?: Promise<void>;
	private writeQueue: Promise<void> = Promise.resolve();
	private sequence = 1;

	constructor(options: DapClientOptions) {
		this.input = new SharedByteQueue(options.input);
		this.output = new SharedByteQueue(options.output);
		this.requestTimeoutMs = resolveDapTimeout(
			options.requestTimeoutMs,
			15_000,
			'requestTimeoutMs'
		);
		this.transportWriteTimeoutMs = resolveDapTimeout(
			options.transportWriteTimeoutMs,
			15_000,
			'transportWriteTimeoutMs'
		);
		this.onEventError = options.onEventError;
	}

	start() {
		if (!this.readLoopPromise) this.readLoopPromise = this.readLoop();
		return this;
	}

	request<TBody = unknown>(
		command: string,
		args?: unknown,
		options: DapRequestOptions = {}
	): Promise<TBody> {
		if (this.abortController.signal.aborted) {
			return Promise.reject(new Error('DAP client is closed'));
		}
		let responseTimeoutMs: number | null;
		try {
			responseTimeoutMs =
				options.responseTimeoutMs === null
					? null
					: resolveDapTimeout(
							options.responseTimeoutMs,
							this.requestTimeoutMs,
							'responseTimeoutMs'
						);
		} catch (error) {
			return Promise.reject(error);
		}
		const seq = this.sequence;
		this.sequence += 1;
		const request: DapRequest = {
			seq,
			type: 'request',
			command,
			...(args === undefined ? {} : { arguments: args })
		};

		const response = new Promise<TBody>((resolve, reject) => {
			const pending: PendingRequest = {
				command,
				resolve: (body) => resolve(body as TBody),
				reject
			};
			this.pending.set(seq, pending);
			pending.sendTimeout = setTimeout(() => {
				if (this.pending.get(seq) !== pending) return;
				this.fail(new Error(`DAP request send timed out: ${command}`));
			}, this.transportWriteTimeoutMs);
		});
		const frame = encodeDapMessage(request);
		const write = this.writeQueue.then(() =>
			this.input.write(frame, this.abortController.signal)
		);
		this.writeQueue = write.catch(() => undefined);
		void write.then(
			() => {
				const pending = this.pending.get(seq);
				if (!pending) return;
				if (pending.sendTimeout !== undefined) clearTimeout(pending.sendTimeout);
				pending.sendTimeout = undefined;
				if (responseTimeoutMs !== null) {
					pending.responseTimeout = setTimeout(() => {
						this.pending.delete(seq);
						pending.reject(new Error(`DAP request timed out: ${command}`));
					}, responseTimeoutMs);
				}
			},
			(error: unknown) => {
				this.fail(
					error instanceof Error
						? error
						: new Error(`failed to send DAP request: ${command}`)
				);
			}
		);
		return response;
	}

	onEvent(listener: (event: DapEvent) => void) {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	async close(error = new Error('DAP client closed')) {
		this.fail(error);
		await Promise.all([
			this.readLoopPromise?.catch(() => undefined) ?? Promise.resolve(),
			this.writeQueue
		]);
	}

	private async readLoop() {
		const chunk = new Uint8Array(16 * 1024);
		try {
			while (!this.abortController.signal.aborted) {
				const length = await this.output.read(chunk, this.abortController.signal);
				if (length === 0) {
					this.fail(new Error('DAP response transport closed'));
					break;
				}
				for (const message of this.parser.push(chunk.slice(0, length))) {
					this.handleMessage(message);
				}
			}
		} catch (error) {
			if (!this.abortController.signal.aborted) {
				this.fail(
					error instanceof Error ? error : new Error('failed to read DAP transport')
				);
			}
		}
	}

	private fail(error: Error) {
		if (!this.abortController.signal.aborted) this.abortController.abort(error);
		if (!this.input.closed) this.input.close();
		if (!this.output.closed) this.output.close();
		for (const pending of this.pending.values()) {
			if (pending.sendTimeout !== undefined) clearTimeout(pending.sendTimeout);
			if (pending.responseTimeout !== undefined) clearTimeout(pending.responseTimeout);
			pending.reject(error);
		}
		this.pending.clear();
	}

	private handleMessage(message: DapMessage) {
		if (message.type === 'event') {
			for (const listener of this.eventListeners) {
				try {
					listener(message);
				} catch (error) {
					try {
						this.onEventError?.(error, message);
					} catch {
						// Consumer error reporting must not close the DAP transport.
					}
				}
			}
			return;
		}
		if (message.type !== 'response') return;
		this.handleResponse(message);
	}

	private handleResponse(response: DapResponse) {
		if (!Number.isSafeInteger(response.request_seq) || response.request_seq <= 0) {
			this.fail(
				new Error('invalid DAP response: request_seq must be a positive safe integer')
			);
			return;
		}
		if (typeof response.command !== 'string' || response.command.length === 0) {
			this.fail(new Error('invalid DAP response: command must be a non-empty string'));
			return;
		}
		if (typeof response.success !== 'boolean') {
			this.fail(new Error('invalid DAP response: success must be a boolean'));
			return;
		}
		const pending = this.pending.get(response.request_seq);
		if (!pending) return;
		if (response.command !== pending.command) {
			this.fail(
				new Error(
					`DAP response command mismatch: expected ${pending.command}, received ${response.command}`
				)
			);
			return;
		}
		this.pending.delete(response.request_seq);
		if (pending.sendTimeout !== undefined) clearTimeout(pending.sendTimeout);
		if (pending.responseTimeout !== undefined) clearTimeout(pending.responseTimeout);
		if (!response.success) {
			pending.reject(new Error(response.message || `DAP request failed: ${pending.command}`));
			return;
		}
		pending.resolve(response.body);
	}
}
