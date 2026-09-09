import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorLanguageServerTransport } from '../src/types.js';
import { createClangdRequestPolicy } from '../src/clangd/request-policy.js';

function setup() {
	let receive: (message: any) => void = () => {};
	const write = vi.fn(async (_message: any) => {});
	const transport = {
		reader: {
			listen: (callback: any) => {
				receive = callback;
				return { dispose() {} };
			},
			dispose() {}
		},
		writer: { write, end() {}, dispose() {} }
	} as unknown as EditorLanguageServerTransport;
	const onDelay = vi.fn();
	const policy = createClangdRequestPolicy(transport, {
		requestTimeoutMs: 100,
		initializeTimeoutMs: 1000,
		onDelay
	});
	const received = vi.fn();
	policy.transport.reader.listen(received);
	return { policy, write, receive: (message: any) => receive(message), received, onDelay };
}
const open = {
	jsonrpc: '2.0',
	method: 'textDocument/didOpen',
	params: { textDocument: { uri: 'file:///workspace/main.cpp', version: 1 } }
};
const hover = {
	jsonrpc: '2.0',
	id: 1,
	method: 'textDocument/hover',
	params: {
		textDocument: { uri: 'file:///workspace/main.cpp' },
		position: { line: 0, character: 4 }
	}
};

