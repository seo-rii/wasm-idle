import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createMessageConnection } from 'vscode-jsonrpc/node';
import { WASM_LEAN4_PROFILE } from '../src/bundledLean4Runtime.js';
import { getLean4LanguageServer } from '../src/lean4/language-server.js';
import { LEAN4_RUNTIME_MANIFEST, resolveLean4RuntimeAssetConfig } from '../src/lean4/assets.js';
import { frameMessage, LeanStdin, LspFrameDecoder } from '../src/lean4/stdio.js';

describe('original Lean distribution contract', () => {
	it.each(['supervisor-error', 'dispose'])(
		'settles outstanding client requests on %s without a worker response',
		async (reason) => {
			class ReadyWorker extends EventTarget {
				onmessage?: (event: MessageEvent) => void;
				posted: unknown[] = [];
				terminate = vi.fn();
				postMessage(message: { type?: string }) {
					this.posted.push(message);
					if (message.type === 'init')
						this.dispatchEvent(
							new MessageEvent('message', { data: { type: 'ready' } })
						);
				}
			}
			const worker = new ReadyWorker();
			const server = await getLean4LanguageServer({
				currentUrl: 'https://app.test/',
				createWorker: () => worker as unknown as Worker
			});
			const connection = createMessageConnection(
				server.transport.reader,
				server.transport.writer
			);
			connection.listen();
			const closed = vi.fn();
			connection.onClose(closed);
			let settled: unknown;
			const pending = connection.sendRequest('textDocument/hover', {}).then(
				(result) => {
					settled = result;
				},
				(error) => {
					settled = error;
				}
			);
			try {
				if (reason === 'dispose') server.dispose();
				else
					worker.dispatchEvent(
						Object.assign(new Event('error'), { message: 'Supervisor crashed' })
					);
				expect(closed).toHaveBeenCalledTimes(1);
				await vi.waitFor(() => expect(settled).toMatchObject({ code: -32801 }));
				await pending;
				expect(connection.hasPendingResponse()).toBe(false);
				const count = worker.posted.length;
				await expect(
					server.transport.writer.write({ jsonrpc: '2.0', id: 12, method: 'test' })
				).rejects.toThrow(reason === 'dispose' ? 'closed' : 'Supervisor crashed');
				expect(worker.posted).toHaveLength(count);
				expect(worker.terminate).toHaveBeenCalledTimes(1);
			} finally {
				connection.dispose();
				server.dispose();
				await pending;
			}
		}
	);
	it('closes the JSON-RPC transport and terminates owned workers after a runtime failure', async () => {
		class ReadyWorker extends EventTarget {
			onmessage?: (event: MessageEvent) => void;
			terminate = vi.fn();
			emit(data: unknown) {
				const event = new MessageEvent('message', { data });
				this.dispatchEvent(event);
				this.onmessage?.(event);
			}
			postMessage(message: { type?: string }) {
				if (message.type === 'init') this.emit({ type: 'ready' });
			}
		}
		const outer = new ReadyWorker();
		const physical = new ReadyWorker();
		vi.stubGlobal(
			'Worker',
			class {
				constructor() {
					return physical;
				}
			}
		);
		const statuses: any[] = [];
		const server = await getLean4LanguageServer({
			currentUrl: 'https://app.test/',
			createWorker: () => outer as unknown as Worker,
			onStatus: (status) => statuses.push(status)
		});
		const received: unknown[] = [];
		const connection = createMessageConnection(
			{
				...server.transport.reader,
				listen(callback) {
					return server.transport.reader.listen((message) => {
						received.push(message);
						callback(message);
					});
				}
			},
			server.transport.writer
		);
		const closed = vi.fn();
		connection.onClose(closed);
		connection.listen();
		try {
			const pending = connection.sendRequest('textDocument/hover', {});
			const rejected = expect(pending).rejects.toMatchObject({ code: -32801 });
			outer.emit({
				leanWorker: { type: 'create', id: 1, url: 'https://app.test/worker.js' }
			});
			outer.emit({
				jsonrpc: '2.0',
				id: 0,
				error: { code: -32801, message: 'Lean pthread failed' }
			});
			outer.emit({ type: 'error', message: 'Lean pthread failed' });
			await rejected;
			expect(received).toEqual([
				{ jsonrpc: '2.0', id: 0, error: { code: -32801, message: 'Lean pthread failed' } }
			]);
			expect(closed).toHaveBeenCalledTimes(1);
			expect(() => connection.sendRequest('textDocument/hover', {})).toThrow('closed');
			await expect(
				server.transport.writer.write({ jsonrpc: '2.0', id: 8, method: 'test' })
			).rejects.toThrow('Lean pthread failed');
			expect(outer.terminate).toHaveBeenCalledTimes(1);
			expect(physical.terminate).toHaveBeenCalledTimes(1);
			expect(statuses.at(-1)).toEqual({ state: 'error', message: 'Lean pthread failed' });
		} finally {
			connection.dispose();
			server.dispose();
			server.dispose();
			vi.unstubAllGlobals();
		}
	});
	it('keeps JSON-RPC stdout separate from physical worker ownership commands', async () => {
		class ReadyWorker extends EventTarget {
			postMessage(message: { type?: string }) {
				if (message.type === 'init')
					this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
			}
			terminate() {}
		}
		const outer = new ReadyWorker();
		const physicalWorker = vi.fn();
		vi.stubGlobal('Worker', physicalWorker);
		let server;
		try {
			server = await getLean4LanguageServer({
				currentUrl: 'https://app.test/',
				createWorker: () => outer as unknown as Worker
			});
			outer.dispatchEvent(
				new MessageEvent('message', {
					data: {
						jsonrpc: '2.0',
						method: 'window/logMessage',
						leanWorker: { type: 'create', id: 1, url: 'https://app.test/untrusted.js' }
					}
				})
			);
			expect(physicalWorker).not.toHaveBeenCalled();
		} finally {
			server?.dispose();
			vi.unstubAllGlobals();
		}
	});
	it('uses the execution asset lock including the exact original Wasm identity', async () => {
		const lock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-lean4-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		expect(WASM_LEAN4_PROFILE.assets).toEqual(lock.assets);
		expect(WASM_LEAN4_PROFILE.source).toBe(lock.source);
		expect(WASM_LEAN4_PROFILE.version).toBe(lock.version);
	});
	it('uses the MIME of raw compressed delivery for ordinary static hosting', () => {
		expect(
			LEAN4_RUNTIME_MANIFEST.runtimes[0].assets.find(
				(asset) => asset.key === 'lean.wasm.gz.bin'
			)?.mediaType
		).toBe('application/octet-stream');
	});
	it.each(['/', '/wasm-idle/', '/nested/application/'])(
		'keeps assets inside deployment %s',
		(root) => {
			expect(resolveLean4RuntimeAssetConfig(root, 'https://example.test/page').baseUrl).toBe(
				`https://example.test${root}wasm-lean4/`
			);
		}
	);
	it('allows a relocated directory for the pinned distribution', () => {
		expect(
			resolveLean4RuntimeAssetConfig(
				{ lean4: { baseUrl: 'https://cdn.test/lean4' } },
				'https://app.test/'
			).baseUrl
		).toBe('https://cdn.test/lean4/');
	});
	it.each([
		'file:///assets/',
		'https://name:password@cdn.test/lean/',
		'https://cdn.test/lean/?query=1',
		'https://cdn.test/lean/#hash'
	])('rejects unsafe asset directory %s before creating workers', async (baseUrl) => {
		const createWorker = vi.fn();
		await expect(
			getLean4LanguageServer({
				currentUrl: 'https://app.test/',
				lean4: { baseUrl },
				createWorker
			})
		).rejects.toThrow();
		expect(createWorker).not.toHaveBeenCalled();
	});
});

