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
let browser, server, temporary, origin;

before(async () => {
	temporary = await mkdtemp(path.join(os.tmpdir(), 'fennel-lsp-browser-'));
	await build({
		entryPoints: [path.join(ROOT, 'packages/lsp/src/fennel/worker.ts')],
		outfile: path.join(temporary, 'worker.js'),
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
				response.end('<!doctype html><title>Original Fennel LSP browser test</title>');
				return;
			}
			if (url.pathname === '/worker.js') {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(await readFile(path.join(temporary, 'worker.js')));
				return;
			}
			const name = url.pathname.split('/').at(-1);
			if (!['engine.mjs', 'lua.wasm', 'fennel-ls.lua'].includes(name))
				throw new Error('Unknown asset');
			let bytes = await readFile(path.join(ROOT, 'static/wasm-fennel-lsp', name));
			if (url.pathname.startsWith('/tampered/') && name === 'engine.mjs')
				bytes = Buffer.concat([bytes, Buffer.from(' ')]);
			response.setHeader(
				'Content-Type',
				name.endsWith('.mjs')
					? 'text/javascript'
					: name.endsWith('.wasm')
						? 'application/wasm'
						: 'text/plain'
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
	'original Fennel dispatcher serves real browser diagnostics and semantic requests',
	{ timeout: 60_000 },
	async () => {
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		try {
			await page.goto(origin);
			const result = await page.evaluate(async () => {
				const worker = new Worker('/worker.js', { type: 'module' });
				const messages = [];
				let sequence = 0;
				const pending = new Map();
				const ready = new Promise((resolve, reject) => {
					worker.addEventListener('message', ({ data }) => {
						messages.push(data);
						if (data.type === 'ready') resolve();
						if (data.type === 'error') reject(new Error(data.message));
						const waiter = pending.get(data.id);
						if (waiter) {
							pending.delete(data.id);
							if (data.error) waiter.reject(new Error(data.error.message));
							else waiter.resolve(data.result);
						}
					});
					worker.addEventListener('error', (event) => reject(new Error(event.message)));
				});
				const request = (method, params) =>
					new Promise((resolve, reject) => {
						const id = ++sequence;
						pending.set(id, { resolve, reject });
						worker.postMessage({ jsonrpc: '2.0', id, method, params });
					});
				const notify = (method, params) =>
					worker.postMessage({ jsonrpc: '2.0', method, params });
				try {
					worker.postMessage({
						type: 'init',
						persistentAssets: { persistentCache: false },
						options: { baseUrl: `${location.origin}/assets/` }
					});
					await ready;
					const initialize = await request('initialize', {
						rootUri: 'file:///workspace',
						capabilities: { textDocument: { publishDiagnostics: {} } }
					});
					notify('initialized', {});
					const textDocument = { uri: 'file:///workspace/main.fnl' };
					const earlyCodeActions = request('textDocument/codeAction', {
						textDocument,
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						context: { diagnostics: [] }
					});
					notify('textDocument/didOpen', {
						textDocument: {
							...textDocument,
							languageId: 'fennel',
							version: 1,
							text: '(local answer 42)\n(print answer)'
						}
					});
					const documentPosition = { textDocument, position: { line: 1, character: 8 } };
					const codeActions = await earlyCodeActions;
					const hover = await request('textDocument/hover', documentPosition);
					const definition = await request('textDocument/definition', documentPosition);
					const rename = await request('textDocument/rename', {
						...documentPosition,
						newName: 'result'
					});
					notify('textDocument/didChange', {
						textDocument: { ...textDocument, version: 2 },
						contentChanges: [{ text: '(local answer 42)\n(print ans)' }]
					});
					const completion = await request('textDocument/completion', {
						textDocument,
						position: { line: 1, character: 10 }
					});
					notify('textDocument/didChange', {
						textDocument: { ...textDocument, version: 3 },
						contentChanges: [{ text: '(local answer ' }]
					});
					await request('textDocument/documentSymbol', { textDocument });
					const brokenDiagnostics = messages
						.filter((message) => message.method === 'textDocument/publishDiagnostics')
						.at(-1)?.params.diagnostics;
					notify('textDocument/didChange', {
						textDocument: { ...textDocument, version: 4 },
						contentChanges: [{ text: '(local answer 42)\n(print answer)' }]
					});
					await request('textDocument/documentSymbol', { textDocument });
					const clearedDiagnostics = messages
						.filter((message) => message.method === 'textDocument/publishDiagnostics')
						.at(-1)?.params.diagnostics;
					return {
						initialize,
						hover,
						codeActions,
						definition,
						rename,
						completion,
						brokenDiagnostics,
						clearedDiagnostics
					};
				} finally {
					worker.terminate();
				}
			});
			assert.equal(result.initialize.serverInfo.name, 'fennel-ls');
			assert.equal(result.initialize.capabilities.positionEncoding, 'utf-16');
			assert.match(result.hover.contents.value, /42/);
			assert.ok(Array.isArray(result.codeActions));
			assert.equal(result.definition.uri, 'file:///workspace/main.fnl');
			assert.equal(result.definition.range.start.line, 0);
			assert.equal(result.rename.changes['file:///workspace/main.fnl'].length, 2);
			const completions = Array.isArray(result.completion)
				? result.completion
				: result.completion.items;
			assert.ok(completions.some((item) => item.label === 'answer'));
			assert.ok(result.brokenDiagnostics.length > 0);
			assert.deepEqual(result.clearedDiagnostics, []);
		} finally {
			await context.close();
		}
	}
);

test('tampered original runtime is rejected before evaluation', { timeout: 30_000 }, async () => {
	const context = await browser.newContext();
	await addBrowserTestCookies(context, origin);
	try {
		const page = await context.newPage();
		await page.goto(origin);
		const error = await page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const worker = new Worker('/worker.js', { type: 'module' });
					worker.onmessage = ({ data }) => {
						if (data.type === 'error') {
							worker.terminate();
							resolve(data.message);
						}
						if (data.type === 'ready') {
							worker.terminate();
							reject(new Error('Tampered runtime was accepted'));
						}
					};
					worker.postMessage({
						type: 'init',
						persistentAssets: { persistentCache: false },
						options: { baseUrl: `${location.origin}/tampered/` }
					});
				})
		);
		assert.match(error, /integrity|size|hash|SHA-256/iu);
	} finally {
		await context.close();
	}
});
