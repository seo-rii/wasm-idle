import { describe, expect, it } from 'vitest';
import {
	flushBufferedEof,
	flushQueuedStdin,
	readBufferedStdin,
	resetBufferedStdin
} from './stdinBuffer';

describe('stdinBuffer', () => {
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
