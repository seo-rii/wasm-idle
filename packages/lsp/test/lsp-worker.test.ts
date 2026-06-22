import { describe, expect, it, vi } from 'vitest';

import { startWorkerLanguageServer, type WorkerLanguageService } from '../src/index.js';

class FakeWorkerScope {
	readonly messages: unknown[] = [];
	private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void) {
		if (type === 'message') this.listeners.add(listener);
	}

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	dispatch(message: unknown) {
		for (const listener of this.listeners) {
			listener({ data: message } as MessageEvent<unknown>);
		}
	}
}

describe('startWorkerLanguageServer', () => {
	it('accepts Monaco didChange notifications that arrive before didOpen', async () => {
		const source = '<?php\nfunction main() {\n';
		const scope = new FakeWorkerScope();
		const diagnostics = vi.fn<WorkerLanguageService['diagnostics']>((document) => [
			{
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 1 }
				},
				severity: 1,
				source: 'test-lsp',
				message: `saw ${document.text.length} bytes`
			}
		]);

		startWorkerLanguageServer(
			{
				name: 'test-lsp',
				diagnosticDelay: 0,
				diagnostics
			},
			scope
		);

		scope.dispatch({ type: 'init' });
		scope.dispatch({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri: 'file:///workspace/main.php', version: 3 },
				contentChanges: [{ text: source }]
			}
		});

		await vi.waitFor(() =>
			expect(scope.messages).toContainEqual({
				jsonrpc: '2.0',
				method: 'textDocument/publishDiagnostics',
				params: {
					uri: 'file:///workspace/main.php',
					diagnostics: [
						{
							range: {
								start: { line: 1, character: 0 },
								end: { line: 1, character: 1 }
							},
							severity: 1,
							source: 'test-lsp',
							message: `saw ${source.length} bytes`
						}
					]
				}
			})
		);
		expect(diagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				uri: 'file:///workspace/main.php',
				languageId: '',
				version: 3,
				text: source
			}),
			expect.any(Object)
		);
	});

	it('returns neutral responses for feature requests before a document is open', async () => {
		const scope = new FakeWorkerScope();

		startWorkerLanguageServer({ name: 'test-lsp' }, scope);
		scope.dispatch({ type: 'init' });
		scope.dispatch({
			jsonrpc: '2.0',
			id: 1,
			method: 'textDocument/documentSymbol',
			params: {
				textDocument: { uri: 'file:///workspace/main.php' }
			}
		});
		scope.dispatch({
			jsonrpc: '2.0',
			id: 2,
			method: 'textDocument/hover',
			params: {
				textDocument: { uri: 'file:///workspace/main.php' },
				position: { line: 0, character: 0 }
			}
		});

		expect(scope.messages).toContainEqual({ jsonrpc: '2.0', id: 1, result: [] });
		expect(scope.messages).toContainEqual({ jsonrpc: '2.0', id: 2, result: null });
	});

	it('reports numeric progress for worker initialization stages', async () => {
		const scope = new FakeWorkerScope();

		startWorkerLanguageServer(
			{
				name: 'test-lsp',
				initialize(_options, context) {
					context.reportProgress('load-test-runtime');
					context.reportProgress('download-test-runtime', 3, 6);
				}
			},
			scope
		);
		scope.dispatch({ type: 'init' });

		await vi.waitFor(() => expect(scope.messages).toContainEqual({ type: 'ready' }));
		expect(scope.messages).toContainEqual({
			type: 'progress',
			stage: 'startup',
			loaded: 0,
			total: 1
		});
		expect(scope.messages).toContainEqual({
			type: 'progress',
			stage: 'load-test-runtime',
			loaded: 0.45,
			total: 1
		});
		expect(scope.messages).toContainEqual({
			type: 'progress',
			stage: 'download-test-runtime',
			loaded: 3,
			total: 6
		});
		expect(scope.messages).toContainEqual({
			type: 'progress',
			stage: 'ready',
			loaded: 1,
			total: 1
		});
	});

	it('treats structured-clone notifications with id undefined as notifications', async () => {
		const scope = new FakeWorkerScope();
		const diagnostics = vi.fn<WorkerLanguageService['diagnostics']>(() => []);

		startWorkerLanguageServer(
			{
				name: 'test-lsp',
				diagnosticDelay: 0,
				diagnostics
			},
			scope
		);

		scope.dispatch({ type: 'init' });
		scope.dispatch({
			jsonrpc: '2.0',
			id: undefined,
			method: 'textDocument/didOpen',
			params: {
				textDocument: {
					uri: 'file:///workspace/main.ts',
					languageId: 'typescript',
					version: 1,
					text: 'const value: number = "x";\n'
				}
			}
		});

		await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1));
		expect(scope.messages).not.toContainEqual(
			expect.objectContaining({
				jsonrpc: '2.0',
				id: null,
				error: expect.any(Object)
			})
		);
	});

	it('skips stale diagnostics before invoking a language service', async () => {
		const scope = new FakeWorkerScope();
		const diagnostics = vi.fn<WorkerLanguageService['diagnostics']>(() => []);

		startWorkerLanguageServer(
			{
				name: 'test-lsp',
				diagnosticDelay: 0,
				diagnostics
			},
			scope
		);

		scope.dispatch({ type: 'init' });
		scope.dispatch({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: {
				textDocument: {
					uri: 'file:///workspace/main.ts',
					languageId: 'typescript',
					version: 1,
					text: 'const value = 1;\n'
				}
			}
		});
		scope.dispatch({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri: 'file:///workspace/main.ts', version: 2 },
				contentChanges: [{ text: 'const value: number = "x";\n' }]
			}
		});

		await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(1));
		expect(diagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				version: 2,
				text: 'const value: number = "x";\n'
			}),
			expect.any(Object)
		);
	});
});
