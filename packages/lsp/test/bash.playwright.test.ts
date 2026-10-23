import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter
} from 'vscode-jsonrpc/node';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { bashFixtureFiles, exerciseBashProtocol } from './fixtures/bash-protocol.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it(
	'preserves original Bash CLI diagnostics, completion, hover, definition, references, rename and symbols in Chromium',
	{
		skip: process.env.WASM_IDLE_RUN_BASH_LSP_BROWSER !== '1',
		timeout: 120_000
	},
	async () => {
		const assetRoot = path.join(root, 'static/wasm-bash-lsp');
		await readFile(path.join(assetRoot, 'tree-sitter-bash.wasm'));
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-native-bash-lsp-'));
		let nativeProcess: ReturnType<typeof spawn> | undefined;
		let connection: ReturnType<typeof createMessageConnection> | undefined;
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		let server: ReturnType<typeof createServer> | undefined;
		try {
			for (const [filename, text] of Object.entries(bashFixtureFiles))
				await writeFile(path.join(directory, filename), text);
			const producerRequire = createRequire(
				path.join(root, 'producers/bash-language-server/package.json')
			);
			const cli = path.join(
				path.dirname(producerRequire.resolve('bash-language-server/package.json')),
				'out/cli.js'
			);
			nativeProcess = spawn(process.execPath, [cli, 'start'], {
				env: {
					...process.env,
					SHELLCHECK_PATH: '',
					SHFMT_PATH: '',
					BASH_IDE_LOG_LEVEL: 'error'
				},
				stdio: ['pipe', 'pipe', 'pipe']
			});
			const stderr: string[] = [];
			nativeProcess.stderr?.on('data', (bytes) => stderr.push(String(bytes)));
			connection = createMessageConnection(
				new StreamMessageReader(nativeProcess.stdout!),
				new StreamMessageWriter(nativeProcess.stdin!)
			);
			const diagnostics: any[] = [];
			connection.onNotification('textDocument/publishDiagnostics', (entry) =>
				diagnostics.push(entry)
			);
			connection.listen();
			const activeConnection = connection;
			const native = await exerciseBashProtocol(
				{
					request: (method, params) => activeConnection.sendRequest(method, params),
					notify: (method, params) => activeConnection.sendNotification(method, params),
					diagnostics
				},
				pathToFileURL(directory).href
			);
			await connection.sendNotification('exit');
			const nativeExit = await new Promise<number | null>((resolve) =>
				nativeProcess!.once('exit', resolve)
			);
			expect(nativeExit, stderr.join('')).toBe(0);
			connection.dispose();
			connection = undefined;

			const buildOptions = {
				absWorkingDir: root,
				bundle: true,
				format: 'esm' as const,
				platform: 'browser' as const,
				write: false,
				target: 'es2022',
				tsconfig: path.join(root, 'packages/lsp/tsconfig.json'),
				alias: { '@wasm-idle/core': path.join(root, 'packages/core/src/index.ts') }
			};
			const client = (
				await build({
					...buildOptions,
					stdin: {
						resolveDir: root,
						contents: `
import { getBashLanguageServer } from './packages/lsp/src/bash/language-server.ts';
import { bashFixtureFiles, exerciseBashProtocol } from './packages/lsp/test/fixtures/bash-protocol.ts';
globalThis.runBrowserBash = async () => {
 const statuses = [];
 const handle = await getBashLanguageServer({ bash: { moduleUrl: location.origin + '/upstream/runtime.mjs', files: bashFixtureFiles }, onStatus: status => statuses.push(status) });
 try {
  const responses = []; const diagnostics = [];
  handle.transport.reader.listen(message => { responses.push(message); if(message.method === 'textDocument/publishDiagnostics') diagnostics.push(message.params); });
  let id = 0;
  const request = async (method, params) => {
   const current = ++id; await handle.transport.writer.write({ jsonrpc: '2.0', id: current, method, params });
   const deadline = Date.now() + 15000;
   while(Date.now() < deadline) {
    const response = responses.find(message => message.id === current);
    if(response) { if(response.error) throw new Error(JSON.stringify(response.error)); return response.result; }
    await new Promise(resolve => setTimeout(resolve, 5));
   }
   throw new Error('Bash LSP request timed out: ' + method + ' ' + JSON.stringify(responses));
  };
  const result = await exerciseBashProtocol({ request, notify: (method, params) => handle.transport.writer.write({ jsonrpc: '2.0', method, params }), diagnostics }, 'file:///workspace');
  return { result, statuses };
 } finally { handle.dispose(); }
};
`
					}
				})
			).outputFiles[0].text;
			const worker = (
				await build({ ...buildOptions, entryPoints: ['packages/lsp/src/bash/worker.ts'] })
			).outputFiles[0].text;
			const requests: string[] = [];
			server = createServer(async (request, response) => {
				try {
					const pathname = new URL(request.url || '/', 'http://localhost').pathname;
					requests.push(pathname);
					response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
					response.setHeader(
						'Content-Security-Policy',
						"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'"
					);
					if (pathname === '/') {
						response.setHeader('Content-Type', 'text/html');
						response.end(
							'<!doctype html><title>Original Bash LSP browser test</title>'
						);
					} else if (
						pathname === '/bash/language-server.js' ||
						pathname === '/bash/worker.js'
					) {
						response.setHeader('Content-Type', 'application/javascript');
						response.end(pathname.endsWith('/worker.js') ? worker : client);
					} else if (pathname.startsWith('/upstream/')) {
						const relative = pathname.slice('/upstream/'.length);
						if (relative.includes('..')) throw new Error('Invalid test asset path');
						response.setHeader(
							'Content-Type',
							relative.endsWith('.wasm')
								? 'application/wasm'
								: 'application/javascript'
						);
						response.end(await readFile(path.join(assetRoot, relative)));
					} else response.writeHead(404).end();
				} catch {
					response.writeHead(500).end();
				}
			});
			await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
			const address = server.address();
			if (!address || typeof address === 'string')
				throw new Error('Missing Bash test server address');
			const origin = `http://127.0.0.1:${address.port}`;
			browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const context = await browser.newContext();
			await addBrowserTestCookies(context, origin);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));
			await page.goto(origin);
			await page.addScriptTag({ type: 'module', url: `${origin}/bash/language-server.js` });
			expect(requests.filter((url) => url.startsWith('/upstream/'))).toEqual([]);
			const actual = await page.evaluate(() => (globalThis as any).runBrowserBash());
			const expected = JSON.parse(
				JSON.stringify(native)
					.replaceAll(pathToFileURL(directory).href, 'file:///workspace')
					.replaceAll(directory, '/workspace')
			);
			expected.capabilities.documentFormattingProvider = false;
			expect(actual.result).toEqual(expected);
			expect(actual.result.capabilities).toMatchObject({
				textDocumentSync: 1,
				definitionProvider: true,
				hoverProvider: true,
				referencesProvider: true,
				documentFormattingProvider: false
			});
			expect(actual.result.missingSource).toContainEqual(
				expect.objectContaining({ severity: 3, source: 'bash-language-server' })
			);
			expect(actual.result.corrected).toEqual([]);
			expect(actual.result.completion).toContainEqual(
				expect.objectContaining({ label: 'wasm_idle_greet' })
			);
			expect(actual.result.hover).toBeTruthy();
			expect(actual.result.definition).toContainEqual(
				expect.objectContaining({ uri: 'file:///workspace/lib.sh' })
			);
			expect(actual.result.symbols).toContainEqual(
				expect.objectContaining({ name: 'wasm_idle_greet' })
			);
			expect(actual.result.references.length).toBeGreaterThan(0);
			expect(JSON.stringify(actual.result.rename)).toContain('wasm_idle_welcome');
			expect(pageErrors).toEqual([]);
			for (const asset of [
				'runtime.mjs',
				'web-tree-sitter.wasm',
				'tree-sitter-bash.wasm',
				'one_ini_bg.wasm'
			])
				expect(requests).toContain(`/upstream/${asset}`);
		} finally {
			connection?.dispose();
			nativeProcess?.kill();
			await browser?.close();
			if (server)
				await new Promise<void>((resolve, reject) =>
					server!.close((error) => (error ? reject(error) : resolve()))
				);
			await rm(directory, { recursive: true, force: true });
		}
	}
);
