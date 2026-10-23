import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { phpantomLock, syncPhpantomLsp, verifyPhpantomAsset } from './sync-phpantom-lsp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PHP_LSP === '1';
const source = `<?php
// 한글 😀: preserve UTF-8 source text through the reactor ABI.
class Greeter {
    public function hello(string $name): string { return "Hello, " . $name; }
}
$g = new Greeter();
$g->hello('world');
`;
const uri = 'file:///phpantom-test/index.php';
const messages = [
	{ id: 1, method: 'initialize', params: { capabilities: {} } },
	{ method: 'initialized', params: {} },
	{
		method: 'textDocument/didOpen',
		params: { textDocument: { uri, languageId: 'php', version: 1, text: source } }
	},
	{
		id: 2,
		method: 'textDocument/completion',
		params: { textDocument: { uri }, position: { line: 6, character: 4 } }
	},
	{
		id: 3,
		method: 'textDocument/hover',
		params: { textDocument: { uri }, position: { line: 6, character: 6 } }
	},
	{
		id: 4,
		method: 'textDocument/definition',
		params: { textDocument: { uri }, position: { line: 6, character: 6 } }
	},
	{
		id: 5,
		method: 'textDocument/signatureHelp',
		params: { textDocument: { uri }, position: { line: 6, character: 10 } }
	},
	{
		id: 6,
		method: 'textDocument/documentHighlight',
		params: { textDocument: { uri }, position: { line: 6, character: 6 } }
	},
	{
		id: 7,
		method: 'textDocument/rename',
		params: { textDocument: { uri }, position: { line: 6, character: 6 }, newName: 'welcome' }
	},
	{ id: 8, method: 'textDocument/notARealMethod', params: {} },
	{
		method: 'textDocument/didChange',
		params: {
			textDocument: { uri, version: 2 },
			contentChanges: [{ text: source.replaceAll('hello', 'welcome') }]
		}
	},
	{
		id: 9,
		method: 'textDocument/completion',
		params: { textDocument: { uri }, position: { line: 6, character: 4 } }
	},
	{
		id: 10,
		method: 'textDocument/hover',
		params: { textDocument: { uri }, position: { line: 6, character: 6 } }
	},
	{ method: 'textDocument/didClose', params: { textDocument: { uri } } },
	{
		id: 11,
		method: 'textDocument/hover',
		params: { textDocument: { uri }, position: { line: 6, character: 6 } }
	}
].map((message) => ({ jsonrpc: '2.0', ...message }));

async function prepareNative() {
	assert.equal(process.platform, 'linux', 'native parity requires Linux x86-64');
	assert.equal(process.arch, 'x64', 'native parity requires Linux x86-64');
	const directory = path.join(root, '.cache/phpantom-native-0.11.1');
	await mkdir(directory, { recursive: true });
	const archivePath = path.join(directory, 'native.tar.gz');
	let archive;
	try {
		archive = await readFile(process.env.PHPANTOM_NATIVE_ARCHIVE || archivePath);
	} catch {
		const response = await fetch(phpantomLock.nativeLinuxX64.url, {
			signal: AbortSignal.timeout(120_000)
		});
		assert.ok(response.ok, `native download: HTTP ${response.status}`);
		archive = Buffer.from(await response.arrayBuffer());
	}
	verifyPhpantomAsset(archive, phpantomLock.nativeLinuxX64, 'native archive');
	await writeFile(archivePath, archive);
	await promisify(execFile)('tar', ['-xzf', archivePath, '-C', directory, 'phpantom_lsp']);
	const executable = path.join(directory, 'phpantom_lsp');
	await chmod(executable, 0o700);
	return executable;
}

async function runNative(executable) {
	const child = spawn(executable, ['--stdio'], {
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
			if (message.id === 9) {
				// The native server debounces didChange analysis; its WASI dispatcher is synchronous.
				const deadline = Date.now() + 10_000;
				while (
					!JSON.stringify(response?.result).includes('welcome') &&
					Date.now() < deadline
				) {
					await new Promise((resolve) => setTimeout(resolve, 25));
					response = await send(message);
				}
			}
			if (response) results[message.id] = response;
		}
		await send({ jsonrpc: '2.0', id: 99, method: 'shutdown', params: null });
		await send({ jsonrpc: '2.0', method: 'exit' });
		return results;
	} finally {
		child.kill();
		child.stdin.destroy();
	}
}

