import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AbstractMessageReader,
	AbstractMessageWriter,
	CancellationTokenSource,
	createMessageConnection,
	type DataCallback,
	type Message,
	type MessageConnection
} from 'vscode-jsonrpc/node';
import { createC3LspHost } from '../src/c3/host.js';

vi.mock('../src/c3/host.js', () => ({ createC3LspHost: vi.fn() }));

class WorkerReader extends AbstractMessageReader {
	callback?: DataCallback;
	listen(callback: DataCallback) {
		this.callback = callback;
		return {
			dispose: () => {
				this.callback = undefined;
			}
		};
	}
}

class WorkerWriter extends AbstractMessageWriter {
	constructor(private send: (message: Message) => void) {
		super();
	}
	async write(message: Message) {
		this.send(message);
	}
	end() {}
}

const uri = 'file:///workspace/main.c3';
const params = { textDocument: { uri }, position: { line: 0, character: 0 } };
const didOpen = {
	jsonrpc: '2.0',
	method: 'textDocument/didOpen',
	params: { textDocument: { uri, languageId: 'c3', version: 1, text: '' } }
};

describe('C3 worker request cancellation', () => {
	let send: (message: any) => void;
	let posted: any[];
	let connection: MessageConnection;
	const dispatch = vi.fn<(message: any) => unknown[]>((message) =>
		message.id === undefined ? [] : [{ jsonrpc: '2.0', id: message.id, result: null }]
	);

	beforeEach(async () => {
		vi.resetModules();
		posted = [];
		dispatch.mockReset();
		dispatch.mockImplementation((message) =>
			message.id === undefined ? [] : [{ jsonrpc: '2.0', id: message.id, result: null }]
		);
		vi.mocked(createC3LspHost).mockResolvedValue({ dispatch: dispatch });
		const reader = new WorkerReader();
		vi.stubGlobal(
			'addEventListener',
			(_type: string, listener: (event: MessageEvent) => void) => {
				send = (message) => listener({ data: message } as MessageEvent);
			}
		);
		vi.stubGlobal('postMessage', (message: any) => {
			posted.push(message);
			if (message.jsonrpc === '2.0') reader.callback?.(message);
		});
		await import('../src/c3/worker.js');
		send({
			type: 'init',
			options: {
				moduleBytes: new Uint8Array(),
				wasmBytes: new Uint8Array(),
				stdlibBytes: new Uint8Array()
			}
		});
		await vi.waitFor(() => expect(posted).toContainEqual({ type: 'ready' }));
		connection = createMessageConnection(reader, new WorkerWriter((message) => send(message)));
		connection.listen();
	});

	afterEach(() => {
		connection?.dispose();
		vi.unstubAllGlobals();
	});

	it('settles the real JSON-RPC client before didOpen and retains other queued requests', async () => {
		const token = new CancellationTokenSource();
		let cancelled: unknown;
		// The first client request has id 0, which must not be treated as absent.
		const pending = connection.sendRequest('textDocument/hover', params, token.token).then(
			(value) => {
				cancelled = value;
			},
			(error) => {
				cancelled = error;
			}
		);
		const surviving = connection.sendRequest('textDocument/documentSymbol', {
			textDocument: { uri }
		});
		token.cancel();
		try {
			await vi.waitFor(() => expect(cancelled).toMatchObject({ code: -32800 }));
			await pending;
			expect(posted.filter((message) => message.id === 0)).toEqual([
				{ jsonrpc: '2.0', id: 0, error: { code: -32800, message: 'Request cancelled' } }
			]);
			await connection.sendNotification(didOpen.method, didOpen.params);
			await expect(surviving).resolves.toBeNull();
			await expect(connection.sendRequest('textDocument/hover', params)).resolves.toBeNull();
			expect(dispatch.mock.calls.some(([message]) => message.id === 0)).toBe(false);
			expect(dispatch.mock.calls.some(([message]) => message.id === 1)).toBe(true);
			expect(connection.hasPendingResponse()).toBe(false);
		} finally {
			token.dispose();
			// Also release client promises if the regression fails before didOpen.
			connection.dispose();
			await Promise.allSettled([pending, surviving]);
		}
	});

	it('preserves string IDs and sends only one response for duplicate cancellations', async () => {
		send({ jsonrpc: '2.0', id: '7', method: 'textDocument/hover', params });
		send({ jsonrpc: '2.0', id: 7, method: 'textDocument/hover', params });
		const cancel = { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: '7' } };
		send(cancel);
		send(cancel);
		send(didOpen);
		await vi.waitFor(() =>
			expect(posted).toContainEqual({ jsonrpc: '2.0', id: 7, result: null })
		);
		expect(posted.filter((message) => message.id === '7')).toEqual([
			{ jsonrpc: '2.0', id: '7', error: { code: -32800, message: 'Request cancelled' } }
		]);
		expect(dispatch.mock.calls.some(([message]) => message.id === '7')).toBe(false);
		expect(dispatch.mock.calls.some(([message]) => message.id === 7)).toBe(true);
	});

	it('forwards cancellation of dispatched requests and keeps the upstream response', async () => {
		dispatch.mockImplementation((message) =>
			message.method === '$/cancelRequest'
				? [
						{
							jsonrpc: '2.0',
							id: message.params.id,
							error: { code: -32800, message: 'Upstream cancelled' }
						}
					]
				: []
		);
		await connection.sendNotification(didOpen.method, didOpen.params);
		const token = new CancellationTokenSource();
		let cancelled: unknown;
		const pending = connection.sendRequest('textDocument/hover', params, token.token).then(
			(value) => {
				cancelled = value;
			},
			(error) => {
				cancelled = error;
			}
		);
		try {
			await vi.waitFor(() =>
				expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 0 }))
			);
			token.cancel();
			await vi.waitFor(() =>
				expect(cancelled).toMatchObject({ code: -32800, message: 'Upstream cancelled' })
			);
			await pending;
			expect(dispatch).toHaveBeenCalledWith({
				jsonrpc: '2.0',
				method: '$/cancelRequest',
				params: { id: 0 }
			});
			expect(posted.filter((message) => message.id === 0)).toHaveLength(1);
			expect(connection.hasPendingResponse()).toBe(false);
		} finally {
			token.dispose();
			connection.dispose();
			await pending;
		}
	});
});
