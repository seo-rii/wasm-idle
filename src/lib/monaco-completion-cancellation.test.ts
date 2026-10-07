import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { CancellationError } = require('monaco-editor/esm/vs/base/common/errors.js') as {
	CancellationError: new () => Error;
};

type Message = {
	jsonrpc?: string;
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
};
type Token = {
	isCancellationRequested: boolean;
	onCancellationRequested: (listener: () => void) => { dispose: () => void };
};
type Item = { label: string; detail?: string; [key: string]: unknown };
type Provider = {
	provideCompletionItems: (
		model: object,
		position: object,
		context: object,
		token: Token
	) => Promise<{ suggestions: Item[] }>;
	resolveCompletionItem: (item: Item, token: Token) => Promise<Item>;
};
type Channel = {
	startListen: () => void;
	_requestSender: { _unprocessedResponses: Map<string, unknown> };
};
type ClientInternals = {
	TypedChannel: { fromTransport: (transport: object) => Channel };
	api: { getServer: (channel: Channel, handlers: object) => { server: object } };
	LspCompletionProvider: new (client: object, capabilities: object) => Provider;
};
let internals: ClientInternals;

beforeAll(async () => {
	const source = await readFile(
		require.resolve('monaco-editor/esm/external/monaco-lsp-client/out/index.js'),
		'utf8'
	);
	// Execute the installed, pnpm-patched provider and complete RPC stack. Replace only
	// Monaco's rendering imports so these tests do not need a DOM or editor workers.
	const enumValues = new Proxy({}, { get: (_target, property) => String(property) });
	internals = runInNewContext(
		source.replace(/^import .*;\n/gm, '').replace(/^export \{.*\};$/m, '') +
			'\n({ TypedChannel, api, LspCompletionProvider });',
		{
			languages: new Proxy({}, { get: () => enumValues }),
			MarkerSeverity: enumValues,
			MarkerTag: enumValues,
			Range: { fromPositions: (start: object, end: object) => ({ start, end }) },
			CancellationError,
			setTimeout,
			clearTimeout,
			console
		}
	) as ClientInternals;
});

function cancellationToken(cancelled = false) {
	const listeners = new Set<() => void>();
	const dispose = vi.fn();
	const token: Token = {
		isCancellationRequested: cancelled,
		onCancellationRequested(listener) {
			listeners.add(listener);
			return {
				dispose() {
					dispose();
					listeners.delete(listener);
				}
			};
		}
	};
	return {
		token,
		listeners,
		dispose,
		cancel() {
			token.isCancellationRequested = true;
			for (const listener of [...listeners]) listener();
		}
	};
}

function fixture(send?: (message: Message) => Promise<void>) {
	const messages: Message[] = [];
	let receive: (message: Message) => void = () => {};
	const transport = {
		state: { value: { state: 'open' }, onChange: () => ({ dispose() {} }) },
		setListener(listener: typeof receive) {
			receive = listener;
		},
		send: vi.fn(async (message: Message) => {
			messages.push(message);
			await send?.(message);
		})
	};
	const channel = internals.TypedChannel.fromTransport(transport);
	const { server } = internals.api.getServer(channel, {});
	channel.startListen();
	const provider = new internals.LspCompletionProvider(
		{
			server,
			bridge: {
				translate: () => ({
					textDocument: { uri: 'file:///workspace/main.cpp' },
					position: { line: 0, character: 1 }
				})
			}
		},
		{ resolveProvider: true }
	);
	return {
		messages,
		transport,
		channel,
		provider,
		reply(message: Message, result: unknown) {
			receive({ jsonrpc: '2.0', id: message.id, result });
		},
		fail(message: Message) {
			receive({
				jsonrpc: '2.0',
				id: message.id,
				error: { code: -32800, message: 'cancelled' }
			});
		},
		complete(token: Token) {
			return provider.provideCompletionItems({}, { lineNumber: 1, column: 2 }, {}, token);
		},
		pending() {
			return channel._requestSender._unprocessedResponses.size;
		}
	};
}

