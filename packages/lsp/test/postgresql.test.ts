import { describe, expect, it, vi } from 'vitest';
import { getPostgresqlLanguageServer } from '../src/postgresql/language-server.js';
import {
	startPostgresqlLanguageServerWorker,
	type LoadPostgresqlLanguageServer
} from '../src/postgresql/worker-host.js';
import { resolvePostgresqlLanguageServerModuleUrl } from '../src/runtime.js';

class LocalWorker extends EventTarget {
	readonly terminate = vi.fn();
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	private readonly workerEvents = new EventTarget();
	constructor(load: LoadPostgresqlLanguageServer) {
		super();
		startPostgresqlLanguageServerWorker(
			{
				addEventListener: (_, listener) =>
					this.workerEvents.addEventListener('message', listener as EventListener),
				postMessage: (data) =>
					queueMicrotask(() => {
						const event = new MessageEvent('message', { data });
						this.dispatchEvent(event);
						this.onmessage?.(event);
					})
			},
			load
		);
	}
	postMessage(data: unknown) {
		queueMicrotask(() =>
			this.workerEvents.dispatchEvent(new MessageEvent('message', { data }))
		);
	}
}

describe('PostgreSQL upstream language server host', () => {
	it('resolves explicit and rooted assets while retaining application base paths', () => {
		expect(resolvePostgresqlLanguageServerModuleUrl('https://cdn.example/tools')).toBe(
			'https://cdn.example/tools/wasm-postgresql-lsp/dist/lsp.js'
		);
		expect(
			resolvePostgresqlLanguageServerModuleUrl(
				{ rootUrl: '/wasm-idle' },
				'https://example.test/wasm-idle/'
			)
		).toBe('https://example.test/wasm-idle/wasm-postgresql-lsp/dist/lsp.js');
		expect(() => resolvePostgresqlLanguageServerModuleUrl(undefined)).toThrow(
			/explicit provider URL or rootUrl/
		);
		expect(
			resolvePostgresqlLanguageServerModuleUrl(
				{ postgresql: { moduleUrl: '/custom/lsp.js' } },
				'https://example.test/app/'
			)
		).toBe('https://example.test/custom/lsp.js');
	});

	it('preserves upstream capabilities, custom methods and multiple outgoing messages', async () => {
		const response = {
			jsonrpc: '2.0',
			id: 7,
			result: { capabilities: { textDocumentSync: 1 } }
		};
		const notification = {
			jsonrpc: '2.0',
			method: 'textDocument/publishDiagnostics',
			params: { uri: 'file:///main.sql', diagnostics: [] }
		};
		const handleMessage = vi.fn(() => [response, notification]);
		const load = vi.fn(async () => ({ createLanguageServer: async () => ({ handleMessage }) }));
		const worker = new LocalWorker(load);
		const onStatus = vi.fn();
		const handle = await getPostgresqlLanguageServer({
			createWorker: () => worker as unknown as Worker,
			postgresql: { moduleUrl: 'https://cdn.test/dist/lsp.js' },
			onStatus
		});
		const received: unknown[] = [];
		handle.transport.reader.listen((message) => received.push(message));
		const request = {
			jsonrpc: '2.0',
			id: 7,
			method: 'pgls/futureMethod',
			params: { opaque: ['value'] }
		};
		await handle.transport.writer.write(request);
		await vi.waitFor(() => expect(received).toEqual([response, notification]));
		expect(load).toHaveBeenCalledExactlyOnceWith('https://cdn.test/dist/lsp.js');
		expect(handleMessage).toHaveBeenCalledExactlyOnceWith(request);
		await handle.setSchema('{"tables":[]}');
		await handle.setSchema(null);
		await vi.waitFor(() => expect(handleMessage).toHaveBeenCalledTimes(3));
		expect(handleMessage.mock.calls.slice(1)).toEqual([
			[{ jsonrpc: '2.0', method: 'pgls/setSchema', params: { schema: '{"tables":[]}' } }],
			[{ jsonrpc: '2.0', method: 'pgls/clearSchema', params: {} }]
		]);
		handle.dispose();
		handle.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onStatus).toHaveBeenLastCalledWith({ state: 'disabled' });
	});

	it('serializes messages received during startup and initializes the module once', async () => {
		let resolve!: (value: Awaited<ReturnType<LoadPostgresqlLanguageServer>>) => void;
		const load = vi.fn(
			() =>
				new Promise<Awaited<ReturnType<LoadPostgresqlLanguageServer>>>((done) => {
					resolve = done;
				})
		);
		const handleMessage = vi.fn(() => []);
		const worker = new LocalWorker(load);
		worker.postMessage({
			type: 'init',
			options: { moduleUrl: 'https://cdn.test/lsp.js', schema: '{}' }
		});
		worker.postMessage({ type: 'init', options: { moduleUrl: 'ignored' } });
		const open = {
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: { textDocument: { uri: 'file:///a.sql', text: 'select 1;' } }
		};
		const close = {
			jsonrpc: '2.0',
			method: 'textDocument/didClose',
			params: { textDocument: { uri: 'file:///a.sql' } }
		};
		worker.postMessage(open);
		worker.postMessage(close);
		await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
		resolve({ createLanguageServer: async () => ({ handleMessage }) });
		await vi.waitFor(() => expect(handleMessage).toHaveBeenCalledTimes(3));
		expect(handleMessage.mock.calls).toEqual([
			[{ jsonrpc: '2.0', method: 'pgls/setSchema', params: { schema: '{}' } }],
			[open],
			[close]
		]);
	});

	it('reports real module failures and terminates a failed worker', async () => {
		const worker = new LocalWorker(async () => {
			throw new Error('upstream WASM fetch failed');
		});
		const onStatus = vi.fn();
		await expect(
			getPostgresqlLanguageServer({
				createWorker: () => worker as unknown as Worker,
				postgresql: { moduleUrl: 'https://cdn.test/missing.js' },
				onStatus
			})
		).rejects.toThrow('upstream WASM fetch failed');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onStatus).toHaveBeenLastCalledWith({
			state: 'error',
			message: 'upstream WASM fetch failed'
		});
	});

	it('cancels startup without waiting for the upstream loader', async () => {
		const load = vi.fn(() => new Promise<never>(() => {}));
		const worker = new LocalWorker(load);
		const controller = new AbortController();
		const pending = getPostgresqlLanguageServer({
			createWorker: () => worker as unknown as Worker,
			postgresql: { moduleUrl: 'https://cdn.test/lsp.js' },
			signal: controller.signal
		});
		await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
		controller.abort(new Error('language changed'));
		await expect(pending).rejects.toThrow('language changed');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