afterEach(() => vi.useRealTimers());
describe('clangd request policy', () => {
	it('settles an unresponsive feature, cancels it, and keeps the server usable', async () => {
		vi.useFakeTimers();
		const { policy, write, receive, received, onDelay } = setup();
		await policy.transport.writer.write(open);
		await policy.transport.writer.write(hover);
		await vi.advanceTimersByTimeAsync(100);
		expect(received).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 1,
				result: null
			})
		);
		expect(write).toHaveBeenCalledWith(
			expect.objectContaining({ method: '$/cancelRequest', params: { id: 1 } })
		);
		expect(onDelay).toHaveBeenCalledWith('textDocument/hover');
		receive({ jsonrpc: '2.0', id: 1, result: { contents: 'late' } });
		expect(received).toHaveBeenCalledTimes(1);
		await policy.transport.writer.write({ ...hover, id: 2 });
		receive({ jsonrpc: '2.0', id: 2, result: { contents: 'fresh' } });
		expect(received).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: 2, result: { contents: 'fresh' } })
		);
		policy.dispose();
	});
	it('invalidates pending hints and diagnostics when the document changes', async () => {
		vi.useFakeTimers();
		const { policy, receive, received } = setup();
		await policy.transport.writer.write(open);
		await policy.transport.writer.write({ ...hover, method: 'textDocument/inlayHint' });
		await policy.transport.writer.write({
			...open,
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri: open.params.textDocument.uri, version: 2 },
				contentChanges: [{ text: 'int n;' }]
			}
		});
		expect(received).toHaveBeenCalledWith(expect.objectContaining({ id: 1, result: null }));
		received.mockClear();
		receive({ jsonrpc: '2.0', id: 1, result: [{ label: 'old' }] });
		receive({
			jsonrpc: '2.0',
			method: 'textDocument/publishDiagnostics',
			params: { uri: open.params.textDocument.uri, version: 1, diagnostics: [] }
		});
		expect(received).not.toHaveBeenCalled();
		expect(policy.trace.find((entry) => entry.requestId === 1)).toMatchObject({
			version: 1,
			outcome: 'stale',
			finishedAt: expect.any(Number)
		});
		policy.dispose();
	});
	it('supersedes hover requests while giving initialize its own deadline', async () => {
		vi.useFakeTimers();
		const { policy, received } = setup();
		await policy.transport.writer.write({ jsonrpc: '2.0', id: 10, method: 'initialize' });
		await policy.transport.writer.write(open);
		await policy.transport.writer.write(hover);
		await policy.transport.writer.write({ ...hover, id: 2 });
		expect(received).toHaveBeenCalledWith(expect.objectContaining({ id: 1, result: null }));
		await vi.advanceTimersByTimeAsync(100);
		expect(received.mock.calls.some(([message]) => message.id === 10)).toBe(false);
		policy.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('bounds hint resolution and rejects a saved hint after its document changes', async () => {
		vi.useFakeTimers();
		const { policy, receive, received, write, onDelay } = setup();
		const hint = { position: { line: 0, character: 4 }, label: ': int', data: 'hint-1' };
		await policy.transport.writer.write(open);
		await policy.transport.writer.write({ ...hover, method: 'textDocument/inlayHint' });
		receive({ jsonrpc: '2.0', id: 1, result: [hint] });
		const resolve = { jsonrpc: '2.0', id: 2, method: 'inlayHint/resolve', params: hint };
		await policy.transport.writer.write(resolve);
		await vi.advanceTimersByTimeAsync(100);
		expect(received).toHaveBeenLastCalledWith(
			expect.objectContaining({
				id: 2,
				result: hint
			})
		);
		expect(onDelay).toHaveBeenLastCalledWith('inlayHint/resolve');
		await policy.transport.writer.write({
			...open,
			method: 'textDocument/didChange',
			params: { textDocument: { ...open.params.textDocument, version: 2 } }
		});
		write.mockClear();
		await policy.transport.writer.write({ ...resolve, id: 3 });
		expect(write).not.toHaveBeenCalledWith(
			expect.objectContaining({ method: 'inlayHint/resolve' })
		);
		expect(received).toHaveBeenLastCalledWith(expect.objectContaining({ id: 3, result: hint }));
		expect(policy.trace.find((entry) => entry.requestId === 3)).toMatchObject({
			uri: open.params.textDocument.uri,
			version: 1,
			outcome: 'stale'
		});
		policy.dispose();
	});
	it('cancels cursor-dependent requests without cancelling visible-range hints', async () => {
		vi.useFakeTimers();
		const { policy, receive, received } = setup();
		await policy.transport.writer.write(open);
		await policy.transport.writer.write(hover);
		await policy.transport.writer.write({ ...hover, id: 2, method: 'textDocument/inlayHint' });
		policy.cancelEditorRequests();
		expect(received).toHaveBeenCalledTimes(1);
		expect(received).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1, result: null }));
		receive({ jsonrpc: '2.0', id: 2, result: [] });
		expect(received).toHaveBeenLastCalledWith({ jsonrpc: '2.0', id: 2, result: [] });
		policy.dispose();
	});
	it('settles providers before didOpen and passes later provider requests to clangd', async () => {
		const { policy, write, received } = setup();
		const codeAction = { ...hover, method: 'textDocument/codeAction' };
		await policy.transport.writer.write(codeAction);
		expect(write).not.toHaveBeenCalled();
		expect(received).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: null });
		await policy.transport.writer.write(open);
		await policy.transport.writer.write({ ...codeAction, id: 2 });
		expect(write).toHaveBeenLastCalledWith({ ...codeAction, id: 2 });
		policy.dispose();
	});
	it.each([-32800, -32801, -32802])(
		'settles server cancellation %s without a provider error',
		async (code) => {
			const { policy, receive, received, write } = setup();
			await policy.transport.writer.write(open);
			await policy.transport.writer.write({ ...hover, method: 'textDocument/documentLink' });
			receive({ jsonrpc: '2.0', id: 1, error: { code, message: 'Task was cancelled.' } });
			expect(received).toHaveBeenLastCalledWith({ jsonrpc: '2.0', id: 1, result: null });
			expect(policy.trace.find((entry) => entry.requestId === 1)?.outcome).toBe(
				code === -32801 ? 'stale' : 'cancelled'
			);
			expect(write).not.toHaveBeenCalledWith(
				expect.objectContaining({ method: '$/cancelRequest' })
			);
			policy.dispose();
		}
	);
	it('preserves real server errors and the initialize failure deadline', async () => {
		vi.useFakeTimers();
		const { policy, receive, received } = setup();
		await policy.transport.writer.write(open);
		await policy.transport.writer.write(hover);
		const error = { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } };
		receive(error);
		expect(received).toHaveBeenLastCalledWith(error);
		await policy.transport.writer.write({ jsonrpc: '2.0', id: 2, method: 'initialize' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(received).toHaveBeenLastCalledWith({
			jsonrpc: '2.0',
			id: 2,
			error: { code: -32800, message: 'initialize timeout' }
		});
		policy.dispose();
	});
});
