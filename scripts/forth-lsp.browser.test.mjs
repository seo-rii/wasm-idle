import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildForthLsp, forthLspLock } from './build-forth-lsp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_FORTH_LSP === '1';
const source = ': square ( n -- n ) dup * ;\n5 square . cr\n';
const uri = 'file:///workspace/main.fs';
const libraryUri = 'file:///workspace/math.fs';
const invalidSource = ': square ( n -- n ) dup * ;\n5 not-defined . cr\n';
const library = ': cube ( n -- n ) dup dup * * ;\n';
const at = (documentUri, line, character) => ({
	textDocument: { uri: documentUri },
	position: { line, character }
});
const messages = [
	{ id: 1, method: 'initialize', params: { capabilities: {} } },
	{ method: 'initialized', params: {} },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri, languageId: 'forth', version: 1, text: source } }
	},
	{ id: 2, method: 'textDocument/completion', params: at(uri, 1, 4) },
	{ id: 3, method: 'textDocument/hover', params: at(uri, 1, 4) },
	{ id: 4, method: 'textDocument/definition', params: at(uri, 1, 4) },
	{ id: 5, method: 'textDocument/signatureHelp', params: at(uri, 1, 8) },
	{ id: 6, method: 'textDocument/documentSymbol', params: { textDocument: { uri } } },
	{ id: 7, method: 'textDocument/rename', params: { ...at(uri, 1, 4), newName: 'squared' } },
	{
		id: 8,
		method: 'textDocument/references',
		params: { ...at(uri, 1, 4), context: { includeDeclaration: true } }
	},
	{
		id: 19,
		method: 'textDocument/codeAction',
		params: {
			textDocument: { uri },
			range: {
				start: { line: 0, character: source.indexOf('dup *') },
				end: { line: 0, character: source.indexOf('dup *') + 5 }
			},
			context: { diagnostics: [] }
		}
	},
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: invalidSource }] }
	},
	{ id: 9, method: 'textDocument/documentSymbol', params: { textDocument: { uri } } },
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: source }] }
	},
	{ id: 10, method: 'textDocument/completion', params: at(uri, 1, 4) },
	{
		method: 'textDocument/didOpen',
		params: {
			textDocument: { uri: libraryUri, languageId: 'forth', version: 1, text: library }
		}
	},
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 4 }, contentChanges: [{ text: '5 cube . cr\n' }] }
	},
	{ id: 11, method: 'textDocument/definition', params: at(uri, 0, 4) },
	{ id: 12, method: 'textDocument/hover', params: at(uri, 0, 4) },
	{ id: 13, method: 'textDocument/completion', params: at(uri, 0, 4) },
	{ id: 14, method: 'textDocument/signatureHelp', params: at(uri, 0, 6) },
	{
		id: 15,
		method: 'textDocument/formatting',
		params: { textDocument: { uri: libraryUri }, options: { tabSize: 2, insertSpaces: true } }
	},
	{
		id: 16,
		method: 'textDocument/documentSymbol',
		params: { textDocument: { uri: libraryUri } }
	},
	{ id: 17, method: 'workspace/symbol', params: { query: 'cube' } },
	{ id: 18, method: 'textDocument/semanticTokens/full', params: { textDocument: { uri } } }
].map((message) => ({ jsonrpc: '2.0', ...message }));

async function runNative(executable) {
	const child = spawn(executable, [], {
		cwd: path.dirname(executable),
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let buffer = Buffer.alloc(0);
	const pending = new Map();
	const notifications = [];
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-4000);
	});
	child.stdout.on('data', (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (true) {
			const separator = buffer.indexOf('\r\n\r\n');
			if (separator < 0) break;
			const header = buffer.subarray(0, separator).toString();
			const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
			if (!Number.isSafeInteger(length) || length < 0)
				throw new Error(`invalid native LSP header ${header}`);
			if (buffer.length < separator + 4 + length) break;
			const message = JSON.parse(
				buffer.subarray(separator + 4, separator + 4 + length).toString()
			);
			buffer = buffer.subarray(separator + 4 + length);
			if (message.id !== undefined && !message.method) pending.get(message.id)?.(message);
			else notifications.push(message);
		}
	});
	const send = (message) => {
		const body = Buffer.from(JSON.stringify(message));
		const response =
			message.id === undefined
				? Promise.resolve(null)
				: new Promise((resolve, reject) => {
						const timer = setTimeout(
							() =>
								reject(new Error(`native ${message.method} timed out: ${stderr}`)),
							20_000
						);
						pending.set(message.id, (result) => {
							clearTimeout(timer);
							pending.delete(message.id);
							resolve(result);
						});
					});
		child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		child.stdin.write(body);
		return response;
	};
	try {
		const results = {};
		for (const message of messages) {
			let response = await send(message);
			if (response) results[message.id] = response;
		}
		await send({ jsonrpc: '2.0', id: 99, method: 'shutdown', params: null });
		await send({ jsonrpc: '2.0', method: 'exit' });
		return { results, notifications };
	} finally {
		child.kill();
		child.stdin.destroy();
	}
}

