import { describe, expect, it, vi } from 'vitest';

import { DapClient, DapMessageParser, encodeDapMessage } from '../src/dap-client.js';
import { SharedByteQueue, createSharedByteQueue } from '../src/shared-byte-queue.js';
import type { DapEvent, DapRequest, DapResponse } from '../src/types.js';

describe('DAP framing', () => {
	it('parses fragmented and coalesced UTF-8 frames', () => {
		const first: DapEvent = {
			seq: 1,
			type: 'event',
			event: 'output',
			body: { output: '한글\n' }
		};
		const second: DapEvent = {
			seq: 2,
			type: 'event',
			event: 'stopped',
			body: { reason: 'breakpoint' }
		};
		const bytes = new Uint8Array([...encodeDapMessage(first), ...encodeDapMessage(second)]);
		const parser = new DapMessageParser();
		expect(parser.push(bytes.subarray(0, 11))).toEqual([]);
		expect(parser.push(bytes.subarray(11, 37))).toEqual([]);
		expect(parser.push(bytes.subarray(37))).toEqual([first, second]);
	});

	it('rejects frames without a content length', () => {
		const parser = new DapMessageParser();
		expect(() => parser.push(new TextEncoder().encode('Other: 1\r\n\r\n{}'))).toThrow(
			/Content-Length/u
		);
	});
});

