import { describe, expect, it, vi } from 'vitest';
import { SharedByteQueue } from '@wasm-idle/llvm-core/debug';
import { getNimLanguageServer } from '../src/nim/language-server.js';
import {
	configureNimFileSystem,
	createNimWorkspaceMirror,
	type NimFileSystem
} from '../src/nim/platform.js';

class FakeWorker extends EventTarget {
	terminate = vi.fn();
	messages: any[] = [];
	constructor(private readonly response: 'ready' | 'error' | 'none' = 'ready') {
		super();
	}
	postMessage(message: unknown) {
		this.messages.push(message);
		if (this.response !== 'none')
			queueMicrotask(() =>
				this.dispatchEvent(
					new MessageEvent('message', {
						data:
							this.response === 'error'
								? { type: 'error', message: 'original server failed' }
								: { type: 'ready' }
					})
				)
			);
	}
}
const options = (worker: FakeWorker) => ({
	nim: { baseUrl: 'https://cdn.test/wasm-nim-lsp/' },
	createWorker: () => worker as unknown as Worker
});

describe('original Nim stdio SDK host', () => {
	it('requires explicit roots, isolation and bounded valid workspace paths', async () => {
		await expect(getNimLanguageServer()).rejects.toThrow(/baseUrl or rootUrl/);
		const worker = new FakeWorker();
		await expect(
			getNimLanguageServer({
				...options(worker),
				nim: { baseUrl: 'https://cdn.test/?unversioned', workspaceFiles: [] }
			})
		).rejects.toThrow(/plain HTTP/);
		await expect(
			getNimLanguageServer({
				...options(worker),
				nim: {
					baseUrl: 'https://cdn.test/',
					workspaceFiles: [{ path: '../escape.nim', content: '' }]
				}
			})
		).rejects.toThrow(/workspace file/);
		expect(worker.messages).toEqual([]);
	});
	it('uses real stdio JSON-RPC framing and terminates idempotently', async () => {
		const worker = new FakeWorker();
		const statuses: unknown[] = [];
		const handle = await getNimLanguageServer({
			...options(worker),
			onStatus: (status) => statuses.push(status)
		});
		const queue = new SharedByteQueue(worker.messages[0].options.stdin);
		await handle.transport.writer.write({
			jsonrpc: '2.0',
			id: 1,
			method: 'custom/opaque',
			params: { text: '한글' }
		});
		const bytes = new Uint8Array(2048);
		const length = queue.readBlocking(bytes);
		const framed = new TextDecoder().decode(bytes.subarray(0, length));
		expect(framed).toContain('Content-Length:');
		expect(framed).toContain('custom/opaque');
		expect(framed).toContain('한글');
		const received: unknown[] = [];
		handle.transport.reader.listen((message) => received.push(message));
		const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: '한글' });
		const encoded = new TextEncoder().encode(body);
		const header = new TextEncoder().encode(`Content-Length: ${encoded.length}\r\n\r\n`);
		worker.dispatchEvent(
			new MessageEvent('message', { data: { type: 'stdout', bytes: header.subarray(0, 7) } })
		);
		worker.dispatchEvent(
			new MessageEvent('message', { data: { type: 'stdout', bytes: header.subarray(7) } })
		);
		worker.dispatchEvent(
			new MessageEvent('message', { data: { type: 'stdout', bytes: encoded } })
		);
		await vi.waitFor(() =>
			expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: '한글' }])
		);
		handle.dispose();
		handle.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(statuses.at(-1)).toEqual({ state: 'disabled' });
	});
	it('cleans up failed and cancelled startups', async () => {
		const failed = new FakeWorker('error');
		await expect(getNimLanguageServer(options(failed))).rejects.toThrow(
			'original server failed'
		);
		expect(failed.terminate).toHaveBeenCalledOnce();
		const pending = new FakeWorker('none');
		const controller = new AbortController();
		const promise = getNimLanguageServer({ ...options(pending), signal: controller.signal });
		await vi.waitFor(() => expect(pending.messages).toHaveLength(1));
		controller.abort(new Error('language changed'));
		await expect(promise).rejects.toThrow('language changed');
		expect(pending.terminate).toHaveBeenCalledOnce();
	});
});

