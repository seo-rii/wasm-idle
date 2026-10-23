import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createReleasePreviewSecurityHeaders } from './content-security-policy.mjs';
import {
	JAVA_TEAVM_FIXTURE_DIRECTORY,
	createJavaTeavmLspClient,
	exerciseJavaTeavmLsp,
	javaPositionAt,
	loadJavaTeavmFixture
} from './java-teavm-lsp-protocol.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertNativeParity(actual, expected) {
	const actualReply = structuredClone(actual);
	const nativeReply = structuredClone(expected);
	if (nativeReply.defaultPackageMethodHoverError) {
		// Both backends must retain the upstream method/docs defect. VM-specific
		// NullPointerException prose differs between OpenJDK and TeaVM.
		assert.equal(actualReply.defaultPackageMethodHoverError.code, -32603);
		delete actualReply.defaultPackageMethodHoverError.message;
		delete nativeReply.defaultPackageMethodHoverError.message;
	}
	assert.deepEqual(actualReply, nativeReply, 'TeaVM changed original javacs semantic replies');
}

async function assetFiles(directory, prefix = '') {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relative = `${prefix}${entry.name}`;
		if (entry.isDirectory())
			files.push(...(await assetFiles(path.join(directory, entry.name), `${relative}/`)));
		else if (entry.isFile()) files.push(relative);
	}
	return files;
}

async function exerciseJavaUriBoundaries(client, snapshot) {
	await client.request('initialize', {
		processId: null,
		rootUri: null,
		capabilities: { textDocument: { hover: { contentFormat: ['plaintext'] } } }
	});
	await client.notify('initialized', {});
	const snapshotUri = 'file:///workspace/src/SnapshotMain.java';
	const snapshotAlias = snapshotUri.toLowerCase();
	await client.notify('textDocument/didOpen', {
		textDocument: {
			uri: snapshotAlias,
			languageId: 'java',
			version: 1,
			text: snapshot['src/SnapshotMain.java']
		}
	});
	const snapshotSymbols = await client.request('textDocument/documentSymbol', {
		textDocument: { uri: snapshotAlias }
	});
	assert.match(JSON.stringify(snapshotSymbols), /SnapshotMain/);

	const uri = 'file:///workspace/src/Main.java';
	const alias = uri.toLowerCase();
	const original = 'package src; public class Main { int original = 1; }';
	const overwritten = 'package src; class main { int overwritten = 2; }';
	const open = (targetUri, text, version = 1) =>
		client.notify('textDocument/didOpen', {
			textDocument: { uri: targetUri, languageId: 'java', version, text }
		});
	await open(uri, original);
	const before = client.notifications.length;
	await open(alias, overwritten);
	const symbols = await client.request('textDocument/documentSymbol', {
		textDocument: { uri: alias }
	});
	assert.match(JSON.stringify(symbols), /original/);
	assert.doesNotMatch(JSON.stringify(symbols), /overwritten/);
	const rejection = client.notifications
		.slice(before)
		.find((message) => message.method === 'window/logMessage' && message.params.type === 1);
	assert.match(rejection?.params.message || '', /Ambiguous Java didOpen URI/);
	await assert.rejects(
		client.request('textDocument/didOpen', {
			textDocument: { uri: alias, languageId: 'java', version: 1, text: overwritten }
		}),
		(error) => error.response?.code === -32602
	);

	const changed =
		'package src; public class Main { int changed = 3; void run() { int answer = changed; System.out.println(answer); } }';
	await client.notify('textDocument/didChange', {
		textDocument: { uri: alias, version: 2 },
		contentChanges: [{ text: changed }]
	});
	const hover = await client.request('textDocument/hover', {
		textDocument: { uri: alias },
		position: javaPositionAt(changed, changed.lastIndexOf('answer') + 2)
	});
	assert.match(JSON.stringify(hover), /int answer/);
	for (const [targetUri, text] of [
		[uri, changed],
		[snapshotAlias, snapshot['src/SnapshotMain.java']]
	]) {
		await client.notify('textDocument/didClose', { textDocument: { uri: targetUri } });
		await open(targetUri, text, 3);
	}
	await open(alias, overwritten);
	const afterReopen = await client.request('textDocument/documentSymbol', {
		textDocument: { uri: alias }
	});
	assert.match(JSON.stringify(afterReopen), /changed/);
	assert.doesNotMatch(JSON.stringify(afterReopen), /overwritten/);
	const snapshotAfterReopen = await client.request('textDocument/documentSymbol', {
		textDocument: { uri: snapshotAlias }
	});
	assert.match(JSON.stringify(snapshotAfterReopen), /SnapshotMain/);
	await client.request('shutdown', null);
	await client.notify('exit', null);
	return { snapshotSymbols, symbols, rejection, hover, afterReopen, snapshotAfterReopen };
}

