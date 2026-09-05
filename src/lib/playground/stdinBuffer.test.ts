import { describe, expect, it } from 'vitest';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	readBufferedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from './stdinBuffer';

describe('stdinBuffer', () => {
	it('preserves Unicode and EOF at every payload boundary', () => {
		const unicode = ['한글', '😀', '𠀀', 'e\u0301', '👩‍👩‍👧‍👦'];
		for (const size of [12, 16, 20, 32, 64, 1024]) {
			for (let prefix = 0; prefix <= size; prefix += 1) {
				for (const suffix of unicode) {
					const input = `${'a'.repeat(prefix)}${suffix}Z\n`;
					const queue = [input];
					const buffer = new SharedArrayBuffer(size);
					const chunks: string[] = [];
					for (let count = 0; queue.length && count <= input.length; count += 1) {
						expect(flushQueuedStdin(queue, buffer)).toBe(true);
						chunks.push(readBufferedStdin(buffer)!);
					}
					expect(queue).toEqual([]);
					expect(chunks.join('')).toBe(input);
					flushBufferedEof(buffer);
					expect(readBufferedStdin(buffer)).toBeNull();
				}
			}
		}
	});

	it('notifies readers for split input and the following EOF', async () => {
		const buffer = new SharedArrayBuffer(16);
		const queue = ['abcde😀Z'];
		let waiting = waitForBufferedSequenceChange(buffer, bufferedSequence(buffer));
		flushQueuedStdin(queue, buffer);
		await expect(waiting).resolves.toBe('abcde');
		waiting = waitForBufferedSequenceChange(buffer, bufferedSequence(buffer));
		flushQueuedStdin(queue, buffer);
		await expect(waiting).resolves.toBe('😀Z');
		waiting = waitForBufferedSequenceChange(buffer, bufferedSequence(buffer));
		flushBufferedEof(buffer);
		await expect(waiting).resolves.toBeNull();
	});

	it('rejects a payload with no room for a character without publishing empty chunks', () => {
		const buffer = new SharedArrayBuffer(8);
		const queue = ['😀'];
		expect(() => flushQueuedStdin(queue, buffer)).toThrow(RangeError);
		expect(queue).toEqual(['😀']);
		expect(bufferedSequence(buffer)).toBe(0);
	});

	it('encodes and decodes queued stdin chunks', () => {
		const buffer = new SharedArrayBuffer(64);
		const queue = ['hello\n'];

		expect(flushQueuedStdin(queue, buffer)).toBe(true);
		expect(queue).toEqual([]);
		expect(readBufferedStdin(buffer)).toBe('hello\n');
	});

	it('splits oversized unicode chunks without corrupting characters', () => {
		const buffer = new SharedArrayBuffer(16);
		const queue = ['가나다abc'];

		expect(flushQueuedStdin(queue, buffer)).toBe(true);
		expect(readBufferedStdin(buffer)).toBe('가나');
		expect(queue).toEqual(['다abc']);
		expect(flushQueuedStdin(queue, buffer)).toBe(true);
		expect(readBufferedStdin(buffer)).toBe('다abc');
		expect(queue).toEqual([]);
	});

	it('resets buffered stdin metadata and payload', () => {
		const buffer = new SharedArrayBuffer(32);
		const queue = ['done'];

		flushQueuedStdin(queue, buffer);
		resetBufferedStdin(buffer);

		expect(readBufferedStdin(buffer)).toBe('');
	});

	it('encodes EOF as a null read result', () => {
		const buffer = new SharedArrayBuffer(32);

		flushBufferedEof(buffer);

		expect(readBufferedStdin(buffer)).toBeNull();
	});
});
