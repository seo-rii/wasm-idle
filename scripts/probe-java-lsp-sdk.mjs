import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { createJavaLspClient, exerciseJavaLsp } from './probe-java-jdtls-browser.mjs';
import {
	JAVACS_PROBE_FIXTURE,
	JAVACS_SINGLE_FILE_FIXTURE,
	JAVACS_TYPE_MISMATCH
} from './probe-java-javacs-browser.mjs';
import { createReleasePreviewSecurityHeaders } from './content-security-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function probeJavaLspSdk(options = {}) {
	const output = path.resolve(options.outputDirectory || path.join(ROOT, '.cache/java-lsp-sdk'));
	const assetsDirectory = path.resolve(
		options.assetsDirectory || path.join(ROOT, 'static/java-lsp')
	);
	await mkdir(output, { recursive: true });
	const bundle = path.join(output, 'sdk.js');
	await build({
		stdin: {
			contents: `import { getJavaLanguageServer } from './packages/lsp/src/java/language-server.ts'; globalThis.__getJavaLanguageServer = getJavaLanguageServer;`,
			resolveDir: ROOT
		},
		outfile: bundle,
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		logLevel: 'silent'
	});
	const evidence = {
		schema: 'wasm-idle-java-sdk-browser-v1',
		status: 'running',
		startedAt: new Date().toISOString(),
		requests: [],
		console: [],
		runs: []
	};
	const allowed = new Set([
		'host.html',
		'host.mjs',
		'browser-streams.jar',
		'server/java-language-server.jar',
		'server/gson-2.8.5.jar',
		'server/protobuf-java-3.9.1.jar',
		'server/jdk-compiler.jar'
	]);
	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://localhost');
		evidence.requests.push(url.pathname + url.search);
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		if (options.strictCsp)
			for (const [name, value] of Object.entries(
				createReleasePreviewSecurityHeaders(true, url.pathname)
			))
				response.setHeader(name, value);
		try {
			if (url.pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><title>Java SDK acceptance</title><script type="module" src="/sdk.js"></script>'
				);
				return;
			}
			if (url.pathname === '/java-lsp/silent.html') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><title>Unresponsive host for lifecycle acceptance</title>'
				);
				return;
			}
			let filename;
			if (url.pathname === '/sdk.js') filename = bundle;
			else {
				const relative = decodeURIComponent(url.pathname.slice('/java-lsp/'.length));
				assert.ok(url.pathname.startsWith('/java-lsp/') && allowed.has(relative));
				filename = path.join(assetsDirectory, relative);
			}
			const bytes = await readFile(filename);
			response.setHeader('Content-Length', bytes.byteLength);
			response.setHeader(
				'Content-Type',
				filename.endsWith('.html')
					? 'text/html'
					: /\.(js|mjs)$/.test(filename)
						? 'text/javascript'
						: 'application/java-archive'
			);
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const { chromium } = await import('playwright-core');
	let browserServer, browser, page, activeClient;
	const timeout = options.timeoutMs || 180000;
	try {
		browserServer = await chromium.launchServer({
			headless: true,
			args: ['--disable-dev-shm-usage'],
			...(options.executablePath ? { executablePath: options.executablePath } : {})
		});
		browser = await chromium.connect(browserServer.wsEndpoint());
		page = await browser.newPage();
		page.on('console', (message) => {
			if (evidence.console.length < 150)
				evidence.console.push({
					type: message.type(),
					text: message.text().slice(0, 3000)
				});
		});
		page.on('pageerror', (error) =>
			evidence.console.push({ type: 'pageerror', text: String(error) })
		);
		await page.exposeFunction('__sdkReceive', (message) => {
			const json = JSON.stringify(message);
			activeClient?.receive(
				Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
			);
		});
		await page.exposeFunction('__sdkError', (message) =>
			activeClient?.abort(new Error(message))
		);
		await page.goto(origin);
		await page.waitForFunction(() => typeof globalThis.__getJavaLanguageServer === 'function');
		await page.evaluate(() => {
			globalThis.__javaCache = {
				enabled: true,
				namespace: `java-sdk-${crypto.randomUUID()}`,
				maxBytes: 64 * 1024 * 1024,
				maxEntryBytes: 16 * 1024 * 1024,
				storageReserveBytes: 0
			};
		});
		evidence.preEnableJarRequests = evidence.requests.filter((url) =>
			url.includes('.jar')
		).length;
		assert.equal(evidence.preEnableJarRequests, 0);
		for (const [index, stage, fixture] of [
			[0, 'features', JAVACS_PROBE_FIXTURE],
			[1, 'single-file', JAVACS_SINGLE_FILE_FIXTURE],
			[2, 'single-file', JAVACS_SINGLE_FILE_FIXTURE]
		]) {
			const run = { stage, session: index, messages: [] };
			evidence.runs.push(run);
			activeClient = createJavaLspClient(
				(data) =>
					page.evaluate(async (chunk) => {
						const message = JSON.parse(chunk.slice(chunk.indexOf('\r\n\r\n') + 4));
						await globalThis.__javaHandle.transport.writer.write(message);
					}, data),
				run,
				45000
			);
			const before = evidence.requests.filter((url) => url.includes('.jar')).length;
			const initialFiles = Object.fromEntries(
				Object.entries(fixture.files)
					.filter(([name]) => name.endsWith('.java'))
					.map(([name, text]) => [`file:///workspace/${name}`, text])
			);
			await page.evaluate(
				async ({ timeout, initialFiles }) => {
					globalThis.__javaHandle = await globalThis.__getJavaLanguageServer({
						currentUrl: location.href,
						persistentCache: globalThis.__javaCache,
						startupTimeoutMs: timeout,
						java: { initialFiles },
						onStatus: (status) => {
							globalThis.__javaSdkStatus = status;
						}
					});
					globalThis.__javaHandle.transport.reader.listen((message) =>
						globalThis.__sdkReceive(message)
					);
					globalThis.__javaHandle.transport.reader.onError((error) =>
						globalThis.__sdkError(error.message)
					);
				},
				{ timeout, initialFiles }
			);
			run.jarRequests =
				evidence.requests.filter((url) => url.includes('.jar')).length - before;
			assert.equal(
				run.jarRequests,
				index === 0 ? 5 : 0,
				'Verified Java JAR cache was not reused'
			);
			assert.equal(await page.locator('iframe[data-wasm-idle-java-lsp-host]').count(), 1);
			await exerciseJavaLsp(
				activeClient,
				'file:///workspace',
				stage,
				run,
				'upstream-defaults',
				JAVACS_TYPE_MISMATCH,
				fixture,
				async (client, project) => {
					const textDocument = {
						uri: `${project}/${fixture.sourceDirectory}/Main.java`.toLowerCase()
					};
					// Match Monaco's eager requests before didOpen, including its lowercase URI.
					run.beforeOpen = {};
					for (const method of [
						'textDocument/codeAction',
						'textDocument/foldingRange',
						'textDocument/documentSymbol'
					]) {
						const result = await client.request(method, {
							textDocument,
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 0 }
							},
							context: { diagnostics: [] }
						});
						assert.ok(
							Array.isArray(result),
							`Original ${method} failed before didOpen`
						);
						run.beforeOpen[method] = result;
					}
				}
			);
			assert.ok(run.baselineDiagnostics, 'Fresh session retained earlier error diagnostics');
			await page.evaluate(() => {
				globalThis.__javaHandle.dispose();
				globalThis.__javaHandle.dispose();
				globalThis.__javaHandle = undefined;
			});
			assert.equal(await page.locator('iframe[data-wasm-idle-java-lsp-host]').count(), 0);
			run.disposed = true;
			activeClient = undefined;
		}
		evidence.preAborted = await page.evaluate(async () => {
			const controller = new AbortController();
			controller.abort(new DOMException('pre-aborted Java SDK', 'AbortError'));
			try {
				await globalThis.__getJavaLanguageServer({ signal: controller.signal });
				return false;
			} catch (error) {
				return error.name === 'AbortError';
			}
		});
		assert.equal(evidence.preAborted, true);
		const silentRequestsBefore = evidence.requests.filter(
			(url) => url === '/java-lsp/silent.html'
		).length;
		evidence.timeout = await page.evaluate(async () => {
			try {
				await globalThis.__getJavaLanguageServer({
					persistentCache: globalThis.__javaCache,
					startupTimeoutMs: 1000,
					java: { hostUrl: `${location.origin}/java-lsp/silent.html` }
				});
				return 'unexpected-success';
			} catch (error) {
				return error.name;
			}
		});
		assert.equal(evidence.timeout, 'LanguageServerStartupTimeoutError');
		assert.ok(
			evidence.requests.filter((url) => url === '/java-lsp/silent.html').length >
				silentRequestsBefore,
			'Timeout never reached the actual iframe host'
		);
		assert.equal(await page.locator('iframe[data-wasm-idle-java-lsp-host]').count(), 0);
		evidence.duringAbort = await page.evaluate(async () => {
			const controller = new AbortController();
			let observedFrame = false;
			const timer = setInterval(() => {
				if (document.querySelector('iframe[data-wasm-idle-java-lsp-host]')) {
					observedFrame = true;
					controller.abort(new DOMException('during Java SDK startup', 'AbortError'));
				}
			}, 10);
			const deadline = setTimeout(
				() => controller.abort(new Error('Java iframe was never created')),
				5000
			);
			try {
				await globalThis.__getJavaLanguageServer({
					signal: controller.signal,
					persistentCache: globalThis.__javaCache,
					java: { hostUrl: `${location.origin}/java-lsp/silent.html` }
				});
				return false;
			} catch (error) {
				return observedFrame && error.name === 'AbortError';
			} finally {
				clearInterval(timer);
				clearTimeout(deadline);
			}
		});
		assert.equal(evidence.duringAbort, true);
		assert.equal(await page.locator('iframe[data-wasm-idle-java-lsp-host]').count(), 0);
		evidence.status = 'passed';
	} catch (error) {
		evidence.status = 'failed';
		evidence.error = String(error);
		if (page)
			evidence.lastStatus = await page
				.evaluate(() => globalThis.__javaSdkStatus)
				.catch(() => null);
	} finally {
		activeClient?.abort(new Error('Java SDK probe closed'));
		await Promise.race([
			browser?.close().catch(() => {}),
			new Promise((resolve) => setTimeout(resolve, 3000))
		]);
		if (browserServer) {
			await Promise.race([
				browserServer.close().catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, 3000))
			]);
			if (browserServer.process().exitCode === null) browserServer.process().kill('SIGKILL');
		}
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		evidence.completedAt = new Date().toISOString();
		await writeFile(
			path.join(output, 'evidence.json'),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	}
	return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			'assets-directory': { type: 'string' },
			'output-directory': { type: 'string' },
			'timeout-ms': { type: 'string' },
			'executable-path': { type: 'string' },
			'strict-csp': { type: 'boolean' }
		}
	});
	const evidence = await probeJavaLspSdk({
		assetsDirectory: values['assets-directory'],
		outputDirectory: values['output-directory'],
		timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
		executablePath: values['executable-path'],
		strictCsp: values['strict-csp']
	});
	console.log(
		JSON.stringify(
			{
				status: evidence.status,
				error: evidence.error,
				runs: evidence.runs.map((run) => ({
					stage: run.stage,
					session: run.session,
					jarRequests: run.jarRequests,
					messages: run.messages.length,
					diagnosticCodes: run.diagnostics?.diagnostics.map((item) => item.code),
					disposed: run.disposed
				}))
			},
			null,
			2
		)
	);
	if (evidence.status !== 'passed') process.exitCode = 1;
}