test(
	'real upstream Forth LSP reactor in Chromium preserves native semantic results',
	{ skip: !enabled, timeout: 600_000 },
	async (t) => {
		const [{ build }, { chromium }, { resolveChromiumExecutable }, { addBrowserTestCookies }] =
			await Promise.all([
				import('esbuild'),
				import('playwright-core'),
				import('./rust-browser-probe-lib.mjs'),
				import('./browser-test-cookies.mjs')
			]);
		console.log('[Forth LSP real] verifying upstream assets');
		const { nativePath } = await buildForthLsp({
			buildNative: true,
			archivePath: process.env.FORTH_LSP_SOURCE_ARCHIVE
		});
		const native = await runNative(nativePath);
		console.log('[Forth LSP real] native transcript complete');
		const temporary = await mkdtemp(path.join(root, '.cache/forth-lsp-browser-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		for (const [entry, output] of [
			['language-server.ts', 'client.mjs'],
			['worker.ts', 'worker.mjs']
		]) {
			await build({
				entryPoints: [path.join(root, 'packages/lsp/src/forth', entry)],
				outfile: path.join(temporary, output),
				bundle: true,
				platform: 'browser',
				format: 'esm',
				target: 'es2022',
				conditions: ['browser']
			});
		}
		console.log('[Forth LSP real] SDK browser bundles built');
		const wasmPath = path.join(root, 'static/wasm-forth-lsp/forth_lsp.wasm');
		const requests = [];
		const server = createServer(async (request, response) => {
			requests.push(request.url);
			const pathname = new URL(request.url, 'http://localhost').pathname;
			if (pathname === '/')
				return response.end('<!doctype html><title>Forth LSP browser integration</title>');
			if (pathname === '/bad.wasm') {
				response.setHeader('Content-Type', 'application/wasm');
				return response.end(Buffer.alloc(forthLspLock.wasm.bytes));
			}
			const asset = {
				'/client.mjs': [path.join(temporary, 'client.mjs'), 'application/javascript'],
				'/worker.mjs': [path.join(temporary, 'worker.mjs'), 'application/javascript'],
				'/wasm-forth-lsp/forth_lsp.wasm': [wasmPath, 'application/wasm']
			}[pathname];
			if (!asset) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.setHeader('Content-Type', asset[1]);
			createReadStream(asset[0]).pipe(response);
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		t.after(
			() =>
				new Promise((resolve) => {
					server.close(resolve);
					server.closeAllConnections();
				})
		);
		const url = `http://127.0.0.1:${server.address().port}/`;
		const browser = await chromium.launch({
			executablePath: await resolveChromiumExecutable(),
			headless: true
		});
		t.after(() => browser.close());
		const context = await browser.newContext();
		await addBrowserTestCookies(context, url);
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(url);
		console.log('[Forth LSP real] Chromium ready');
		assert.equal(requests.filter((value) => value.includes('.wasm')).length, 0);
		const browserResult = await page.evaluate(
			async ({ messages, uri }) => {
				const { getForthLanguageServer } = await import('/client.mjs');
				const statuses = [];
				let workers = 0;
				let terminations = 0;
				const options = {
					currentUrl: location.href,
					rootUrl: location.origin,
					persistentCache: false,
					createWorker: () => {
						workers += 1;
						const worker = new Worker('/worker.mjs', { type: 'module' });
						const terminate = worker.terminate.bind(worker);
						worker.terminate = () => {
							terminations += 1;
							terminate();
						};
						return worker;
					},
					onStatus: (status) => statuses.push(status)
				};
				const connect = async () => {
					const handle = await getForthLanguageServer(options);
					const pending = new Map();
					const notifications = [];
					const subscription = handle.transport.reader.listen((message) => {
						if (message.id !== undefined) pending.get(message.id)?.(message);
						else notifications.push(message);
					});
					return {
						handle,
						subscription,
						notifications,
						async send(message) {
							const result =
								message.id === undefined
									? Promise.resolve(null)
									: new Promise((resolve, reject) => {
											const timer = setTimeout(
												() =>
													reject(
														new Error(
															`browser ${message.method} timed out`
														)
													),
												20_000
											);
											pending.set(message.id, (result) => {
												clearTimeout(timer);
												pending.delete(message.id);
												resolve(result);
											});
										});
							await handle.transport.writer.write(message);
							return await result;
						}
					};
				};
				const first = await connect();
				const results = {};
				let beforeOpen;
				for (const message of messages) {
					const response = await first.send(message);
					if (response) results[message.id] = response;
					if (message.method === 'initialized') {
						beforeOpen = first.send({
							jsonrpc: '2.0',
							id: 38,
							method: 'textDocument/codeAction',
							params: {
								textDocument: { uri },
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 0 }
								},
								context: { diagnostics: [] }
							}
						});
					}
				}
				const beforeOpenResult = await beforeOpen;
				const unknown = await first.send({
					jsonrpc: '2.0',
					id: 40,
					method: 'textDocument/notARealMethod',
					params: {}
				});
				await first.send({
					jsonrpc: '2.0',
					method: 'textDocument/didClose',
					params: { textDocument: { uri } }
				});
				await first.send({
					jsonrpc: '2.0',
					method: 'textDocument/didClose',
					params: { textDocument: { uri: 'file:///workspace/math.fs' } }
				});
				const closed = await first.send({
					jsonrpc: '2.0',
					id: 41,
					method: 'workspace/symbol',
					params: { query: 'cube' }
				});
				first.subscription.dispose();
				first.handle.dispose();
				first.handle.dispose();
				const second = await connect();
				await second.send(messages[0]);
				const isolated = await second.send({
					jsonrpc: '2.0',
					id: 50,
					method: 'workspace/symbol',
					params: { query: 'cube' }
				});
				second.subscription.dispose();
				second.handle.dispose();
				let integrityError = '';
				try {
					await getForthLanguageServer({ ...options, forth: { wasmUrl: '/bad.wasm' } });
				} catch (error) {
					integrityError = String(error);
				}
				const controller = new AbortController();
				controller.abort();
				let aborted = false;
				try {
					await getForthLanguageServer({ ...options, signal: controller.signal });
				} catch (error) {
					aborted = error.name === 'AbortError';
				}
				return {
					results,
					beforeOpenResult,
					unknown,
					closed,
					isolated,
					workers,
					terminations,
					statuses,
					integrityError,
					aborted,
					notifications: first.notifications
				};
			},
			{ messages, uri }
		);
		console.log('[Forth LSP real] browser transcript complete');
		assert.deepEqual(errors, []);
		const result = browserResult.results;
		assert.equal(result[1].result.serverInfo.version, forthLspLock.version);
		assert.equal(result[1].result.capabilities.hoverProvider, true);
		assert.equal(result[1].result.capabilities.textDocumentSync, 2);
		assert.ok(result[2].result.some((item) => item.label.toLowerCase() === 'square'));
		assert.match(JSON.stringify(result[3].result), /square/);
		assert.ok(
			result[4].result.some(
				(location) => location.uri === uri && location.range.start.line === 0
			)
		);
		assert.ok(result[5].result.signatures.length > 0);
		assert.match(JSON.stringify(result[6].result), /square/i);
		assert.match(JSON.stringify(result[7].result), /squared/);
		assert.ok(result[8].result.length >= 2);
		assert.ok(result[10].result.some((item) => item.label.toLowerCase() === 'square'));
		assert.ok(result[11].result.some((location) => location.uri === libraryUri));
		assert.match(JSON.stringify(result[12].result), /cube/);
		assert.ok(result[13].result.some((item) => item.label.toLowerCase() === 'cube'));
		assert.ok(result[14].result.signatures.length > 0);
		assert.ok(Array.isArray(result[15].result));
		assert.match(JSON.stringify(result[16].result), /cube/i);
		assert.match(JSON.stringify(result[17].result), /cube/i);
		assert.ok(result[18].result.data.length > 0);
		assert.match(JSON.stringify(result[19].result), /refactor\.extract/);
		assert.deepEqual(browserResult.beforeOpenResult.result, []);
		assert.deepEqual(browserResult.isolated.result, []);
		assert.deepEqual(browserResult.closed.result, []);
		assert.equal(browserResult.unknown.error.code, -32601);
		const diagnosticsFor = (notifications, version) =>
			notifications.find(
				(message) =>
					message.method === 'textDocument/publishDiagnostics' &&
					message.params.uri === uri &&
					message.params.version === version
			)?.params.diagnostics;
		const invalidDiagnostics = diagnosticsFor(browserResult.notifications, 2);
		assert.ok(
			invalidDiagnostics.some(
				(diagnostic) =>
					diagnostic.code === 'undefined-word' &&
					diagnostic.range.start.line === 1 &&
					diagnostic.message.includes('not-defined')
			)
		);
		assert.deepEqual(diagnosticsFor(browserResult.notifications, 3), []);
		assert.deepEqual(invalidDiagnostics, diagnosticsFor(native.notifications, 2));

		assert.equal(browserResult.workers, 2, 'failed preflight must not create a worker');
		assert.equal(
			browserResult.terminations,
			2,
			'dispose must terminate each worker exactly once'
		);
		assert.equal(browserResult.aborted, true);
		assert.match(browserResult.integrityError, /integrity|SHA-256|sha256/i);
		assert.ok(browserResult.statuses.some((status) => status.state === 'loading'));
		assert.ok(browserResult.statuses.some((status) => status.state === 'ready'));
		assert.ok(browserResult.statuses.some((status) => status.state === 'error'));
		for (const id of [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
			assert.deepEqual(
				result[id].result,
				native.results[id].result,
				`original native parity, request ${id}`
			);
		}

		t.diagnostic(
			'Forth LSP 0.9.0: real WASI Worker semantics/diagnostics, original native parity, cross-file definition, edits, close, disposal, integrity and abort passed'
		);
	}
);