describe('Nim editor file mirroring', () => {
	it('converts the original Emscripten HEAP8 stdout into unsigned independent UTF-8 buffers', () => {
		const streams = [0, 1, 2].map(() => ({ stream_ops: {} as Record<string, any> }));
		const stdout = vi.fn();
		configureNimFileSystem({
			fs: {
				mkdirTree() {},
				writeFile() {},
				symlink() {},
				chdir() {},
				getStream(fd) {
					return streams[fd];
				}
			},
			wasm: new Uint8Array(),
			files: [],
			read: () => 0,
			stdout,
			stderr() {}
		});
		const signed = new Int8Array(new TextEncoder().encode('한글').buffer);
		expect(streams[1].stream_ops.write(null, signed, 0, signed.length)).toBe(signed.length);
		const bytes = stdout.mock.calls[0][0];
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(bytes)).toBe('한글');
		signed.fill(0);
		expect(new TextDecoder().decode(bytes)).toBe('한글');
	});
	it('keeps UTF-8 notifications intact while mirroring opened and saved files only inside the project', () => {
		const files = new Map<string, string>();
		const mirror = createNimWorkspaceMirror({
			mkdirTree() {},
			writeFile(path, bytes) {
				files.set(path, new TextDecoder().decode(bytes));
			}
		} as NimFileSystem);
		const frame = (message: unknown) => {
			const body = new TextEncoder().encode(JSON.stringify(message));
			const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
			const data = new Uint8Array(header.length + body.length);
			data.set(header);
			data.set(body, header.length);
			for (let i = 0; i < data.length; i += 3) mirror(data.subarray(i, i + 3));
		};
		const uri = 'file:///workspace/sub/main.nim';
		frame({
			method: 'textDocument/didOpen',
			params: { textDocument: { uri, text: 'echo "한글"' } }
		});
		expect(files.get('/workspace/sub/main.nim')).toBe('echo "한글"');
		frame({
			method: 'textDocument/didChange',
			params: { textDocument: { uri }, contentChanges: [{ text: 'echo "saved"' }] }
		});
		expect(files.get('/workspace/sub/main.nim')).toBe('echo "한글"');
		frame({ method: 'textDocument/didSave', params: { textDocument: { uri } } });
		expect(files.get('/workspace/sub/main.nim')).toBe('echo "saved"');
		for (const forbidden of [
			'file:///nim/lib/system.nim',
			'file:///workspace/%2e%2e%2fnim/lib/system.nim',
			'file://remote/workspace/main.nim'
		])
			frame({
				method: 'textDocument/didOpen',
				params: { textDocument: { uri: forbidden, text: 'changed' } }
			});
		expect([...files.keys()]).toEqual(['/workspace/sub/main.nim']);
	});
	it('sends standard didSave only when the host explicitly enables autosave', async () => {
		const worker = new FakeWorker();
		const handle = await getNimLanguageServer({
			...options(worker),
			nim: { baseUrl: 'https://cdn.test/wasm-nim-lsp/', autoSave: true }
		});
		const queue = new SharedByteQueue(worker.messages[0].options.stdin);
		const uri = 'file:///workspace/main.nim';
		await handle.transport.writer.write({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: { textDocument: { uri, text: 'echo "hi"' } }
		});
		const bytes = new Uint8Array(4096);
		const framed = new TextDecoder().decode(bytes.subarray(0, queue.readBlocking(bytes)));
		expect(framed).toContain('textDocument/didOpen');
		expect(framed).toContain('textDocument/didSave');
		expect(framed.match(/Content-Length:/g)).toHaveLength(2);
		handle.dispose();
	});
});
