import { afterEach, expect, it, vi } from 'vitest';
import { createJavaOutput } from './javaOutput';

afterEach(() => vi.useRealTimers());

it('bounds large newline-free output and batches many short lines', () => {
	vi.useFakeTimers();
	const messages: string[] = [];
	const output = createJavaOutput((text) => messages.push(text), { now: () => 0 });
	const text = 'x\n'.repeat(10000) + 'a'.repeat(100000);
	for (let i = 0; i < text.length; i++) output.write(text.charCodeAt(i));
	output.close();
	expect(messages.join('')).toBe(text);
	expect(messages.length).toBeLessThan(12);
	expect(Math.max(...messages.map((value) => value.length))).toBeLessThanOrEqual(16384);
});

it('publishes first output and explicit flush before synchronous work continues', () => {
	vi.useFakeTimers();
	const messages: string[] = [];
	const output = createJavaOutput((text) => messages.push(text), { now: () => 0 });
	output.write(65);
	expect(messages).toEqual(['A']);
	output.write(66);
	output.flush();
	expect(messages).toEqual(['A', 'B']);
	output.close();
	vi.runAllTimers();
	expect(messages).toEqual(['A', 'B']);
});

it('checks elapsed time during writes when the event loop cannot run timers', () => {
	vi.useFakeTimers();
	let time = 0;
	const messages: string[] = [];
	const output = createJavaOutput((text) => messages.push(text), { now: () => time });
	output.write(65);
	output.write(66);
	time = 17;
	output.write(67);
	expect(messages).toEqual(['A', 'BC']);
	output.close();
});

it('polls pending output deadlines without flushing early or checking the clock when empty', () => {
	vi.useFakeTimers();
	let time = 0;
	const now = vi.fn(() => time);
	const messages: string[] = [];
	const output = createJavaOutput((text) => messages.push(text), { now });
	for (const char of 'loop-ready\n') output.write(char.charCodeAt(0));
	for (time = 1; time < 16; time++) output.flushIfDue();
	expect(messages).toEqual(['l']);
	output.flushIfDue();
	expect(messages).toEqual(['l', 'oop-ready\n']);
	expect(vi.getTimerCount()).toBe(0);
	now.mockClear();
	for (let i = 0; i < 1000; i++) output.flushIfDue();
	expect(now).not.toHaveBeenCalled();
	output.close();
});

it('retains surrogate pairs across chunk boundaries and drains timers on close', () => {
	vi.useFakeTimers();
	const messages: string[] = [];
	const output = createJavaOutput((text) => messages.push(text), { maxChars: 4, now: () => 0 });
	const text = '한🙂ab🙂🙂끝';
	for (let i = 0; i < text.length; i++) output.write(text.charCodeAt(i));
	output.close();
	vi.runAllTimers();
	expect(messages.join('')).toBe(text);
	const encoder = new TextEncoder();
	expect(messages.reduce((n, value) => n + encoder.encode(value).length, 0)).toBe(
		encoder.encode(text).length
	);
	expect(messages.every((value) => value.length <= 4)).toBe(true);
});