export async function probeJavaTeavmLspBrowser(options = {}) {
	const output = path.resolve(
		options.outputDirectory || path.join(ROOT, '.cache/java-teavm-acceptance/browser')
	);
	const assets = path.resolve(
		options.assetsDirectory ||
			process.env.WASM_IDLE_JAVA_TEAVM_LSP_ASSET_DIR ||
			path.join(ROOT, 'static/wasm-java-lsp')
	);
	await mkdir(output, { recursive: true });
	const { build } = await import('esbuild');
	const sdkBundle = path.join(output, 'sdk.js');
	const workerBundle = path.join(output, 'worker.js');
	await build({
		stdin: {
			contents: `import { getJavaLanguageServer } from './packages/lsp/src/java/language-server.ts'; import { JAVA_LANGUAGE_SERVER_ASSETS } from './packages/lsp/src/java/assets.ts'; globalThis.__getJavaLanguageServer = getJavaLanguageServer; globalThis.__javaTeavmReceipts = JAVA_LANGUAGE_SERVER_ASSETS;`,
			resolveDir: ROOT
		},
		outfile: sdkBundle,
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		logLevel: 'silent'
	});
	await build({
		entryPoints: [path.join(ROOT, 'packages/lsp/src/java/worker.ts')],
		outfile: workerBundle,
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		logLevel: 'silent'
	});
	const files = await assetFiles(assets);
	const tamperFile = files.find((filename) => /\.wasm(?:\.gz)?(?:\.bin)?$/.test(filename));
	assert.ok(tamperFile, 'Real TeaVM Wasm asset is required for integrity acceptance');
	const allowed = new Set(files);
	const oracle = JSON.parse(
		await readFile(path.join(JAVA_TEAVM_FIXTURE_DIRECTORY, 'native-oracle.json'), 'utf8')
	);
	const evidence = {
		schema: 'wasm-idle-javacs-teavm-sdk-browser-v1',
		status: 'running',
		startedAt: new Date().toISOString(),
		requests: [],
		console: [],
		runs: []
	};
	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://localhost');
		evidence.requests.push(url.pathname);
		for (const [name, value] of Object.entries(
			createReleasePreviewSecurityHeaders(true, url.pathname)
		))
			response.setHeader(name, value);
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		try {
			if (url.pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(
					'<!doctype html><title>Original javacs TeaVM SDK acceptance</title><script type="module" src="/sdk.js"></script>'
				);
				return;
			}
			if (url.pathname === '/silent-worker.js') {
				response.setHeader('Content-Type', 'text/javascript');
				response.end('globalThis.addEventListener("message", () => {});');
				return;
			}
			let filename;
			let tampered = false;
			if (url.pathname === '/sdk.js') filename = sdkBundle;
			else if (url.pathname === '/worker.js') filename = workerBundle;
			else {
				const base = url.pathname.startsWith('/tampered-java-lsp/')
					? '/tampered-java-lsp/'
					: '/wasm-java-lsp/';
				assert.ok(url.pathname.startsWith(base));
				const relative = decodeURIComponent(url.pathname.slice(base.length));
				assert.ok(allowed.has(relative));
				filename = path.join(assets, relative);
				tampered = base === '/tampered-java-lsp/' && relative === tamperFile;
			}
			let bytes = await readFile(filename);
			if (tampered) {
				bytes = Buffer.from(bytes);
				bytes[Math.floor(bytes.length / 2)] ^= 1;
			}
			response.setHeader('Content-Length', bytes.byteLength);
			response.setHeader(
				'Content-Type',
				/\.(m?js)$/.test(filename)
					? 'text/javascript'
					: filename.endsWith('.wasm')
						? 'application/wasm'
						: 'application/octet-stream'
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
	let browser;
	let browserServer;
	let activeClient;
	let page;
	try {
		browserServer = await chromium.launchServer({
			headless: true,
			args: ['--disable-dev-shm-usage'],
			...(options.executablePath ? { executablePath: options.executablePath } : {})
		});
		browser = await chromium.connect(browserServer.wsEndpoint());
		evidence.browserVersion = browser.version();
		page = await browser.newPage();
		page.on('console', (message) => {
			if (evidence.console.length < 100)
				evidence.console.push({
					type: message.type(),
					text: message.text().slice(0, 3000)
				});
		});
		page.on('pageerror', (error) =>
			evidence.console.push({ type: 'pageerror', text: String(error) })
		);
		await page.exposeFunction('__javaTeavmReceive', (message) =>
			activeClient?.receive(message)
		);
		await page.exposeFunction('__javaTeavmError', (message) =>
			activeClient?.abort(new Error(message))
		);
		await page.addInitScript(() => {
			const NativeWorker = globalThis.Worker;
			globalThis.__javaWorkers = { created: 0, terminated: 0, active: new Set() };
			globalThis.Worker = class extends NativeWorker {
				constructor(...args) {
					super(...args);
					globalThis.__javaWorkers.created++;
					globalThis.__javaWorkers.active.add(this);
				}
				terminate() {
					if (globalThis.__javaWorkers.active.delete(this))
						globalThis.__javaWorkers.terminated++;
					super.terminate();
				}
			};
		});
		await page.goto(origin);
		await page.waitForFunction(() => typeof globalThis.__getJavaLanguageServer === 'function');
		evidence.inputs = {
			upstream: oracle.inputs.upstream,
			assets: await page.evaluate(() => globalThis.__javaTeavmReceipts)
		};
		await page.evaluate(() => {
			globalThis.__javaTeavmCache = {
				enabled: true,
				namespace: `javacs-teavm-${crypto.randomUUID()}`,
				maxBytes: 256 * 1024 * 1024,
				maxEntryBytes: 128 * 1024 * 1024,
				storageReserveBytes: 0
			};
		});
		const assetRequestCount = () =>
			evidence.requests.filter((url) => url.startsWith('/wasm-java-lsp/')).length;
		assert.equal(assetRequestCount(), 0, 'Java assets fetched before enabling the LSP');
		evidence.sourceSnapshotAliases = await page.evaluate(async () => {
			const results = [];
			for (const alias of [
				'file:///workspace/src//Main.java',
				'file:///workspace/src%2fMain.java',
				'file:///workspace/src/%4dain.java'
			]) {
				const before = globalThis.__javaWorkers.created;
				try {
					const handle = await globalThis.__getJavaLanguageServer({
						java: {
							baseUrl: new URL('/wasm-java-lsp/', location.href).href,
							initialFiles: {
								'file:///workspace/src/Main.java': 'public class Main {}',
								[alias]: 'class Main { int overwritten; }'
							}
						},
						createWorker: () => new Worker('/worker.js', { type: 'module' })
					});
					handle.dispose();
					results.push({ alias, unexpectedSuccess: true });
				} catch (error) {
					results.push({
						alias,
						error: String(error.message),
						workers: globalThis.__javaWorkers.created - before
					});
				}
			}
			return results;
		});
		for (const rejection of evidence.sourceSnapshotAliases) {
			assert.match(rejection.error || '', /Ambiguous|duplicate/i);
			assert.equal(rejection.workers, 0);
		}
		assert.equal(assetRequestCount(), 0, 'Invalid initial sources fetched Java assets');
		for (const profile of ['project', 'default-package', 'project', 'uri-boundaries']) {
			const run = {
				profile,
				initialSnapshot: profile === 'uri-boundaries' || evidence.runs.length < 2,
				messages: []
			};
			evidence.runs.push(run);
			activeClient = createJavaTeavmLspClient(
				(message) =>
					page.evaluate(
						(outgoing) => globalThis.__javaTeavmHandle.transport.writer.write(outgoing),
						message
					),
				{ messages: run.messages, timeoutMs: options.timeoutMs || 60000 }
			);
			const fixture =
				profile === 'uri-boundaries'
					? { 'src/SnapshotMain.java': 'package src; public class SnapshotMain {}' }
					: await loadJavaTeavmFixture(profile);
			const initialFiles = Object.fromEntries(
				Object.entries(fixture).map(([name, text]) => [`file:///workspace/${name}`, text])
			);
			const before = assetRequestCount();
			const startupStarted = Date.now();
			await page.evaluate(
				async ({ initialFiles, timeoutMs }) => {
					globalThis.__javaTeavmHandle = await globalThis.__getJavaLanguageServer({
						java: {
							baseUrl: new URL('/wasm-java-lsp/', location.href).href,
							initialFiles
						},
						currentUrl: location.href,
						persistentCache: globalThis.__javaTeavmCache,
						startupTimeoutMs: timeoutMs,
						createWorker: () => new Worker('/worker.js', { type: 'module' })
					});
					globalThis.__javaTeavmHandle.transport.reader.listen((message) =>
						globalThis.__javaTeavmReceive(message)
					);
					globalThis.__javaTeavmHandle.transport.reader.onError((error) =>
						globalThis.__javaTeavmError(String(error?.message || error))
					);
				},
				{
					initialFiles: run.initialSnapshot ? initialFiles : undefined,
					timeoutMs: options.timeoutMs || 180000
				}
			);
			run.startupMs = Date.now() - startupStarted;
			run.assetRequests = assetRequestCount() - before;
			if (evidence.runs.length === 1) assert.ok(run.assetRequests > 0);
			else
				assert.equal(run.assetRequests, 0, 'Verified Java TeaVM assets were fetched again');
			const protocolStarted = Date.now();
			run.results =
				profile === 'uri-boundaries'
					? await exerciseJavaUriBoundaries(activeClient, fixture)
					: await exerciseJavaTeavmLsp(activeClient, 'file:///workspace', {
							profile,
							files: fixture,
							monacoInitialize: !run.initialSnapshot
						});
			run.protocolMs = Date.now() - protocolStarted;
			if (profile !== 'uri-boundaries') {
				assertNativeParity(run.results, oracle.profiles[profile]);
				run.nativeParity = true;
			} else run.uriBoundaries = true;
			await page.evaluate(() => {
				globalThis.__javaTeavmHandle.dispose();
				globalThis.__javaTeavmHandle.dispose();
				globalThis.__javaTeavmHandle = undefined;
			});
			assert.equal(
				await page.evaluate(() => globalThis.__javaWorkers.active.size),
				0,
				'Disposed Java worker remains live'
			);
			activeClient.abort(new Error('Completed Java acceptance session'));
			activeClient = undefined;
		}
		evidence.preAborted = await page.evaluate(async () => {
			const controller = new AbortController();
			controller.abort();
			const before = globalThis.__javaWorkers.created;
			try {
				await globalThis.__getJavaLanguageServer({
					java: { baseUrl: new URL('/wasm-java-lsp/', location.href).href },
					signal: controller.signal,
					createWorker: () => new Worker('/worker.js', { type: 'module' })
				});
				throw new Error('Pre-aborted Java startup unexpectedly succeeded');
			} catch (error) {
				return {
					name: error.name,
					message: String(error.message),
					workers: globalThis.__javaWorkers.created - before
				};
			}
		});
		assert.equal(evidence.preAborted.name, 'AbortError');
		assert.equal(evidence.preAborted.workers, 0);
		evidence.startupTimeout = await page.evaluate(async () => {
			try {
				await globalThis.__getJavaLanguageServer({
					java: { baseUrl: new URL('/wasm-java-lsp/', location.href).href },
					persistentCache: globalThis.__javaTeavmCache,
					startupTimeoutMs: 250,
					createWorker: () => new Worker('/silent-worker.js', { type: 'module' })
				});
				throw new Error('Silent Java worker unexpectedly started');
			} catch (error) {
				return String(error.message);
			}
		});
		assert.match(evidence.startupTimeout, /time(?:d)?\s*out|timeout/i);
		assert.equal(await page.evaluate(() => globalThis.__javaWorkers.active.size), 0);
		evidence.duringAbort = await page.evaluate(async () => {
			const controller = new AbortController();
			const before = globalThis.__javaWorkers.created;
			const started = globalThis.__getJavaLanguageServer({
				java: { baseUrl: new URL('/wasm-java-lsp/', location.href).href },
				persistentCache: globalThis.__javaTeavmCache,
				signal: controller.signal,
				startupTimeoutMs: 5000,
				createWorker: () => new Worker('/silent-worker.js', { type: 'module' })
			});
			const failure = started.then(
				(handle) => {
					handle.dispose();
					return { name: 'UnexpectedSuccess' };
				},
				(error) => ({ name: error.name, message: String(error.message) })
			);
			const workerDeadline = performance.now() + 3000;
			while (globalThis.__javaWorkers.created === before && !controller.signal.aborted) {
				if (performance.now() > workerDeadline) {
					controller.abort();
					await failure;
					throw new Error('During-abort acceptance never reached Worker creation');
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			controller.abort();
			return await failure;
		});
		assert.equal(evidence.duringAbort.name, 'AbortError');
		assert.equal(await page.evaluate(() => globalThis.__javaWorkers.active.size), 0);
		evidence.tamperedAsset = await page.evaluate(async () => {
			try {
				const handle = await globalThis.__getJavaLanguageServer({
					java: { baseUrl: new URL('/tampered-java-lsp/', location.href).href },
					persistentCache: false,
					startupTimeoutMs: 30000,
					createWorker: () => new Worker('/worker.js', { type: 'module' })
				});
				handle.dispose();
				throw new Error('Tampered original Java Wasm was accepted');
			} catch (error) {
				return String(error.message);
			}
		});
		assert.match(evidence.tamperedAsset, /integrity|SHA.?256|checksum|mismatch/i);
		assert.ok(evidence.requests.includes(`/tampered-java-lsp/${tamperFile}`));
		evidence.workerLifecycle = await page.evaluate(() => ({
			created: globalThis.__javaWorkers.created,
			terminated: globalThis.__javaWorkers.terminated,
			active: globalThis.__javaWorkers.active.size
		}));
		assert.equal(evidence.workerLifecycle.active, 0);
		assert.equal(evidence.workerLifecycle.created, evidence.workerLifecycle.terminated);
		assert.equal(
			await page.locator('iframe').count(),
			0,
			'Java TeaVM SDK created a JVM iframe'
		);
		assert.deepEqual(
			evidence.console.filter(({ type }) => type === 'pageerror'),
			[]
		);
		evidence.status = 'passed';
		return evidence;
	} catch (error) {
		evidence.status = 'failed';
		evidence.error = String(error.stack || error);
		throw error;
	} finally {
		activeClient?.abort(new Error('Java TeaVM browser acceptance closed'));
		if (page) {
			await page.evaluate(() => globalThis.__javaTeavmHandle?.dispose()).catch(() => {});
			evidence.workerLifecycle = await page
				.evaluate(() => ({
					created: globalThis.__javaWorkers.created,
					terminated: globalThis.__javaWorkers.terminated,
					active: globalThis.__javaWorkers.active.size
				}))
				.catch(() => ({ unavailable: true }));
		}
		await browser?.close().catch(() => {});
		await browserServer?.close().catch(() => {});
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		evidence.completedAt = new Date().toISOString();
		await writeFile(
			path.join(output, 'browser-evidence.json'),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	}
}

test(
	'original javacs TeaVM public SDK matches native semantics under strict CSP',
	{
		skip: process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP !== '1',
		timeout: 300000
	},
	async () => {
		await probeJavaTeavmLspBrowser();
	}
);
