import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildVLsp, vLspLock } from './build-v-lsp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source =
	'module main\n// Squares an integer. 한글 문서\nfn square(value int) int {\n return value * value\n}\nfn main() {\n n := square(5)\n println(n)\n}\n';
const uri = 'file:///workspace/main.v',
	libraryUri = 'file:///workspace/math.v';
const library =
	'module main\npub fn wasm_idle_v_cube(value int) int {\n return value * value * value\n}\n';
const crossSource = 'module main\nfn main() {\n n := wasm_idle_v_cube(5)\n println(n)\n}\n';
const at = (documentUri, content, token, after = 1) => {
	const prefix = content.slice(0, content.lastIndexOf(token) + after).split('\n');
	return {
		textDocument: { uri: documentUri },
		position: { line: prefix.length - 1, character: prefix.at(-1).length }
	};
};
const messages = [
	{
		id: 1,
		method: 'initialize',
		params: {
			processId: null,
			rootUri: 'file:///workspace',
			capabilities: {},
			initializationOptions: 'no-stdlib no-diagnostics no-index-save'
		}
	},
	{ method: 'initialized', params: {} },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri, languageId: 'v', version: 1, text: source } }
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
		params: {
			textDocument: { uri, version: 2 },
			contentChanges: [{ text: source.replaceAll('square', 'squared') }]
		}
	},
	{ id: 9, method: 'textDocument/documentSymbol', params: { textDocument: { uri } } },
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: source }] }
	},
	{ id: 10, method: 'textDocument/completion', params: at(uri, source, 'square', 4) },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri: libraryUri, languageId: 'v', version: 1, text: library } }
	},
	{
		method: 'textDocument/didChange',
		params: { textDocument: { uri, version: 4 }, contentChanges: [{ text: crossSource }] }
	},
	{ id: 11, method: 'textDocument/definition', params: at(uri, crossSource, 'wasm_idle_v_cube') },
	{ id: 12, method: 'textDocument/hover', params: at(uri, crossSource, 'wasm_idle_v_cube') },
	{
		id: 13,
		method: 'textDocument/completion',
		params: at(uri, crossSource, 'wasm_idle_v_cube', 3)
	},
	{
		id: 14,
		method: 'textDocument/signatureHelp',
		params: at(uri, crossSource, 'wasm_idle_v_cube', 'wasm_idle_v_cube'.length + 2)
	},
	{
		id: 15,
		method: 'textDocument/documentHighlight',
		params: at(uri, crossSource, 'wasm_idle_v_cube')
	},
	{
		id: 16,
		method: 'textDocument/documentSymbol',
		params: { textDocument: { uri: libraryUri } }
	},
	{ id: 17, method: 'workspace/symbol', params: { query: 'wasm_idle_v_cube' } },
	{ id: 18, method: 'textDocument/semanticTokens/full', params: { textDocument: { uri } } },
	{
		id: 20,
		method: 'textDocument/inlayHint',
		params: {
			textDocument: { uri },
			range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }
		}
	},
	{ id: 21, method: 'textDocument/foldingRange', params: { textDocument: { uri } } }
].map((message) => ({ jsonrpc: '2.0', ...message }));

