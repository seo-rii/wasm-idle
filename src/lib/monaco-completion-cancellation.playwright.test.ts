// @vitest-environment node

import { createServer, type Server } from 'node:http';
import { basename } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_COMPLETION_CANCELLATION === '1';

describe.skipIf(!enabled)('Monaco completion cancellation in real Chromium', () => {
	let server: Server;
	let browser: Browser;
	let origin: string;

	beforeAll(async () => {
		const bundle = await build({
			stdin: {
				resolveDir: process.cwd(),
				contents: `
					import { MonacoLspClient } from 'monaco-editor/esm/external/monaco-lsp-client/out/index.js';
					import { languages, editor, Uri, CancellationTokenSource } from 'monaco-editor/esm/vs/editor/editor.api2.js';
					window.completionCancellationProbe = async () => {
						let provider;
						const register = languages.registerCompletionItemProvider;
						languages.registerCompletionItemProvider = (selector, value) => {
							provider = value;
							return register(selector, value);
						};
						const messages = [];
						let receive;
						const transport = {
							state: {value: {state: 'open'}, onChange: () => ({dispose() {}})},
							setListener(listener) {receive = listener;},
							async send(message) {
								messages.push(message);
								if (message.method === 'initialize') queueMicrotask(() => receive({
									jsonrpc: '2.0', id: message.id,
									result: {capabilities: {completionProvider: {resolveProvider: true}, textDocumentSync: 1}}
								}));
							}
						};
						const client = new MonacoLspClient(transport);
						await client._initPromise;
						languages.registerCompletionItemProvider = register;
						languages.register({id: 'completion-cancellation-fixture'});
						const model = editor.createModel('int main() {}', 'completion-cancellation-fixture', Uri.parse('file:///workspace/main.cpp'));
						const first = new CancellationTokenSource();
						const second = new CancellationTokenSource();
						const position = {lineNumber: 1, column: 2};
						const context = {triggerKind: languages.CompletionTriggerKind.Invoke};
						const obsolete = provider.provideCompletionItems(model, position, context, first.token)
							.then(() => 'fulfilled', error => error.name);
						const valid = provider.provideCompletionItems(model, position, context, second.token);
						const requests = messages.filter(message => message.method === 'textDocument/completion');
						first.cancel();
						const cancelledName = await obsolete;
						receive({jsonrpc: '2.0', id: requests[0].id, result: [{label: 'obsolete'}]});
						receive({jsonrpc: '2.0', id: requests[1].id, result: [{label: 'valid', detail: 'kept'}]});
						const item = (await valid).suggestions[0];
						const resolveToken = new CancellationTokenSource();
						const resolving = provider.resolveCompletionItem(item, resolveToken.token)
							.then(() => 'fulfilled', error => error.name);
						const resolveRequest = messages.find(message => message.method === 'completionItem/resolve');
						resolveToken.cancel();
						const resolveCancelledName = await resolving;
						receive({jsonrpc: '2.0', id: resolveRequest.id, result: {label: 'valid', detail: 'late'}});
						await Promise.resolve();
						const cancels = messages.filter(message => message.method === '$/cancelRequest');
						second.cancel();
						await Promise.resolve();
						const outcome = {
							cancelledName, resolveCancelledName, label: item.label, detail: item.detail,
							requestIds: [requests[0].id, resolveRequest.id],
							cancelIds: cancels.map(message => message.params.id),
							cancelCount: messages.filter(message => message.method === '$/cancelRequest').length,
							pending: client._connection.connection._requestSender._unprocessedResponses.size
						};
						model.dispose();
						first.dispose(); second.dispose(); resolveToken.dispose();
						return outcome;
					};`
			},
			bundle: true,
			format: 'iife',
			platform: 'browser',
			outfile: 'harness.js',
			loader: { '.ttf': 'dataurl' },
			write: false
		});
		const assets = new Map(bundle.outputFiles.map((file) => [`/${basename(file.path)}`, file]));
		server = createServer((request, response) => {
			const pathname = new URL(request.url || '/', 'http://fixture.test').pathname;
			if (pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><link rel="stylesheet" href="/harness.css"><script src="/harness.js"></script>'
				);
			} else if (assets.has(pathname)) {
				response.setHeader(
					'Content-Type',
					pathname.endsWith('.css') ? 'text/css' : 'text/javascript'
				);
				response.end(assets.get(pathname)!.contents);
			} else {
				response.statusCode = 404;
				response.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Fixture server did not listen');
		origin = `http://127.0.0.1:${address.port}`;
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('sends exact completion and resolve cancellations and preserves a concurrent valid result', async () => {
		const context = await browser.newContext();
		try {
			await addBrowserTestCookies(context, origin);
			const page = await context.newPage();
			await page.goto(origin);
			const result = await page.evaluate(async () => {
				return await (
					window as unknown as {
						completionCancellationProbe: () => Promise<{
							cancelledName: string;
							resolveCancelledName: string;
							label: string;
							detail: string;
							requestIds: number[];
							cancelIds: number[];
							cancelCount: number;
							pending: number;
						}>;
					}
				).completionCancellationProbe();
			});
			expect(result).toMatchObject({
				cancelledName: 'Canceled',
				resolveCancelledName: 'Canceled',
				label: 'valid',
				detail: 'kept',
				cancelCount: 2,
				pending: 0
			});
			expect(result.cancelIds).toEqual(result.requestIds);
		} finally {
			await context.close();
		}
	}, 30_000);
});
