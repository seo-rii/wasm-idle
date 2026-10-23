import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_GRAIN_LSP === '1';
let browser, server, temporary, origin;

before(async () => {
	if (!enabled) return;
	temporary = await mkdtemp(path.join(os.tmpdir(), 'grain-lsp-browser-'));
	await build({
		entryPoints: [path.join(ROOT, 'packages/lsp/src/grain/worker.ts')],
		outfile: path.join(temporary, 'worker.js'),
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'es2022'
	});
	await build({
		entryPoints: [path.join(ROOT, 'packages/lsp/src/grain/index.ts')],
		outfile: path.join(temporary, 'client.js'),
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'es2022'
	});
	server = createServer(async (request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader(
			'Content-Security-Policy',
			"default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:"
		);
		try {
			const url = new URL(request.url, 'http://localhost');
			if (url.pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>Original Grain LSP browser test</title>');
				return;
			}
			if (['/worker.js', '/client.js'].includes(url.pathname)) {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(await readFile(path.join(temporary, url.pathname.slice(1))));
				return;
			}
			const name = url.pathname.split('/').at(-1);
			if (!['host.mjs', 'grainlsp.js.gz.bin', 'stdlib.pack.gz.bin'].includes(name))
				throw new Error('Unknown asset');
			let bytes = await readFile(path.join(ROOT, 'static/wasm-grain-lsp', name));
			if (url.pathname.startsWith('/tampered/') && name === 'host.mjs')
				bytes = Buffer.concat([bytes, Buffer.from(' ')]);
			response.setHeader(
				'Content-Type',
				name.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream'
			);
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		)
	});
});
after(async () => {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	if (temporary) await rm(temporary, { recursive: true, force: true });
});

test(
	'unmodified upstream Grain LSP serves semantics and edit diagnostics through the actual SDK',
	{ timeout: 90_000, skip: !enabled },
	async () => {
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		try {
			await page.goto(origin);
			const result = await page.evaluate(async () => {
				const { getGrainLanguageServer } = await import('/client.js');
				const handle = await getGrainLanguageServer({
					grain: {
						baseUrl: `${location.origin}/assets/`,
						workspaceFiles: [
							{
								path: 'greeting.gr',
								content:
									'module Greeting\n\nprovide let message = "from workspace"\n'
							}
						]
					},
					createWorker: () => new Worker('/worker.js', { type: 'module' }),
					persistentCache: false
				});
				const pending = new Map();
				const messages = [];
				let id = 0;
				handle.transport.reader.listen((message) => {
					messages.push(message);
					const waiter = pending.get(message.id);
					if (waiter) {
						pending.delete(message.id);
						if (message.error) waiter.reject(Error(message.error.message));
						else waiter.resolve(message.result);
					}
				});
				const request = (method, params) =>
					new Promise((resolve, reject) => {
						const requestId = ++id;
						pending.set(requestId, { resolve, reject });
						void handle.transport.writer
							.write({ jsonrpc: '2.0', id: requestId, method, params })
							.catch(reject);
					});
				const notify = (method, params) =>
					handle.transport.writer.write({ jsonrpc: '2.0', method, params });
				try {
					const initialize = await request('initialize', {
						processId: null,
						rootUri: 'file:///workspace',
						capabilities: { textDocument: { publishDiagnostics: {} } }
					});
					await notify('initialized', {});
					const textDocument = { uri: 'file:///workspace/main.gr' };
					const valid =
						'module Main\nfrom "./greeting.gr" include Greeting\nlet answer = 42\nprint(answer)\nlet fromWorkspace = Greeting.message\nprint(fromWorkspace)\n';
					await notify('textDocument/didOpen', {
						textDocument: {
							...textDocument,
							languageId: 'grain',
							version: 1,
							text: valid
						}
					});
					const position = { textDocument, position: { line: 3, character: 8 } };
					const hover = await request('textDocument/hover', position);
					const definition = await request('textDocument/definition', position);
					const moduleDefinition = await request('textDocument/definition', {
						textDocument,
						position: { line: 4, character: 32 }
					});
					const moduleHover = await request('textDocument/hover', {
						textDocument,
						position: { line: 4, character: 32 }
					});
					const projectHover = await request('textDocument/hover', {
						textDocument,
						position: { line: 5, character: 10 }
					});
					const symbols = await request('textDocument/documentSymbol', { textDocument });
					const initialDiagnostics = messages
						.filter((m) => m.method === 'textDocument/publishDiagnostics')
						.at(-1)?.params.diagnostics;
					const formatting = await request('textDocument/formatting', {
						textDocument,
						options: { tabSize: 2, insertSpaces: true }
					});
					await notify('textDocument/didChange', {
						textDocument: { ...textDocument, version: 2 },
						contentChanges: [
							{ text: 'module Main\nlet answer = missing\nprint(answer)\n' }
						]
					});
					await request('textDocument/documentSymbol', { textDocument });
					const broken = messages
						.filter((m) => m.method === 'textDocument/publishDiagnostics')
						.at(-1)?.params.diagnostics;
					await notify('textDocument/didChange', {
						textDocument: { ...textDocument, version: 3 },
						contentChanges: [{ text: valid }]
					});
					await request('textDocument/hover', position);
					const cleared = messages
						.filter((m) => m.method === 'textDocument/publishDiagnostics')
						.at(-1)?.params.diagnostics;
					await request('shutdown', null);
					return {
						initialize,
						hover,
						definition,
						moduleDefinition,
						moduleHover,
						projectHover,
						symbols,
						initialDiagnostics,
						formatting,
						broken,
						cleared
					};
				} finally {
					handle.dispose();
					handle.dispose();
				}
			});
			assert.equal(result.initialize.capabilities.textDocumentSync, 1);
			assert.equal(result.initialize.capabilities.renameProvider, false);
			assert.equal(result.initialize.capabilities.completionProvider, undefined);
			assert.match(result.hover.contents.value, /Number/);
			assert.ok(JSON.stringify(result.definition).includes('main.gr'));
			assert.deepEqual(result.initialDiagnostics, []);
			// The standalone original CLI produces these same cross-file and null responses.
			assert.ok(JSON.stringify(result.moduleDefinition).includes('greeting.gr'));
			assert.match(JSON.stringify(result.moduleHover), /String/);
			assert.equal(result.projectHover, null);
			assert.ok(JSON.stringify(result.symbols).includes('answer'));
			assert.ok(Array.isArray(result.formatting));
			assert.ok(result.broken.length > 0);
			assert.deepEqual(result.cleared, []);
		} finally {
			await context.close();
		}
	}
);

test(
	'altered browser host fails integrity before original server starts',
	{ timeout: 30_000, skip: !enabled },
	async () => {
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		try {
			const page = await context.newPage();
			await page.goto(origin);
			const error = await page.evaluate(async () => {
				const { getGrainLanguageServer } = await import('/client.js');
				try {
					await getGrainLanguageServer({
						grain: { baseUrl: `${location.origin}/tampered/` },
						createWorker: () => new Worker('/worker.js', { type: 'module' }),
						persistentCache: false
					});
					return 'accepted';
				} catch (error) {
					return String(error);
				}
			});
			assert.match(error, /integrity|size|hash|SHA-256/iu);
		} finally {
			await context.close();
		}
	}
);