async function runNative(executable, stdlibDirectory, temporary) {
	const workspace = path.join(temporary, 'workspace'),
		taskHome = path.join(temporary, 'home');
	await mkdir(workspace, { recursive: true });
	await mkdir(path.join(taskHome, '.vmodules'), { recursive: true });
	const nativePrefix = pathToFileURL(workspace + '/').href;
	const replace = (value) =>
		JSON.parse(
			JSON.stringify(value)
				.replaceAll('file:///workspace/', nativePrefix)
				.replaceAll('file:///workspace"', nativePrefix.slice(0, -1) + '"')
		);
	const child = spawn(executable, ['--stdio'], {
		env: {
			...process.env,
			HOME: taskHome,
			VMODULES: path.join(taskHome, '.vmodules'),
			VROOT: path.dirname(stdlibDirectory)
		},
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let buffer = Buffer.alloc(0),
		stderr = '';
	const pending = new Map(),
		notifications = [];
	child.stderr.on('data', (chunk) => {
		stderr = (stderr + chunk).slice(-3000);
	});
	child.stdout.on('data', (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (true) {
			const split = buffer.indexOf('\r\n\r\n');
			if (split < 0) break;
			const count = Number(
				/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, split).toString())?.[1]
			);
			assert.ok(Number.isSafeInteger(count));
			if (buffer.length < split + 4 + count) break;
			const reply = JSON.parse(buffer.subarray(split + 4, split + 4 + count));
			buffer = buffer.subarray(split + 4 + count);
			if (reply.id !== undefined && !reply.method) pending.get(reply.id)?.(reply);
			else notifications.push(reply);
		}
	});
	function send(message) {
		const body = Buffer.from(JSON.stringify(message));
		const result =
			message.id === undefined
				? Promise.resolve(null)
				: new Promise((resolve, reject) => {
						const timer = setTimeout(
							() =>
								reject(new Error(`native ${message.method} timed out: ${stderr}`)),
							30000
						);
						pending.set(message.id, (reply) => {
							clearTimeout(timer);
							pending.delete(message.id);
							resolve(reply);
						});
					});
		child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		child.stdin.write(body);
		return result;
	}
	try {
		const results = {},
			written = new Set();
		for (const original of messages) {
			const message = replace(original),
				doc = message.params?.textDocument;
			const text =
				message.method === 'textDocument/didOpen'
					? doc.text
					: message.method === 'textDocument/didChange'
						? message.params.contentChanges[0].text
						: undefined;
			let created = false;
			if (typeof text === 'string') {
				const filename = fileURLToPath(doc.uri);
				created = !written.has(filename);
				written.add(filename);
				await writeFile(filename, text);
			}
			const response = await send(message);
			if (message.method === 'initialized')
				await send({
					jsonrpc: '2.0',
					id: 9000,
					method: 'workspace/symbol',
					params: { query: '' }
				});
			if (response)
				results[message.id] = JSON.parse(
					JSON.stringify(response).replaceAll(nativePrefix, 'file:///workspace/')
				);
			if (created)
				await send({
					jsonrpc: '2.0',
					method: 'workspace/didChangeWatchedFiles',
					params: { changes: [{ uri: doc.uri, type: 1 }] }
				});
		}
		await send({ jsonrpc: '2.0', method: 'shutdown', params: {} });
		return { results, notifications };
	} finally {
		child.kill();
		child.stdin.destroy();
	}
}

