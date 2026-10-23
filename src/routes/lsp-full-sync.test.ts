// @vitest-environment node

import type { EditorLanguageServerHandle } from '@wasm-idle/lsp';
import { describe, expect, it, vi } from 'vitest';
import { adaptMonacoFullDocumentSync } from './lsp-full-sync';

function setup() {
	let receive: (message: unknown) => void = () => {};
	let snapshot: { uri: string; text: string } | undefined = {
		uri: 'file:///workspace/Main.res',
		text: 'let answer = 42\n'
	};
	const write = vi.fn(async (_message: unknown) => {});
	const handle = {
		transport: {
			reader: {
				listen: (callback: typeof receive) => {
					receive = callback;
					return { dispose() {} };
				}
			},
			writer: { write }
		},
		dispose: vi.fn()
	} as unknown as EditorLanguageServerHandle;
	adaptMonacoFullDocumentSync(handle, () => snapshot);
	const incoming = vi.fn();
	handle.transport.reader.listen(incoming);
	const send = (message: Record<string, unknown>) =>
		handle.transport.writer.write({ jsonrpc: '2.0', ...message });
	return {
		handle,
		write,
		send,
		incoming,
		receive: (message: unknown) => receive(message),
		setSnapshot: (value: typeof snapshot) => (snapshot = value),
		negotiate: async (sync: unknown, id: string | number = 17) => {
			await send({ id, method: 'initialize', params: {} });
			receive({ jsonrpc: '2.0', id, result: { capabilities: { textDocumentSync: sync } } });
		}
	};
}

function change(uri = 'file:///workspace/main.res') {
	return {
		method: 'textDocument/didChange',
		params: {
			textDocument: { uri, version: 8 },
			contentChanges: [
				{
					range: { start: { line: 0, character: 13 }, end: { line: 0, character: 14 } },
					text: '2'
				}
			]
		}
	};
}

describe('Monaco negotiated document synchronization', () => {
	it.each([1, { openClose: true, change: 1 }])(
		'sends the current complete document for Full sync %j',
		async (sync) => {
			const host = setup();
			await host.negotiate(sync);
			const message = change();
			await host.send(message);
			expect(host.write).toHaveBeenLastCalledWith({
				jsonrpc: '2.0',
				method: message.method,
				params: {
					textDocument: message.params.textDocument,
					contentChanges: [{ text: 'let answer = 42\n' }]
				}
			});
			expect(message.params.contentChanges[0].range.start.character).toBe(13);
			host.setSnapshot({ uri: 'file:///workspace/Main.res', text: 'let answer = 4\n' });
			await host.send(change());
			expect(host.write).toHaveBeenLastCalledWith(
				expect.objectContaining({
					params: expect.objectContaining({
						contentChanges: [{ text: 'let answer = 4\n' }]
					})
				})
			);
		}
	);

	it.each([2, { openClose: true, change: 2 }, 0, undefined])(
		'preserves changes for other synchronization modes %j',
		async (sync) => {
			const host = setup();
			await host.negotiate(sync);
			const message = change();
			await host.send(message);
			expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...message });
		}
	);

	it('waits for the response to the actual initialize request', async () => {
		const host = setup();
		await host.send({ id: 'initialize-9', method: 'initialize' });
		host.receive({ id: 99, result: { capabilities: { textDocumentSync: 1 } } });
		const message = change();
		await host.send(message);
		expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...message });
		const response = { id: 'initialize-9', result: { capabilities: { textDocumentSync: 1 } } };
		host.receive(response);
		expect(host.incoming).toHaveBeenLastCalledWith(response);
		await host.send(message);
		expect(host.write).toHaveBeenLastCalledWith(
			expect.objectContaining({
				params: expect.objectContaining({ contentChanges: [{ text: 'let answer = 42\n' }] })
			})
		);
	});

	it('keeps notifications for other documents and missing models intact', async () => {
		const host = setup();
		await host.negotiate(1);
		const other = change('file:///workspace/Other.res');
		await host.send(other);
		expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...other });
		host.setSnapshot({ uri: 'file:///workspace/Other.res', text: 'let other = 3\n' });
		await host.send(other);
		expect(host.write).toHaveBeenLastCalledWith(
			expect.objectContaining({
				params: expect.objectContaining({ contentChanges: [{ text: 'let other = 3\n' }] })
			})
		);
		host.setSnapshot(undefined);
		const active = change();
		await host.send(active);
		expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...active });
	});

	it('does not confuse server requests or later responses with initialization', async () => {
		const host = setup();
		await host.send({ id: 17, method: 'initialize' });
		host.receive({ id: 17, method: 'client/registerCapability', params: {} });
		host.receive({ id: 17, result: { capabilities: { textDocumentSync: 1 } } });
		host.receive({ id: 17, result: {} });
		await host.send(change());
		expect(host.write).toHaveBeenLastCalledWith(
			expect.objectContaining({
				params: expect.objectContaining({ contentChanges: [{ text: 'let answer = 42\n' }] })
			})
		);
	});

	it('preserves other requests, lifecycle methods, and a new initialization', async () => {
		const host = setup();
		await host.negotiate(1);
		const request = { id: 31, method: 'textDocument/hover', params: { position: {} } };
		await host.send(request);
		expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...request });
		await host.send({ id: 50, method: 'initialize' });
		const message = change();
		await host.send(message);
		expect(host.write).toHaveBeenLastCalledWith({ jsonrpc: '2.0', ...message });
		host.handle.dispose();
		expect(host.handle.dispose).toHaveBeenCalledOnce();
	});
});
