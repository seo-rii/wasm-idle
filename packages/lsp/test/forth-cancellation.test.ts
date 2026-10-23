import { afterEach, expect, it, vi } from 'vitest';
import * as rpc from 'vscode-jsonrpc/browser';

const upstream = vi.hoisted(() => ({
	dispatch: vi.fn((message: { id?: number | string }) =>
		message.id === undefined ? [] : [{ jsonrpc: '2.0', id: message.id, result: 'upstream' }]
	)
}));

vi.mock('../src/forth/host.js', () => ({
	createForthLspHost: async () => ({ dispatch: upstream.dispatch })
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	upstream.dispatch.mockClear();
});

it('settles a canceled pre-open request and preserves other queued requests', async () => {
	let dispatch: (event: MessageEvent) => void = () => {};
	const replies: Array<{ type?: string; id?: number | string }> = [];
	const port = {
		onmessage: undefined as ((event: MessageEvent) => void) | undefined,
		addEventListener() {},
		postMessage(message: unknown) {
			dispatch(new MessageEvent('message', { data: message }));
		}
	};
	vi.stubGlobal('addEventListener', (_type: string, listener: typeof dispatch) => {
		dispatch = listener;
	});
	vi.stubGlobal('postMessage', (message: (typeof replies)[number]) => {
		replies.push(message);
		queueMicrotask(() => port.onmessage?.(new MessageEvent('message', { data: message })));
	});
	await import('../src/forth/worker.js');
	port.postMessage({ type: 'init', options: { wasmBytes: new Uint8Array() } });
	await vi.waitFor(() => expect(replies).toContainEqual({ type: 'ready' }));

	const connection = rpc.createMessageConnection(
		new rpc.BrowserMessageReader(port as unknown as Worker),
		new rpc.BrowserMessageWriter(port as unknown as Worker)
	);
	const cancellation = new rpc.CancellationTokenSource();
	connection.listen();
	try {
		const params = { textDocument: { uri: 'file:///workspace/main.fs' } };
		let outcome: { code: number } | undefined;
		const canceled = connection
			.sendRequest('textDocument/hover', params, cancellation.token)
			.then(
				() => {
					outcome = { code: 0 };
				},
				(error: rpc.ResponseError<unknown>) => {
					outcome = { code: error.code };
				}
			);
		const kept = connection.sendRequest('textDocument/hover', params);
		const keptResult = kept.then(
			(value) => ({ value }),
			(error) => ({ error })
		);
		cancellation.cancel();
		await vi.waitFor(() => expect(outcome).toEqual({ code: -32800 }));
		await canceled;
		expect(upstream.dispatch).not.toHaveBeenCalled();
		await connection.sendNotification('textDocument/didOpen', {
			textDocument: { ...params.textDocument, text: '1 .', version: 1, languageId: 'forth' }
		});
		expect(await keptResult).toEqual({ value: 'upstream' });
		expect(upstream.dispatch.mock.calls.map(([message]) => message.id)).toEqual([undefined, 1]);
		expect(connection.hasPendingResponse()).toBe(false);
		expect(replies.filter((message) => message.id === 0)).toHaveLength(1);
	} finally {
		cancellation.dispose();
		connection.dispose();
	}
});
