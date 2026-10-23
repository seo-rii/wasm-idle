import { describe, expect, it, vi } from 'vitest';
import { SharedByteQueue, type SharedByteQueueDescriptor } from '@wasm-idle/llvm-core/debug';
import * as rpc from 'vscode-jsonrpc/browser';
import { getGrainLanguageServer } from '../src/grain/language-server.js';
import type { LanguageServerStatus } from '../src/worker-client.js';

describe('Grain server project snapshot admission', () => {
	it.each(['/absolute.gr', '../escape.gr', 'sub/../escape.gr', 'sub\\escape.gr'])(
		'rejects unsafe project path %s before creating a worker',
		async (path) => {
			const createWorker = vi.fn();
			await expect(
				getGrainLanguageServer({
					grain: {
						baseUrl: 'https://example.test/wasm-grain-lsp/',
						workspaceFiles: [{ path, content: 'module Main' }]
					},
					createWorker
				})
			).rejects.toThrow('Invalid Grain LSP workspace file');
			expect(createWorker).not.toHaveBeenCalled();
		}
	);
	it('bounds workspace snapshot count before starting a worker', async () => {
		const createWorker = vi.fn();
		await expect(
			getGrainLanguageServer({
				grain: {
					baseUrl: 'https://example.test/wasm-grain-lsp/',
					workspaceFiles: Array.from({ length: 1001 }, (_, index) => ({
						path: `module${index}.gr`,
						content: 'module Main'
					}))
				},
				createWorker
			})
		).rejects.toThrow('1000 files');
		expect(createWorker).not.toHaveBeenCalled();
	});
});

class GrainWorker extends EventTarget {
	readonly terminate = vi.fn();
	stdin?: SharedByteQueue;

	postMessage(message: { options: { stdin: SharedByteQueueDescriptor } }) {
		this.stdin = new SharedByteQueue(message.options.stdin);
		queueMicrotask(() => this.emit({ type: 'ready' }));
	}

	emit(data: unknown) {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

describe('Grain server transport termination', () => {
	it.each(['server error', 'worker error', 'exit'])(
		'closes the transport and releases pending requests and writes after %s',
		async (kind) => {
			const worker = new GrainWorker();
			const statuses: LanguageServerStatus[] = [];
			const handle = await getGrainLanguageServer({
				grain: { baseUrl: 'https://example.test/wasm-grain-lsp/' },
				createWorker: () => worker as unknown as Worker,
				onStatus: (status) => statuses.push(status)
			});
			const connection = rpc.createMessageConnection(
				handle.transport.reader,
				handle.transport.writer
			);
			let closeCount = 0;
			// A language client disposes its JSON-RPC connection when the transport closes.
			connection.onClose(() => {
				closeCount++;
				connection.dispose();
			});
			connection.listen();
			try {
				const pending = connection
					.sendRequest('textDocument/hover', {
						textDocument: { uri: 'file:///workspace/main.gr' }
					})
					.then(
						(value) => ({ value }),
						(error) => ({ error })
					);
				await vi.waitFor(() => expect(worker.stdin!.available).toBeGreaterThan(0));
				// Fill the real shared queue while the worker is no longer reading stdin.
				let writeOutcome: { written: boolean } | { error: unknown } | undefined;
				const change: rpc.NotificationMessage = {
					jsonrpc: '2.0',
					method: 'textDocument/didChange',
					params: { text: 'x'.repeat(128 * 1024) }
				};
				const writing = handle.transport.writer.write(change).then(
					() => {
						writeOutcome = { written: true };
					},
					(error) => {
						writeOutcome = { error };
					}
				);
				await vi.waitFor(() => expect(worker.stdin!.remaining).toBe(0));
				if (kind === 'worker error') {
					worker.dispatchEvent(
						Object.assign(new Event('error'), { error: new Error('runtime failed') })
					);
				} else {
					worker.emit(
						kind === 'exit'
							? { type: 'exit', code: 0 }
							: { type: 'error', message: 'runtime failed' }
					);
				}
				await vi.waitFor(() => expect(closeCount).toBe(1));
				expect(await pending).toMatchObject({ error: expect.any(Error) });
				await vi.waitFor(() =>
					expect(writeOutcome).toMatchObject({ error: expect.any(Error) })
				);
				await writing;
				expect(connection.hasPendingResponse()).toBe(false);
				expect(worker.stdin!.closed).toBe(true);
				expect(worker.terminate).toHaveBeenCalledOnce();
				expect(statuses.at(-1)).toEqual(
					kind === 'exit'
						? { state: 'disabled' }
						: { state: 'error', message: 'runtime failed' }
				);
				const completedStatuses = [...statuses];
				worker.emit({ type: 'error', message: 'late failure' });
				handle.dispose();
				expect(worker.terminate).toHaveBeenCalledOnce();
				expect(statuses).toEqual(completedStatuses);
			} finally {
				connection.dispose();
				handle.dispose();
			}
		}
	);
});
