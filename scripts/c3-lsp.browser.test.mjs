import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildC3Lsp, c3LspLock } from './build-c3-lsp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_C3_LSP === '1';
const source =
	'module main;\nfn int square(int value) { return value * value; }\nfn void main() { int n = square(5); }\n';
const uri = 'file:///workspace/main.c3';
const libraryUri = 'file:///workspace/math.c3';
const invalidSource = source + '\\\n';
const library =
	'module main;\nfn int wasm_idle_c3_cube(int value) { return value * value * value; }\n';
const crossSource = 'module main;\nfn void main() { int n = wasm_idle_c3_cube(5); }\n';
const at = (documentUri, content, token, after = 1) => {
	const index = content.lastIndexOf(token) + after;
	const prefix = content.slice(0, index).split('\n');
	return {
		textDocument: { uri: documentUri },
		position: { line: prefix.length - 1, character: prefix.at(-1).length }
	};
};
const messages = [
	{ id: 1, method: 'initialize', params: { capabilities: {} } },
	{ method: 'initialized', params: {} },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri, languageId: 'c3', version: 1, text: source } }
	},
	{ id: 2, method: 'textDocument/completion', params: at(uri, source, 'square', 4) },
	{ id: 3, method: 'textDocument/hover', params: at(uri, source, 'square') },
	{ id: 4, method: 'textDocument/definition', params: at(uri, source, 'square') },
	{ id: 5, method: 'textDocument/signatureHelp', params: at(uri, source, 'square', 8) },
	{ id: 6, method: 'textDocument/documentSymbol', params: { textDocument: { uri } } },
	{
		id: 7,
		method: 'textDocument/rename',
		params: { ...at(uri, source, 'square'), newName: 'squared' }
	},
	{
		id: 8,
		method: 'textDocument/references',
		params: { ...at(uri, source, 'square'), context: { includeDeclaration: true } }
	},
	{
		id: 19,
		method: 'textDocument/codeAction',
		params: {
			textDocument: { uri },
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
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
	{ id: 10, method: 'textDocument/completion', params: at(uri, source, 'square', 4) },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri: libraryUri, languageId: 'c3', version: 1, text: library } }
	},
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 4 }, contentChanges: [{ text: crossSource }] }
	},
	{
		id: 11,
		method: 'textDocument/definition',
		params: at(uri, crossSource, 'wasm_idle_c3_cube')
	},
	{ id: 12, method: 'textDocument/hover', params: at(uri, crossSource, 'wasm_idle_c3_cube') },
	{
		id: 13,
		method: 'textDocument/completion',
		params: at(uri, crossSource, 'wasm_idle_c3_cube', 3)
	},
	{
		id: 14,
		method: 'textDocument/signatureHelp',
		params: at(uri, crossSource, 'wasm_idle_c3_cube', 'wasm_idle_c3_cube'.length + 2)
	},
	{
		id: 15,
		method: 'textDocument/documentHighlight',
		params: at(uri, crossSource, 'wasm_idle_c3_cube')
	},
	{
		id: 16,
		method: 'textDocument/documentSymbol',
		params: { textDocument: { uri: libraryUri } }
	},
	{ id: 17, method: 'workspace/symbol', params: { query: 'wasm_idle_c3_cube' } },
	{ id: 18, method: 'textDocument/semanticTokens/full', params: { textDocument: { uri } } },
	{ id: 20, method: 'workspace/symbol', params: { query: 'printfn' } }
].map((message) => ({ jsonrpc: '2.0', ...message }));