describe('Monaco LSP completion cancellation', () => {
	it('cancels the exact request, settles its wait and preserves another completion', async () => {
		const f = fixture();
		const first = cancellationToken();
		const second = cancellationToken();
		const cancelled = f.complete(first.token);
		const valid = f.complete(second.token);
		const rejected = expect(cancelled).rejects.toBeInstanceOf(CancellationError);
		await Promise.resolve();
		first.cancel();
		await rejected;
		await vi.waitFor(() => expect(f.messages).toHaveLength(3));
		expect(f.messages[2]).toEqual({
			jsonrpc: '2.0',
			id: undefined,
			method: '$/cancelRequest',
			params: { id: f.messages[0].id }
		});
		expect(f.messages[0].id).not.toBe(f.messages[1].id);
		expect(f.pending()).toBe(1);
		expect(first.listeners.size).toBe(0);
		expect(first.dispose).toHaveBeenCalledOnce();
		f.reply(f.messages[0], [{ label: 'obsolete' }]);
		f.fail(f.messages[0]);
		f.reply(f.messages[1], [{ label: 'valid', detail: 'preserved' }]);
		expect((await valid).suggestions).toMatchObject([{ label: 'valid', detail: 'preserved' }]);
		expect(f.pending()).toBe(0);
		expect(second.listeners.size).toBe(0);
		first.cancel();
		second.cancel();
		expect(f.messages).toHaveLength(3);
	});

	it('does not send an already cancelled completion or allocate a pending wait', async () => {
		const f = fixture();
		const token = cancellationToken(true);
		await expect(f.complete(token.token)).rejects.toBeInstanceOf(CancellationError);
		expect(f.messages).toEqual([]);
		expect(f.pending()).toBe(0);
		expect(token.listeners.size).toBe(0);
	});

	it('propagates resolve cancellation without mutating the item on a late result', async () => {
		const f = fixture();
		const token = cancellationToken();
		const item = { label: 'kept', detail: 'original', _lspItem: { label: 'kept' } };
		const wait = f.provider.resolveCompletionItem(item, token.token);
		const rejected = expect(wait).rejects.toBeInstanceOf(CancellationError);
		token.cancel();
		await rejected;
		await vi.waitFor(() => expect(f.messages).toHaveLength(2));
		expect(f.messages[0].method).toBe('completionItem/resolve');
		expect(f.messages[1].params).toEqual({ id: f.messages[0].id });
		f.reply(f.messages[0], { label: 'kept', detail: 'late' });
		expect(item.detail).toBe('original');
		expect(token.listeners.size).toBe(0);
		expect(f.pending()).toBe(0);
	});

	it('preserves successful completion and resolve results and disposes both listeners', async () => {
		const f = fixture();
		const completionToken = cancellationToken();
		const completion = f.complete(completionToken.token);
		f.reply(f.messages[0], { items: [{ label: 'result', detail: 'summary' }] });
		const item = (await completion).suggestions[0];
		const resolveToken = cancellationToken();
		const resolution = f.provider.resolveCompletionItem(item, resolveToken.token);
		f.reply(f.messages[1], { label: 'result', detail: 'resolved', documentation: 'docs' });
		expect(await resolution).toBe(item);
		expect(item).toMatchObject({ label: 'result', detail: 'resolved', documentation: 'docs' });
		expect(completionToken.dispose).toHaveBeenCalledOnce();
		expect(resolveToken.dispose).toHaveBeenCalledOnce();
		completionToken.cancel();
		resolveToken.cancel();
		expect(f.messages).toHaveLength(2);
		expect(f.pending()).toBe(0);
	});

	it('settles cancellation immediately while keeping notification order on a deferred transport', async () => {
		let finishWrite: () => void = () => {};
		const write = new Promise<void>((resolve) => (finishWrite = resolve));
		const f = fixture((message) =>
			message.method === '$/cancelRequest' ? Promise.resolve() : write
		);
		const token = cancellationToken();
		const wait = f.complete(token.token);
		const rejected = expect(wait).rejects.toBeInstanceOf(CancellationError);
		token.cancel();
		await rejected;
		expect(f.pending()).toBe(0);
		expect(f.messages).toHaveLength(1);
		finishWrite();
		await vi.waitFor(() => expect(f.messages).toHaveLength(2));
		expect(f.messages.map((message) => message.method)).toEqual([
			'textDocument/completion',
			'$/cancelRequest'
		]);
	});

	it('cleans up rejected sends and server errors so another completion can succeed', async () => {
		let rejectSend = true;
		const f = fixture(async () => {
			if (rejectSend) throw new Error('write failed');
		});
		const failedToken = cancellationToken();
		await expect(f.complete(failedToken.token)).rejects.toThrow('write failed');
		expect(failedToken.listeners.size).toBe(0);
		expect(f.pending()).toBe(0);
		rejectSend = false;
		const serverToken = cancellationToken();
		const serverWait = f.complete(serverToken.token);
		f.fail(f.messages[1]);
		await expect(serverWait).rejects.toThrow('cancelled');
		expect(serverToken.listeners.size).toBe(0);
		const retryToken = cancellationToken();
		const retry = f.complete(retryToken.token);
		f.reply(f.messages[2], [{ label: 'retried' }]);
		expect((await retry).suggestions[0].label).toBe('retried');
		expect(f.pending()).toBe(0);
	});

	it('uses Monaco cancellation when a response arrives just before the provider resumes', async () => {
		const f = fixture();
		const token = cancellationToken();
		const wait = f.complete(token.token);
		f.reply(f.messages[0], [{ label: 'obsolete' }]);
		token.cancel();
		await expect(wait).rejects.toBeInstanceOf(CancellationError);
		expect(f.messages).toHaveLength(1);
		expect(token.listeners.size).toBe(0);
		expect(f.pending()).toBe(0);
	});

	it('disposes a listener that cancels synchronously while being registered', async () => {
		const f = fixture();
		const dispose = vi.fn();
		const token: Token = {
			isCancellationRequested: false,
			onCancellationRequested(listener) {
				token.isCancellationRequested = true;
				listener();
				return { dispose };
			}
		};
		await expect(f.complete(token)).rejects.toBeInstanceOf(CancellationError);
		expect(dispose).toHaveBeenCalledOnce();
		expect(f.messages).toEqual([]);
		expect(f.pending()).toBe(0);
	});
});