test(
	'original v-analyzer in Chromium preserves native semantics and browser lifecycle',
	{ skip: process.env.WASM_IDLE_RUN_REAL_BROWSER_V_LSP !== '1', timeout: 600000 },
	async (t) => {
		const [{ build }, { chromium }, { resolveChromiumExecutable }, { addBrowserTestCookies }] =
			await Promise.all([
				import('esbuild'),
				import('playwright-core'),
				import('./rust-browser-probe-lib.mjs'),
				import('./browser-test-cookies.mjs')
			]);
		const temporary = await mkdtemp(path.join(root, '.cache/v-lsp-browser-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		console.log('[V LSP real] verifying qualified original assets');
		const { nativePath, stdlibDirectory } = await buildVLsp({ buildNative: true });
		const native = await runNative(nativePath, stdlibDirectory, temporary);
		console.log('[V LSP real] native transcript complete');
		for (const [entry, output] of [
			['language-server.ts', 'client.mjs'],
			['worker.ts', 'worker.mjs']
		])
			await build({
				entryPoints: [path.join(root, 'packages/lsp/src/v', entry)],
				outfile: path.join(temporary, output),
				bundle: true,
				platform: 'browser',
				format: 'esm',
				target: 'es2022',
				conditions: ['browser']
			});
		const requests = [];
		const server = createServer((request, response) => {
			requests.push(request.url);
			const pathname = new URL(request.url, 'http://localhost').pathname;
			if (pathname === '/') {
				response.setHeader(
					'Content-Security-Policy',
					"default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'"
				);
				return response.end('<!doctype html><title>V original LSP browser test</title>');
			}
			const name = path.basename(pathname);
			if (pathname.startsWith('/bad/'))
				return response.end(Buffer.alloc(vLspLock.assets[name].bytes));
			const filename =
				pathname === '/client.mjs' || pathname === '/worker.mjs'
					? path.join(temporary, name)
					: pathname.startsWith('/wasm-v-lsp/') && vLspLock.assets[name]
						? path.join(root, 'static/wasm-v-lsp', name)
						: undefined;
			if (!filename) {
				response.writeHead(404);
				return response.end();
			}
			response.setHeader(
				'Content-Type',
				name.endsWith('.mjs')
					? 'application/javascript'
					: name.endsWith('.wasm')
						? 'application/wasm'
						: 'application/octet-stream'
			);
			createReadStream(filename).pipe(response);
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
		const url = `http://127.0.0.1:${server.address().port}/`,
			browser = await chromium.launch({
				executablePath: await resolveChromiumExecutable(),
				headless: true
			});
		t.after(() => browser.close());
		const context = await browser.newContext();
		await addBrowserTestCookies(context, url);
		const page = await context.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(url);
		assert.equal(requests.filter((value) => value.includes('.wasm')).length, 0);
		const actual = await page.evaluate(
			async ({ messages, uri, crossSource, libraryUri }) => {
				const { getVLanguageServer } = await import('/client.mjs');
				const statuses = [];
				let workers = 0,
					terminations = 0;
				const options = {
					currentUrl: location.href,
					rootUrl: location.origin,
					persistentCache: false,
					onStatus: (status) => statuses.push(status),
					createWorker: () => {
						workers++;
						const worker = new Worker('/worker.mjs', { type: 'module' });
						const terminate = worker.terminate.bind(worker);
						worker.terminate = () => {
							terminations++;
							terminate();
						};
						return worker;
					}
				};
				async function connect() {
					const handle = await getVLanguageServer(options),
						pending = new Map(),
						notifications = [],
						incoming = [];
					const subscription = handle.transport.reader.listen((message) => {
						incoming.push(message);
						if (message.id !== undefined) pending.get(message.id)?.(message);
						else notifications.push(message);
					});
					return {
						handle,
						subscription,
						notifications,
						incoming,
						async send(message) {
							const response =
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
												60000
											);
											pending.set(message.id, (result) => {
												clearTimeout(timer);
												pending.delete(message.id);
												resolve(result);
											});
										});
							await handle.transport.writer.write(message);
							return response;
						}
					};
				}
				const first = await connect(),
					results = {};
				let beforeOpen;
				for (const message of messages) {
					const response = await first.send(message);
					if (response) results[message.id] = response;
					if (message.method === 'initialized') {
						beforeOpen = first.send({
							jsonrpc: '2.0',
							id: 38,
							method: 'textDocument/codeAction',
							params: messages.find((item) => item.id === 19).params
						});
						await first.handle.transport.writer.write({
							jsonrpc: '2.0',
							id: 39,
							method: 'textDocument/hover',
							params: { textDocument: { uri }, position: { line: 0, character: 0 } }
						});
						await first.send({
							jsonrpc: '2.0',
							method: '$/cancelRequest',
							params: { id: 39 }
						});
					}
				}
				const beforeOpenResult = await beforeOpen;
				for (let i = 0; i < 60; i++)
					await first.send({
						jsonrpc: '2.0',
						method: 'textDocument/didChange',
						params: {
							textDocument: { uri, version: i + 10 },
							contentChanges: [
								{ text: crossSource + '// ' + i + 'x'.repeat(16384) + '\n' }
							]
						}
					});
				const afterEdits = await first.send({
					jsonrpc: '2.0',
					id: 40,
					method: 'textDocument/hover',
					params: messages.find((item) => item.id === 12).params
				});
				for (const closedUri of [uri, libraryUri])
					await first.send({
						jsonrpc: '2.0',
						method: 'textDocument/didClose',
						params: { textDocument: { uri: closedUri } }
					});
				await first.send({ jsonrpc: '2.0', method: 'shutdown', params: {} });
				await first.send({ jsonrpc: '2.0', method: 'exit' });
				first.subscription.dispose();
				first.handle.dispose();
				first.handle.dispose();
				const second = await connect();
				await second.send({
					...messages[0],
					params: {
						...messages[0].params,
						initializationOptions: 'no-diagnostics no-index-save'
					}
				});
				await second.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
				const isolated = await second.send({
					jsonrpc: '2.0',
					id: 50,
					method: 'workspace/symbol',
					params: { query: 'wasm_idle_v_cube' }
				});
				const standardSource =
						'module main\nimport math\nfn main() {\n x := math.sqrt(4.0)\n println(x)\n}\n',
					standardUri = 'file:///workspace/standard.v';
				await second.send({
					jsonrpc: '2.0',
					method: 'textDocument/didOpen',
					params: {
						textDocument: {
							uri: standardUri,
							languageId: 'v',
							version: 1,
							text: standardSource
						}
					}
				});
				const standardDefinition = await second.send({
					jsonrpc: '2.0',
					id: 51,
					method: 'textDocument/definition',
					params: {
						textDocument: { uri: standardUri },
						position: { line: 3, character: 12 }
					}
				});
				second.subscription.dispose();
				second.handle.dispose();
				let integrityError = '';
				try {
					await getVLanguageServer({
						...options,
						v: { baseUrl: new URL('/bad/', location.href).href }
					});
				} catch (error) {
					integrityError = String(error);
				}
				const controller = new AbortController();
				controller.abort();
				let aborted = false;
				try {
					await getVLanguageServer({ ...options, signal: controller.signal });
				} catch (error) {
					aborted = error.name === 'AbortError';
				}
				return {
					results,
					beforeOpenResult,
					afterEdits,
					isolated,
					standardDefinition,
					workers,
					terminations,
					statuses,
					integrityError,
					aborted,
					notifications: first.notifications,
					cancelledResponse: first.incoming.some((message) => message.id === 39)
				};
			},
			{ messages, uri, crossSource, libraryUri }
		);
		assert.deepEqual(errors, []);
		const results = actual.results;
		assert.equal(results[1].result.serverInfo.version, vLspLock.version);
		assert.equal(results[1].result.capabilities.documentFormattingProvider, false);
		assert.ok(results[2].result.some((item) => item.label === 'square'));
		assert.match(JSON.stringify(results[3].result), /Squares an integer/);
		assert.ok(results[4].result.some((item) => item.targetUri === uri));
		assert.ok(results[5].result.signatures.length > 0);
		assert.match(JSON.stringify(results[7].result), /squared/);
		assert.match(JSON.stringify(results[9].result), /squared/);
		assert.ok(results[11].result.some((item) => item.targetUri === libraryUri));
		assert.match(JSON.stringify(results[12].result), /wasm_idle_v_cube/);
		assert.ok(results[13].result.some((item) => item.label === 'wasm_idle_v_cube'));
		assert.ok(results[18].result.data.length > 0);
		const canonical = (value) =>
			Array.isArray(value)
				? value.length && typeof value[0] === 'object'
					? value
							.map(canonical)
							.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
					: value
				: value && typeof value === 'object'
					? Object.fromEntries(
							Object.keys(value)
								.filter((key) => key !== 'resultID')
								.sort()
								.map((key) => [key, canonical(value[key])])
						)
					: value;
		for (const id of Object.keys(results).filter((id) => id !== '1'))
			assert.deepEqual(
				canonical(results[id].result),
				canonical(native.results[id].result),
				`original native semantic parity request ${id}`
			);
		assert.deepEqual(canonical(actual.beforeOpenResult.result), canonical(results[19].result));
		assert.equal(actual.cancelledResponse, false);
		assert.deepEqual(actual.afterEdits.result, results[12].result);
		assert.deepEqual(actual.isolated.result, []);
		assert.ok(
			actual.standardDefinition.result.some((item) =>
				item.targetUri.startsWith('file:///v/vlib/math/')
			),
			'original standard library must be indexed'
		);
		assert.equal(
			actual.notifications.some(
				(message) => message.method === 'textDocument/publishDiagnostics'
			),
			false
		);
		assert.equal(actual.workers, 2);
		assert.equal(actual.terminations, 2);
		assert.equal(actual.aborted, true);
		assert.match(actual.integrityError, /integrity|SHA-256|sha256/i);
		for (const state of ['loading', 'ready', 'error'])
			assert.ok(actual.statuses.some((status) => status.state === state));
		t.diagnostic(
			'Original V 0.0.6: native semantic parity, original standard library, edits with real GC, early requests/cancel, isolation, integrity, abort and disposal passed'
		);
	}
);
