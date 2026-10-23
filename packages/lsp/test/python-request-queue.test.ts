import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPythonRequestQueue } from '../src/python/request-queue.js';

afterEach(() => vi.useRealTimers());
const change = (uri: string, version: number) => ({
	jsonrpc: '2.0',
	method: 'textDocument/didChange',
	params: { textDocument: { uri, version }, contentChanges: [{ text: String(version) }] }
});
const request = (id: number, method = 'textDocument/completion', uri = 'file:///main.py') => ({
	jsonrpc: '2.0',
	id,
	method,
	params: { textDocument: { uri } }
});

describe('Python request scheduling', () => {
	it('coalesces full snapshots and retires old features before entering Python', () => {
		vi.useFakeTimers();
		const deliver = vi.fn(),
			emit = vi.fn();
		const queue = createPythonRequestQueue(deliver, emit);
		for (let version = 1; version <= 100; version++) {
			queue.push(change('file:///main.py', version));
			queue.push(request(version));
		}
		vi.runAllTimers();
		expect(deliver.mock.calls.map(([message]) => message)).toEqual([
			change('file:///main.py', 100),
			request(100)
		]);
		expect(emit).toHaveBeenCalledTimes(99);
		expect(emit).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: null });
	});

	it('yields between requests, cancels queued work, and invalidates imported dependencies', () => {
		vi.useFakeTimers();
		const deliver = vi.fn(),
			emit = vi.fn();
		const queue = createPythonRequestQueue(deliver, emit);
		queue.push(request(1));
		queue.push(request(2, 'textDocument/hover'));
		vi.advanceTimersToNextTimer();
		expect(deliver).toHaveBeenCalledTimes(1);
		queue.push(change('file:///dependency.py', 2));
		queue.push(request(3));
		queue.push({ method: '$/cancelRequest', params: { id: 3 } });
		vi.runAllTimers();
		expect(deliver.mock.calls.map(([message]) => message.method)).toEqual([
			'textDocument/completion',
			'textDocument/didChange'
		]);
		expect(emit.mock.calls.map(([message]) => message.id).sort()).toEqual([2, 3]);
	});

	it('preserves document lifecycle and incremental change barriers', () => {
		vi.useFakeTimers();
		const deliver = vi.fn();
		const queue = createPythonRequestQueue(deliver, vi.fn());
		const messages = [
			change('file:///main.py', 1),
			{
				method: 'textDocument/didSave',
				params: { textDocument: { uri: 'file:///main.py' } }
			},
			change('file:///main.py', 2),
			{
				...change('file:///main.py', 3),
				params: {
					textDocument: { uri: 'file:///main.py', version: 3 },
					contentChanges: [{ text: 'x', range: { start: {}, end: {} } }]
				}
			},
			change('file:///main.py', 4)
		];
		messages.forEach(queue.push);
		queue.push({ method: '$/cancelRequest' });
		vi.runAllTimers();
		expect(deliver.mock.calls.map(([message]) => message)).toEqual(messages);
	});
});
