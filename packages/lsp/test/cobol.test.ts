import { describe, expect, it, vi } from 'vitest';
import { SharedByteQueue } from '@wasm-idle/llvm-core/debug';
import { getCobolLanguageServer } from '../src/cobol/language-server.js';
import { createCobolLspHost } from '../../../scripts/runtime-workers/cobol-lsp-host.mjs';

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
	cobol: { baseUrl: 'https://cdn.test/wasm-cobol-lsp/' },
	createWorker: () => worker as unknown as Worker
});

describe('original COBOL stdio SDK host', () => {
	it('requires explicit roots, isolation and bounded valid workspace paths', async () => {
		await expect(getCobolLanguageServer()).rejects.toThrow(/baseUrl or rootUrl/);
		const worker = new FakeWorker();
		await expect(
			getCobolLanguageServer({
				...options(worker),
				cobol: { baseUrl: 'https://cdn.test/?unversioned', workspaceFiles: [] }
			})
		).rejects.toThrow(/plain HTTP/);
		await expect(
			getCobolLanguageServer({
				...options(worker),
				cobol: {
					baseUrl: 'https://cdn.test/',
					workspaceFiles: [{ path: '../escape.cob', content: '' }]
				}
			})
		).rejects.toThrow(/workspace file/);
		expect(worker.messages).toEqual([]);
	});
	it('uses real stdio JSON-RPC framing and terminates idempotently', async () => {
		const worker = new FakeWorker();
		const statuses: unknown[] = [];
		const handle = await getCobolLanguageServer({
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
		await expect(getCobolLanguageServer(options(failed))).rejects.toThrow(
			'original server failed'
		);
		expect(failed.terminate).toHaveBeenCalledOnce();
		const pending = new FakeWorker('none');
		const controller = new AbortController();
		const promise = getCobolLanguageServer({ ...options(pending), signal: controller.signal });
		await vi.waitFor(() => expect(pending.messages).toHaveLength(1));
		controller.abort(new Error('language changed'));
		await expect(promise).rejects.toThrow('language changed');
		expect(pending.terminate).toHaveBeenCalledOnce();
	});
});

describe('COBOL js_of_ocaml platform adapter', () => {
	it('supplies immutable source snapshots and actual stdio bytes', () => {
		const output: number[] = [];
		const host = createCobolLspHost({
			files: [{ path: '/workspace/main.cob', data: new TextEncoder().encode('STOP RUN.') }],
			onStdin: (buffer: Uint8Array) => {
				buffer.set([65]);
				return 1;
			},
			onStdout: (bytes: Uint8Array) => output.push(...bytes),
			onStderr: () => {}
		});
		const fs = host.require('node:fs');
		expect(host.process.cwd()).toBe('/workspace');
		expect(host.process.env.COB_CONFIG_DIR).toBe('/superbol/gnucobol-config');
		expect(new TextDecoder().decode(host.readFile('/workspace/main.cob'))).toBe('STOP RUN.');
		expect(() => fs.mkdirSync('/workspace/_superbol')).toThrow(
			expect.objectContaining({ code: 'EACCES', errno: -13 })
		);
		expect(() => fs.openSync('/workspace/main.cob', 1)).toThrow(
			expect.objectContaining({ code: 'EACCES' })
		);
		const readonly = fs.openSync('/workspace/main.cob', 0);
		expect(() => fs.writeSync(readonly, new Uint8Array([88]), 0, 1)).toThrow(
			expect.objectContaining({ code: 'EACCES' })
		);
		expect(new TextDecoder().decode(host.readFile('/workspace/main.cob'))).toBe('STOP RUN.');
		fs.closeSync(readonly);
		const bytes = new Uint8Array(1);
		expect(fs.readSync(0, bytes, 0, 1)).toBe(1);
		expect([...bytes]).toEqual([65]);
		fs.writeSync(1, bytes, 0, 1);
		expect(output).toEqual([65]);
	});
});