test(
	'real upstream PHPantom reactor in Chromium preserves native semantic results',
	{ skip: !enabled, timeout: 600_000 },
	async (t) => {
		const [{ build }, { chromium }, { resolveChromiumExecutable }, { addBrowserTestCookies }] =
			await Promise.all([
				import('esbuild'),
				import('playwright-core'),
				import('./rust-browser-probe-lib.mjs'),
				import('./browser-test-cookies.mjs')
			]);
		console.log('[PHPantom real] verifying upstream assets');
		await syncPhpantomLsp({ archivePath: process.env.PHPANTOM_LSP_ARCHIVE });
		const native = await runNative(await prepareNative());
		console.log('[PHPantom real] native transcript complete');
		const temporary = await mkdtemp(path.join(root, '.cache/phpantom-browser-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		for (const [entry, output] of [
			['language-server.ts', 'client.mjs'],
			['worker.ts', 'worker.mjs']
		]) {
			await build({
				entryPoints: [path.join(root, 'packages/lsp/src/php', entry)],
				outfile: path.join(temporary, output),
				bundle: true,
				platform: 'browser',
				format: 'esm',
				target: 'es2022',
				conditions: ['browser']
			});
		}
		console.log('[PHPantom real] SDK browser bundles built');
		const wasmPath = path.join(root, 'static/wasm-phpantom-lsp/phpantom_lsp.wasm');
		const requests = [];
		const server = createServer(async (request, response) => {
			requests.push(request.url);
			const pathname = new URL(request.url, 'http://localhost').pathname;
			if (pathname === '/')
				return response.end('<!doctype html><title>PHPantom browser integration</title>');
			if (pathname === '/bad.wasm') {
				response.setHeader('Content-Type', 'application/wasm');
				return response.end(Buffer.alloc(phpantomLock.wasm.bytes));
			}
			const asset = {
				'/client.mjs': [path.join(temporary, 'client.mjs'), 'application/javascript'],
				'/worker.mjs': [path.join(temporary, 'worker.mjs'), 'application/javascript'],
				'/wasm-phpantom-lsp/phpantom_lsp.wasm': [wasmPath, 'application/wasm']
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
		console.log('[PHPantom real] Chromium ready');
		assert.equal(requests.filter((value) => value.includes('.wasm')).length, 0);
		const browserResult = await page.evaluate(
			async ({ messages, uri }) => {
				const { getPhpLanguageServer } = await import('/client.mjs');
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
					const handle = await getPhpLanguageServer(options);
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
				for (const message of messages) {
					const response = await first.send(message);
					if (response) results[message.id] = response;
				}
				first.subscription.dispose();
				first.handle.dispose();
				first.handle.dispose();
				const second = await connect();
				await second.send(messages[0]);
				const isolated = await second.send({
					jsonrpc: '2.0',
					id: 50,
					method: 'textDocument/hover',
					params: { textDocument: { uri }, position: { line: 6, character: 6 } }
				});
				second.subscription.dispose();
				second.handle.dispose();
				let integrityError = '';
				try {
					await getPhpLanguageServer({ ...options, php: { wasmUrl: '/bad.wasm' } });
				} catch (error) {
					integrityError = String(error);
				}
				const controller = new AbortController();
				controller.abort();
				let aborted = false;
				try {
					await getPhpLanguageServer({ ...options, signal: controller.signal });
				} catch (error) {
					aborted = error.name === 'AbortError';
				}
				return {
					results,
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
		console.log('[PHPantom real] browser transcript complete');
		assert.deepEqual(errors, []);
		const result = browserResult.results;
		assert.equal(result[1].result.serverInfo.version, phpantomLock.version);
		assert.equal(result[1].result.capabilities.hoverProvider, true);
		assert.equal(result[1].result.capabilities.diagnosticProvider, undefined);
		assert.equal(result[1].result.capabilities.textDocumentSync, 1);
		const items = result[2].result?.items || result[2].result;
		assert.ok(items.some((item) => item.label.startsWith('hello')));
		assert.match(JSON.stringify(result[3].result), /hello/);
		assert.ok(
			result[4].result.some(
				(location) => location.uri === uri && location.range.start.line === 3
			)
		);
		assert.match(JSON.stringify(result[5].result), /\$name/);
		assert.ok(result[6].result.length > 0);
		assert.match(JSON.stringify(result[7].result), /welcome/);
		assert.equal(result[8].error.code, -32601);
		assert.ok(
			(result[9].result?.items || result[9].result).some((item) =>
				item.label.startsWith('welcome')
			)
		);
		assert.match(JSON.stringify(result[10].result), /welcome/);
		assert.equal(result[11].result, null);
		assert.equal(browserResult.isolated.result, null);
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
		assert.ok(
			!browserResult.notifications.some(
				(message) => message.method === 'textDocument/publishDiagnostics'
			)
		);
		for (const id of [2, 3, 4, 5, 6, 9, 10]) {
			// LSP permits a single Location or Location[]; upstream's two transports use different forms.
			const normalize = (value) =>
				id === 4 && value && !Array.isArray(value) ? [value] : value;
			assert.deepEqual(
				normalize(result[id].result),
				normalize(native[id].result),
				`same-version native parity: ${messages.find((message) => message.id === id).method}, request ${id}`
			);
		}
		t.diagnostic(
			'PHPantom 0.11.1: real WASI Worker semantic results, native parity, edits, close, disposal, integrity and abort passed'
		);
	}
);