describe('DapClient', () => {
	it.each([
		['requestTimeoutMs', 0],
		['requestTimeoutMs', -1],
		['requestTimeoutMs', Number.NaN],
		['requestTimeoutMs', Number.POSITIVE_INFINITY],
		['transportWriteTimeoutMs', 0],
		['transportWriteTimeoutMs', -1],
		['transportWriteTimeoutMs', Number.NaN],
		['transportWriteTimeoutMs', Number.POSITIVE_INFINITY]
	] as const)('rejects invalid %s value %s', (option, value) => {
		const input = createSharedByteQueue(4096, 30);
		const output = createSharedByteQueue(4096, 30);

		expect(
			() =>
				new DapClient({
					input,
					output,
					[option]: value
				})
		).toThrow(/positive finite timeout/u);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid per-request response timeout %s before sending',
		async (responseTimeoutMs) => {
			const inputDescriptor = createSharedByteQueue(4096, 31);
			const outputDescriptor = createSharedByteQueue(4096, 31);
			const input = new SharedByteQueue(inputDescriptor);
			const client = new DapClient({
				input: inputDescriptor,
				output: outputDescriptor,
				requestTimeoutMs: 1_000
			}).start();

			try {
				await expect(
					client.request('threads', undefined, { responseTimeoutMs })
				).rejects.toThrow(/positive finite timeout/u);
				expect(input.available).toBe(0);
			} finally {
				await client.close();
			}
		}
	);

	it('correlates responses and forwards events over partial shared-ring reads', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 3);
		const outputDescriptor = createSharedByteQueue(4096, 3);
		const input = new SharedByteQueue(inputDescriptor);
		const output = new SharedByteQueue(outputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000
		}).start();
		const events: DapEvent[] = [];
		client.onEvent((event) => events.push(event));

		const resultPromise = client.request<{ threads: unknown[] }>('threads');
		const parser = new DapMessageParser();
		const chunk = new Uint8Array(13);
		let request: DapRequest | undefined;
		while (!request) {
			const length = await input.read(chunk);
			for (const message of parser.push(chunk.slice(0, length))) {
				if (message.type === 'request') request = message;
			}
		}
		const event: DapEvent = {
			seq: 10,
			type: 'event',
			event: 'continued',
			body: { threadId: 1 }
		};
		const response: DapResponse = {
			seq: 11,
			type: 'response',
			request_seq: request.seq,
			command: request.command,
			success: true,
			body: { threads: [] }
		};
		await output.write(
			new Uint8Array([...encodeDapMessage(event), ...encodeDapMessage(response)])
		);

		await expect(resultPromise).resolves.toEqual({ threads: [] });
		expect(events).toEqual([event]);
		await client.close();
	});

	it('allows execution requests to wait without a response timeout', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 9);
		const outputDescriptor = createSharedByteQueue(4096, 9);
		const input = new SharedByteQueue(inputDescriptor);
		const output = new SharedByteQueue(outputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 25
		}).start();
		const resultPromise = client.request(
			'continue',
			{ threadId: 1 },
			{ responseTimeoutMs: null }
		);
		let settlement: 'pending' | 'resolved' | 'rejected' = 'pending';
		void resultPromise.then(
			() => {
				settlement = 'resolved';
			},
			() => {
				settlement = 'rejected';
			}
		);
		const chunk = new Uint8Array(256);
		const length = await input.read(chunk);
		const [request] = new DapMessageParser().push(chunk.slice(0, length)) as [DapRequest];

		try {
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(settlement).toBe('pending');
			await output.write(
				encodeDapMessage({
					seq: 12,
					type: 'response',
					request_seq: request.seq,
					command: request.command,
					success: true,
					body: { allThreadsContinued: true }
				})
			);
			await expect(resultPromise).resolves.toEqual({ allThreadsContinued: true });
		} finally {
			await client.close();
		}
	});

	it('surfaces adapter failures', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 4);
		const outputDescriptor = createSharedByteQueue(4096, 4);
		const input = new SharedByteQueue(inputDescriptor);
		const output = new SharedByteQueue(outputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000
		}).start();
		const requestPromise = client.request('evaluate', { expression: 'foo + bar' });
		const chunk = new Uint8Array(256);
		const length = await input.read(chunk);
		const [request] = new DapMessageParser().push(chunk.slice(0, length)) as [DapRequest];
		await output.write(
			encodeDapMessage({
				seq: 2,
				type: 'response',
				request_seq: request.seq,
				command: request.command,
				success: false,
				message: 'expression evaluation is unavailable'
			})
		);
		await expect(requestPromise).rejects.toThrow(/expression evaluation is unavailable/u);
		await client.close();
	});

	it('fails the DAP stream when a response command does not match its request', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 32);
		const outputDescriptor = createSharedByteQueue(4096, 32);
		const input = new SharedByteQueue(inputDescriptor);
		const output = new SharedByteQueue(outputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000
		}).start();
		const requestPromise = client.request('threads');
		const chunk = new Uint8Array(256);
		const length = await input.read(chunk);
		const [request] = new DapMessageParser().push(chunk.slice(0, length)) as [DapRequest];

		try {
			await output.write(
				encodeDapMessage({
					seq: 15,
					type: 'response',
					request_seq: request.seq,
					command: 'stackTrace',
					success: true,
					body: { threads: [] }
				})
			);
			await expect(requestPromise).rejects.toThrow(/response command mismatch/u);
			expect(input.closed).toBe(true);
			expect(output.closed).toBe(true);
		} finally {
			await client.close();
		}
	});

	it('rejects immediately when the request transport is closed', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 5);
		const outputDescriptor = createSharedByteQueue(4096, 5);
		new SharedByteQueue(inputDescriptor).close();
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000
		}).start();

		await expect(client.request('threads')).rejects.toThrow(/closed/u);
		await client.close();
	});

	it('rejects pending requests when the response transport closes', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 6);
		const outputDescriptor = createSharedByteQueue(4096, 6);
		const output = new SharedByteQueue(outputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000
		}).start();

		const request = client.request('threads');
		output.close();

		await expect(request).rejects.toThrow(/response transport closed/u);
		await client.close();
	});

	it('serializes complete request frames before starting response timeouts', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 7);
		const outputDescriptor = createSharedByteQueue(4096, 7);
		const input = new SharedByteQueue(inputDescriptor);
		const output = new SharedByteQueue(outputDescriptor);
		const originalWrite = SharedByteQueue.prototype.write;
		let releaseFirstWrite!: () => void;
		const firstWriteGate = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve;
		});
		let resolveSecondWrite!: () => void;
		const secondWrite = new Promise<void>((resolve) => {
			resolveSecondWrite = resolve;
		});
		let inputWrites = 0;
		const write = vi
			.spyOn(SharedByteQueue.prototype, 'write')
			.mockImplementation(function (source, signal) {
				if (this.descriptor !== inputDescriptor) {
					return originalWrite.call(this, source, signal);
				}
				inputWrites += 1;
				const performWrite = () => originalWrite.call(this, source, signal);
				if (inputWrites === 1) return firstWriteGate.then(performWrite);
				const result = performWrite();
				if (inputWrites === 2) void result.then(resolveSecondWrite);
				return result;
			});
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 25
		}).start();

		try {
			let settled = 0;
			const first = client.request('threads');
			const second = client.request('stackTrace', { threadId: 1 });
			void first.then(
				() => {
					settled += 1;
				},
				() => {
					settled += 1;
				}
			);
			void second.then(
				() => {
					settled += 1;
				},
				() => {
					settled += 1;
				}
			);

			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(inputWrites).toBe(1);
			expect(settled).toBe(0);

			releaseFirstWrite();
			await secondWrite;
			const requestBytes = new Uint8Array(input.available);
			expect(input.tryRead(requestBytes)).toBe(requestBytes.byteLength);
			const requests = new DapMessageParser()
				.push(requestBytes)
				.filter((message): message is DapRequest => message.type === 'request');
			expect(requests.map((request) => request.command)).toEqual(['threads', 'stackTrace']);

			await output.write(
				new Uint8Array(
					requests.flatMap((request, index) => [
						...encodeDapMessage({
							seq: index + 10,
							type: 'response',
							request_seq: request.seq,
							command: request.command,
							success: true,
							body: {}
						})
					])
				)
			);
			await expect(first).resolves.toEqual({});
			await expect(second).resolves.toEqual({});
		} finally {
			releaseFirstWrite();
			write.mockRestore();
			await client.close();
		}
	});

	it('closes the DAP stream when request framing remains blocked by backpressure', async () => {
		const inputDescriptor = createSharedByteQueue(4096, 8);
		const outputDescriptor = createSharedByteQueue(4096, 8);
		const input = new SharedByteQueue(inputDescriptor);
		const client = new DapClient({
			input: inputDescriptor,
			output: outputDescriptor,
			requestTimeoutMs: 1_000,
			transportWriteTimeoutMs: 25
		}).start();

		const request = client.request('evaluate', {
			expression: 'value'.repeat(2_000)
		});

		await expect(request).rejects.toThrow(/request send timed out/u);
		expect(input.closed).toBe(true);
		await client.close();
	});
});
