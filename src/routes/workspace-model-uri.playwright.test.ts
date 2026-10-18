// @vitest-environment node

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled =
	process.env.WASM_IDLE_RUN_MONACO_URI_BROWSER === '1' ||
	process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP === '1';

describe.runIf(enabled)('workspace URI through the Monaco LSP adapter', () => {
	it('keeps diagnostics and definitions attached to literal filenames', async () => {
		const require = createRequire(import.meta.url);
		const sessionModule = resolve(
			dirname(require.resolve('@seorii/monaco/extensions')),
			'lspSession.js'
		);
		const helperModule = resolve('src/routes/workspace-model-uri.ts');
		const bundle = await build({
			stdin: {
				resolveDir: process.cwd(),
				contents: `
					import * as monaco from 'monaco-editor';
					import { CancellationToken } from 'monaco-editor/esm/vs/base/common/cancellation.js';
					import { ILanguageFeaturesService } from 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js';
					import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js';
					import { startMonacoLspSession } from ${JSON.stringify(sessionModule)};
					import { createWorkspaceModelUri } from ${JSON.stringify(helperModule)};
					monaco.languages.register({ id: 'uri-regression' });
					window.runUriCase = async (path) => {
						const uri = createWorkspaceModelUri(monaco.Uri, path);
						const model = monaco.editor.createModel('const target = 1;\\ntarget;', 'uri-regression', uri);
						const editor = monaco.editor.create(document.getElementById('editor'), { model });
						const messages = [];
						const errors = [];
						const opened = new Set();
						let receive;
						let providerUri;
						const send = (message) => queueMicrotask(() => receive(message));
						const range = { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } };
						const stop = startMonacoLspSession({
							model,
							provider: async (_language, context) => {
								providerUri = context.uri;
								return {
									transport: {
										reader: { listen(callback) { receive = callback; return { dispose() {} }; } },
										writer: { async write(message) {
											messages.push(message);
											if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: {
												capabilities: { textDocumentSync: { openClose: true, change: 2 }, definitionProvider: true }
											} });
											if (message.method === 'textDocument/didOpen') {
												opened.add(message.params.textDocument.uri);
												send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
													uri: message.params.textDocument.uri,
													diagnostics: [{ range, severity: 1, message: 'URI regression diagnostic' }]
												} });
											}
											if (message.method === 'textDocument/definition') send({ jsonrpc: '2.0', id: message.id,
												result: opened.has(message.params.textDocument.uri) ? [{ uri: uri.toString(), range }] : null
											});
										} }
									},
									dispose() {}
								};
							},
							clientOptions: { documentSync: { openDelayMs: 0, initializedDelayMs: 0 } },
							onError: (error) => errors.push(String(error))
						});
						const waitFor = async (condition) => {
							const deadline = Date.now() + 10000;
							while (!condition()) {
								if (Date.now() > deadline) throw new Error('LSP adapter timeout: ' + JSON.stringify({ messages, errors }));
								await new Promise((resolve) => setTimeout(resolve, 10));
							}
						};
						try {
							await waitFor(() => monaco.editor.getModelMarkers({ resource: uri }).length > 0);
							const providers = StandaloneServices.get(ILanguageFeaturesService).definitionProvider;
							await waitFor(() => providers.ordered(model).length > 0);
							const definitions = await providers.ordered(model)[0].provideDefinition(model, new monaco.Position(2, 3), CancellationToken.None);
							const clonedModel = monaco.editor.getModel(monaco.Uri.parse(uri.toString()));
							const result = { providerUri, errors, modelPath: uri.path,
								definitionPath: definitions?.[0]?.uri.path,
								definitionRange: definitions?.[0]?.range,
								openedUri: messages.find((message) => message.method === 'textDocument/didOpen').params.textDocument.uri,
								requestedUri: messages.find((message) => message.method === 'textDocument/definition').params.textDocument.uri,
								marker: monaco.editor.getModelMarkers({ resource: uri })[0]?.message,
								cloneFindsModel: clonedModel === model };
							return result;
						} finally { model.dispose(); stop(); editor.dispose(); }
					};
				`
			},
			bundle: true,
			write: false,
			outfile: 'fixture.js',
			format: 'iife',
			loader: { '.ttf': 'dataurl' },
			logLevel: 'silent'
		});
		const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
		const browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		try {
			const context = await browser.newContext();
			const origin = 'http://wasm-idle-uri.test';
			await addBrowserTestCookies(context, origin);
			await context.route(`${origin}/**`, (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<div id="editor" style="width:800px;height:400px"></div>'
				})
			);
			const page = await context.newPage();
			await page.goto(origin);
			await page.addScriptTag({ content: script });
			for (const path of [
				'main%20draft.ts',
				'main%23draft.ts',
				'main#draft.ts',
				'main?draft.ts',
				'main draft.ts',
				'한글.ts'
			]) {
				const result = await page.evaluate(async (path) => {
					return await (window as any).runUriCase(path);
				}, path);
				expect(result.errors).toEqual([]);
				expect(result.modelPath).toBe(`/workspace/${path}`);
				expect(result.cloneFindsModel).toBe(true);
				expect(result.providerUri).toBe(result.openedUri);
				expect(result.requestedUri).toBe(result.openedUri);
				expect(decodeURIComponent(new URL(result.openedUri).pathname)).toBe(
					`/workspace/${path}`
				);
				expect(result.marker).toBe('URI regression diagnostic');
				expect(result.definitionPath).toBe(`/workspace/${path}`);
				expect(result.definitionRange).toEqual({
					startLineNumber: 1,
					startColumn: 7,
					endLineNumber: 1,
					endColumn: 13
				});
			}
		} finally {
			await browser.close();
		}
	}, 60000);
});