describe('Lean byte transport', () => {
	const message = {
		jsonrpc: '2.0',
		id: 1,
		method: 'test',
		params: { value: '안녕 👋' }
	} as const;
	it('decodes fragmented and coalesced UTF-8 frames using byte lengths', () => {
		const frame = frameMessage(message);
		const parser = new LspFrameDecoder();
		const result = [];
		for (let offset = 0; offset < frame.length; offset++)
			result.push(...parser.push(frame.subarray(offset, offset + 1)));
		expect(result).toEqual([message]);
		const pair = new Uint8Array(frame.length * 2);
		pair.set(frame);
		pair.set(frame, frame.length);
		expect(parser.push(pair)).toEqual([message, message]);
	});
	it.each([
		'Content-Length: 0\r\n\r\n',
		'Content-Length: 9999999999\r\n\r\n',
		'Content-Length: 2\r\nContent-Length: 2\r\n\r\n',
		'Missing-Length: 2\r\n\r\n'
	])('rejects invalid framing %s', (text) => {
		expect(() => new LspFrameDecoder().push(new TextEncoder().encode(text))).toThrow();
	});
	it('rejects invalid JSON-RPC and overlong headers', () => {
		expect(() =>
			new LspFrameDecoder().push(new TextEncoder().encode('Content-Length: 2\r\n\r\n{}'))
		).toThrow('JSON-RPC');
		expect(() => new LspFrameDecoder().push(new Uint8Array(8193))).toThrow('header');
	});
	it('delivers a standard UTF-8 frame to synchronous original stdin and closes it', () => {
		const stdin = new LeanStdin();
		stdin.write(message);
		const control = new Int32Array(stdin.buffer, 0, 4);
		const bytes = new Uint8Array(stdin.buffer, 16, Atomics.load(control, 0));
		expect(new LspFrameDecoder().push(bytes)).toEqual([message]);
		stdin.close();
		stdin.close();
		expect(Atomics.load(control, 2)).toBe(1);
		expect(() => stdin.write(message)).toThrow('closed');
	});
});
