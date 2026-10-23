import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createForthLspHost } from '../src/forth/host.js';

vi.mock('../src/forth/host.js', () => ({ createForthLspHost: vi.fn() }));

let send: (message: unknown) => Promise<void>;
let posted: any[];
const dispatch = vi.fn<(message: any) => unknown[]>();
const uri = 'file:///workspace/main.fs';
const siblingUri = 'file:///workspace/library.fs';
const open = (documentUri = uri, version = 1) => ({
	jsonrpc: '2.0',
	method: 'textDocument/didOpen',
	params: { textDocument: { uri: documentUri, version, languageId: 'forth', text: '1 .' } }
});
const change = (documentUri = uri, version = 2) => ({
	jsonrpc: '2.0',
	method: 'textDocument/didChange',
	params: { textDocument: { uri: documentUri, version }, contentChanges: [{ text: '2 .' }] }
});
const hover = {
	jsonrpc: '2.0',
	id: 0,
	method: 'textDocument/hover',
	params: { textDocument: { uri }, position: { line: 0, character: 0 } }
};

beforeEach(async () => {
	vi.resetModules();
	posted = [];
	dispatch.mockReset();
	dispatch.mockReturnValue([]);
	vi.mocked(createForthLspHost).mockResolvedValue({ dispatch });
	vi.stubGlobal(
		'addEventListener',
		(_type: string, listener: (event: MessageEvent) => Promise<void>) => {
			send = (message) => listener(new MessageEvent('message', { data: message }));
		}
	);
	vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
	await import('../src/forth/worker.js');
	await send({ type: 'init', options: { wasmBytes: new Uint8Array() } });
	expect(posted).toContainEqual({ type: 'ready' });
});

afterEach(() => vi.unstubAllGlobals());

it('replays pre-open changes and requests in order only after their document opens', async () => {
	await send(change());
	await send(hover);
	await send(change(siblingUri));
	expect(dispatch).not.toHaveBeenCalled();
	await send(open());
	expect(dispatch.mock.calls.map(([message]) => message)).toEqual([open(), change(), hover]);
	await send(open(siblingUri));
	expect(dispatch.mock.calls.map(([message]) => message)).toEqual([
		open(),
		change(),
		hover,
		open(siblingUri),
		change(siblingUri)
	]);
});

it('does not replay incremental changes already represented by the didOpen snapshot', async () => {
	await send({
		...change(),
		params: {
			...change().params,
			contentChanges: [
				{
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					text: '2 '
				}
			]
		}
	});
	await send(change(uri, 3));
	await send(open(uri, 2));
	expect(dispatch.mock.calls.map(([message]) => message)).toEqual([open(uri, 2), change(uri, 3)]);
});

it('drops a closed document pre-open changes and settles its requests before a new session', async () => {
	await send(change());
	await send(hover);
	await send(change(siblingUri));
	const close = {
		jsonrpc: '2.0',
		method: 'textDocument/didClose',
		params: { textDocument: { uri } }
	};
	await send(close);
	expect(posted).toContainEqual({
		jsonrpc: '2.0',
		id: 0,
		error: { code: -32800, message: 'Document closed before didOpen' }
	});
	await send(open());
	await send(open(siblingUri));
	expect(dispatch.mock.calls.map(([message]) => message)).toEqual([
		close,
		open(),
		open(siblingUri),
		change(siblingUri)
	]);
});

it('cancels a queued request without discarding the preceding document change', async () => {
	await send(change());
	await send(hover);
	await send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 0 } });
	await send(open());
	expect(dispatch.mock.calls.map(([message]) => message)).toEqual([open(), change()]);
	expect(posted.filter((message) => message.id === 0)).toEqual([
		{ jsonrpc: '2.0', id: 0, error: { code: -32800, message: 'Request cancelled' } }
	]);
});

it('reports an upstream notification failure without emitting a response with a missing id', async () => {
	dispatch.mockImplementation((message) => {
		if (message.method === 'textDocument/didChange') throw new Error('notification failed');
		return [];
	});
	await send(change());
	expect(posted).not.toContainEqual({ type: 'error', message: 'notification failed' });
	await send(open());
	expect(posted).toContainEqual({ type: 'error', message: 'notification failed' });
	expect(posted.some((message) => message.jsonrpc === '2.0' && message.id === undefined)).toBe(
		false
	);
});
