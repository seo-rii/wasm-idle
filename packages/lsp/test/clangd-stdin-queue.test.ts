import { describe, expect, it } from 'vitest';
import { ClangdStdinQueue } from '../src/clangd/stdin-queue.js';

describe('clangd stdin queue', () => {
	it('preserves large UTF-8 messages and chunk boundaries without argument spreading', async () => {
		const queue = new ClangdStdinQueue();
		const bytes = new TextEncoder().encode('한글 // '.repeat(50_000));
		queue.push(bytes);
		queue.push(Uint8Array.of(42, 43));
		await queue.ready();
		const actual = new Uint8Array(bytes.length);
		for (let i = 0; i < actual.length; i++) actual[i] = queue.read()!;
		expect(new TextDecoder().decode(actual)).toBe(new TextDecoder().decode(bytes));
		expect(queue.read()).toBeNull();
		await queue.ready();
		expect(queue.read()).toBe(42);
		expect(queue.read()).toBe(43);
		expect(queue.read()).toBeNull();
	});
	it('reports unread current bytes as ready and wakes empty-queue waiters', async () => {
		const queue = new ClangdStdinQueue();
		let ready = false;
		const waiting = queue.ready().then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(ready).toBe(false);
		queue.push(Uint8Array.of(1, 2));
		await waiting;
		expect(queue.read()).toBe(1);
		await queue.ready();
		expect(queue.read()).toBe(2);
		expect(queue.hasBytes).toBe(false);
	});
	it('keeps libc read-ahead within the frame released by stdinReady', async () => {
		const queue = new ClangdStdinQueue();
		const encodeFrame = (id: number) => {
			const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'shutdown' });
			return new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n${body}`);
		};
		const frames = [encodeFrame(1), encodeFrame(2)];
		for (const frame of frames) queue.push(frame);
		// Emscripten fills libc's FILE buffer with repeated stdin() calls. The
		// producer invokes stdinReady() once per JSONTransport loop, so draining
		// both messages here would strand the second one in libc's private buffer.
		const refillStdio = () => {
			const bytes: number[] = [];
			for (let i = 0; i < 4096; i++) {
				const byte = queue.read();
				if (byte === null) break;
				bytes.push(byte);
			}
			return Uint8Array.from(bytes);
		};
		await queue.ready();
		expect(refillStdio()).toEqual(frames[0]);
		expect(queue.hasBytes).toBe(true);
		await queue.ready();
		expect(refillStdio()).toEqual(frames[1]);
		expect(queue.hasBytes).toBe(false);
	});
});