async function runNative(executable, stdlibDirectory) {
	const child = spawn(
		executable,
		[
			`--stdlib-path=${stdlibDirectory}`,
			'--compiler-path=/__disabled_c3c__',
			'--diagnostics-delay=0'
		],
		{
			cwd: path.dirname(executable),
			stdio: ['pipe', 'pipe', 'pipe']
		}
	);
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
	'real upstream C3 LSP reactor in Chromium preserves native semantic results',
	{ skip: !enabled, timeout: 600_000 },
	async (t) => {
		const [{ build }, { chromium }, { resolveChromiumExecutable }, { addBrowserTestCookies }] =
			await Promise.all([
				import('esbuild'),
				import('playwright-core'),
				import('./rust-browser-probe-lib.mjs'),
				import('./browser-test-cookies.mjs')
			]);
		console.log('[C3 LSP real] verifying upstream assets');
		const { nativePath, stdlibDirectory } = await buildC3Lsp({
			buildNative: true
		});
		const native = await runNative(nativePath, stdlibDirectory);
		console.log('[C3 LSP real] native transcript complete');
		const temporary = await mkdtemp(path.join(root, '.cache/c3-lsp-browser-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		for (const [entry, output] of [
			['language-server.ts', 'client.mjs'],
			['worker.ts', 'worker.mjs']
		]) {
			await build({
				entryPoints: [path.join(root, 'packages/lsp/src/c3', entry)],
				outfile: path.join(temporary, output),
				bundle: true,
				platform: 'browser',
				format: 'esm',
				target: 'es2022',
				conditions: ['browser']
			});
		}
		console.log('[C3 LSP real] SDK browser bundles built');
		const requests = [];
		const server = createServer(async (request, response) => {
			requests.push(request.url);
			const pathname = new URL(request.url, 'http://localhost').pathname;
			if (pathname === '/') {
				response.setHeader(
					'Content-Security-Policy',
					"default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'"
				);
				return response.end('<!doctype html><title>C3 original LSP browser test</title>');
			}
			const name = path.basename(pathname);
			if (pathname.startsWith('/bad/'))
				return response.end(Buffer.alloc(c3LspLock.assets[name].bytes));
			const asset = {
				'/client.mjs': [path.join(temporary, 'client.mjs'), 'application/javascript'],
				'/worker.mjs': [path.join(temporary, 'worker.mjs'), 'application/javascript'],
				...Object.fromEntries(
					Object.keys(c3LspLock.assets).map((name) => [
						'/wasm-c3-lsp/' + name,
						[
							path.join(root, 'static/wasm-c3-lsp', name),
							name.endsWith('.mjs')
								? 'application/javascript'
								: name.endsWith('.wasm')
									? 'application/wasm'
									: 'application/gzip'
						]
					])
				)
			}[pathname];
			if (!asset) {
				response.writeHead(404);
				return response.end();
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
		console.log('[C3 LSP real] Chromium ready');
		assert.equal(requests.filter((value) => value.includes('.wasm')).length, 0);
		const browserResult = await page.evaluate(
			async ({ messages, uri }) => {
				const { getC3LanguageServer } = await import('/client.mjs');
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
					const handle = await getC3LanguageServer(options);
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
					params: { textDocument: { uri: 'file:///workspace/math.c3' } }
				});
				const closed = await first.send({
					jsonrpc: '2.0',
					id: 41,
					method: 'workspace/symbol',
					params: { query: 'wasm_idle_c3_cube' }
				});
				await first.send({ jsonrpc: '2.0', id: 42, method: 'shutdown', params: null });
				await first.send({ jsonrpc: '2.0', method: 'exit' });
				first.subscription.dispose();
				first.handle.dispose();
				first.handle.dispose();
				const second = await connect();
				await second.send(messages[0]);
				const isolated = await second.send({
					jsonrpc: '2.0',
					id: 50,
					method: 'workspace/symbol',
					params: { query: 'wasm_idle_c3_cube' }
				});
				second.subscription.dispose();
				second.handle.dispose();
				let integrityError = '';
				try {
					await getC3LanguageServer({
						...options,
						c3: { baseUrl: new URL('/bad/', location.href).href }
					});
				} catch (error) {
					integrityError = String(error);
				}
				const controller = new AbortController();
				controller.abort();
				let aborted = false;
				try {
					await getC3LanguageServer({ ...options, signal: controller.signal });
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
		console.log('[C3 LSP real] browser transcript complete');
		assert.deepEqual(errors, []);
		const result = browserResult.results;
		assert.equal(result[1].result.serverInfo.version, c3LspLock.version);
		assert.equal(result[1].result.capabilities.hoverProvider, true);
		assert.equal(result[1].result.capabilities.textDocumentSync.change, 1);
		assert.ok(result[2].result.items.some((item) => item.label === 'square'));
		assert.match(JSON.stringify(result[3].result), /square/);
		assert.equal(result[4].result.uri, uri);
		assert.equal(result[4].result.range.start.line, 1);
		assert.ok(result[5].result.signatures.length > 0);
		assert.match(JSON.stringify(result[6].result), /square/i);
		assert.match(JSON.stringify(result[7].result), /squared/);
		assert.ok(result[8].result.length >= 1);
		assert.ok(result[10].result.items.some((item) => item.label === 'square'));
		assert.equal(result[11].result.uri, libraryUri);
		assert.match(JSON.stringify(result[12].result), /wasm_idle_c3_cube/);
		assert.ok(result[13].result.items.some((item) => item.label === 'wasm_idle_c3_cube'));
		assert.ok(result[14].result.signatures.length > 0);
		assert.ok(Array.isArray(result[15].result));
		assert.match(JSON.stringify(result[16].result), /wasm_idle_c3_cube/i);
		assert.match(JSON.stringify(result[17].result), /wasm_idle_c3_cube/i);
		assert.ok(result[18].result.data.length > 0);
		assert.ok(
			result[20].result.some(
				(symbol) =>
					symbol.name === 'printfn' &&
					symbol.location.uri.startsWith('file:///c3/lib/std/')
			)
		);
		assert.ok(Array.isArray(result[19].result));
		assert.deepEqual(browserResult.beforeOpenResult.result, []);
		assert.deepEqual(browserResult.isolated.result, []);
		assert.deepEqual(browserResult.closed.result, []);
		assert.equal(browserResult.unknown.error.code, -32601);
		const diagnostics = browserResult.notifications.filter(
			(message) =>
				message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri
		);
		const invalidIndex = diagnostics.findIndex((message) =>
			message.params.diagnostics.some(
				(diagnostic) => diagnostic.message === 'Invalid character'
			)
		);
		assert.ok(invalidIndex >= 0);
		assert.ok(
			diagnostics
				.slice(invalidIndex + 1)
				.some((message) => message.params.diagnostics.length === 0)
		);
		assert.deepEqual(
			diagnostics[invalidIndex].params.diagnostics,
			native.notifications.find(
				(message) =>
					message.method === 'textDocument/publishDiagnostics' &&
					message.params.uri === uri &&
					message.params.diagnostics.some(
						(diagnostic) => diagnostic.message === 'Invalid character'
					)
			).params.diagnostics
		);

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
				JSON.parse(
					JSON.stringify(native.results[id].result).replaceAll(
						pathToFileURL(`${stdlibDirectory}/`).href,
						'file:///c3/lib/std/'
					)
				),
				`original native parity, request ${id}`
			);
		}
		// Standard-library locations use the browser's virtual root in place of the native disk root.
		const canonicalSymbols = (symbols) =>
			symbols.map((symbol) => JSON.stringify(symbol)).sort();
		assert.deepEqual(
			canonicalSymbols(result[20].result),
			canonicalSymbols(
				JSON.parse(
					JSON.stringify(native.results[20].result).replaceAll(
						pathToFileURL(`${stdlibDirectory}/`).href,
						'file:///c3/lib/std/'
					)
				)
			)
		);

		t.diagnostic(
			'C3 LSP 0.4.0: real Emscripten Worker semantics/diagnostics, original native parity, cross-file definition, edits, close, disposal, integrity and abort passed'
		);
	}
);
