import { describe, expect, it } from 'vitest';
import { ClangdStdinQueue } from '../src/clangd/stdin-queue.js';

describe('clangd stdin queue', () => {
	it('preserves large UTF-8 messages and chunk boundaries without argument spreading', () => {
		const queue = new ClangdStdinQueue();
		const bytes = new TextEncoder().encode('한글 // '.repeat(50_000));
		queue.push(bytes);
		queue.push(Uint8Array.of(42, 43));
		const actual = new Uint8Array(bytes.length);
		for (let i = 0; i < actual.length; i++) actual[i] = queue.read()!;
		expect(new TextDecoder().decode(actual)).toBe(new TextDecoder().decode(bytes));
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
});
