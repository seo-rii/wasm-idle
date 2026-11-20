import { describe, expect, it, vi } from 'vitest';

import {
	createTypeScriptWorkerService,
	startWorkerLanguageServer,
	type WorkerLanguageService
} from '../src/index.js';

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
	it('updates TypeScript importers after dependency edits, closes and version-one reopens', async () => {
		const scope = new FakeWorkerScope();
		startWorkerLanguageServer(createTypeScriptWorkerService('typescript'), scope);
		scope.dispatch({
			type: 'init',
			options: { libFiles: {}, compilerOptions: { noLib: true } }
		});
		await vi.waitFor(() => expect(scope.messages).toContainEqual({ type: 'ready' }));
		const main = 'file:///workspace/main.ts',
			helper = 'file:///workspace/value.ts';
		const open = (uri: string, text: string) =>
			scope.dispatch({
				jsonrpc: '2.0',
				method: 'textDocument/didOpen',
				params: { textDocument: { uri, languageId: 'typescript', version: 1, text } }
			});
		const has = (uri: string, code?: number) =>
			expect(scope.messages).toContainEqual(
				expect.objectContaining({
					method: 'textDocument/publishDiagnostics',
					params: {
						uri,
						diagnostics: code
							? expect.arrayContaining([expect.objectContaining({ code })])
							: []
					}
				})
			);
		open(helper, 'export const value = 42;');
		open(main, 'import { value } from "./value"; export const n: number = value;');
		await vi.waitFor(() => has(main), { timeout: 4000 });
		scope.messages.length = 0;
		scope.dispatch({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri: helper, version: 2 },
				contentChanges: [{ text: 'export const value = "changed";' }]
			}
		});
		await vi.waitFor(() => has(main, 2322), { timeout: 4000 });
		scope.messages.length = 0;
		scope.dispatch({
			jsonrpc: '2.0',
			method: 'textDocument/didClose',
			params: { textDocument: { uri: helper } }
		});
		await vi.waitFor(() => has(main, 2307), { timeout: 4000 });
		scope.messages.length = 0;
		open(helper, 'export const value: number = "reopened";');
		await vi.waitFor(() => has(helper, 2322), { timeout: 4000 });
		await vi.waitFor(() => has(main), { timeout: 4000 });
		scope.dispatch({ jsonrpc: '2.0', method: 'exit' });
	});

	it('waits for service disposal once across shutdown and exit', async () => {
		const scope = new FakeWorkerScope();
		let release!: () => void;
		const dispose = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		startWorkerLanguageServer({ name: 'test', dispose }, scope);
		scope.dispatch({ jsonrpc: '2.0', id: 42, method: 'shutdown' });
		scope.dispatch({ jsonrpc: '2.0', method: 'exit' });
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		expect(scope.messages).not.toContainEqual({ jsonrpc: '2.0', id: 42, result: null });
		release();
		await vi.waitFor(() =>
			expect(scope.messages).toContainEqual({ jsonrpc: '2.0', id: 42, result: null })
		);
		scope.dispatch({ jsonrpc: '2.0', method: 'exit' });
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('releases partially initialized resources on exit and suppresses a late ready message', async () => {
		const scope = new FakeWorkerScope();
		let finish!: () => void;
		const initialize = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const dispose = vi.fn();
		startWorkerLanguageServer({ name: 'test', initialize, dispose }, scope);
		scope.dispatch({ type: 'init' });
		await vi.waitFor(() => expect(initialize).toHaveBeenCalledOnce());
		scope.dispatch({ jsonrpc: '2.0', method: 'exit' });
		expect(dispose).not.toHaveBeenCalled();
		finish();
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		expect(scope.messages).not.toContainEqual({ type: 'ready' });
	});

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
