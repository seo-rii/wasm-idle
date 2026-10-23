import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { nimInvalidSource, nimHelperSource, exerciseNimProtocol } from './fixtures/nim-protocol.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
it(
	'matches the original embedded nimsuggest diagnostics, edits and all language features in Chromium',
	{ skip: process.env.WASM_IDLE_RUN_NIM_LSP_BROWSER !== '1', timeout: 120_000 },
	async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-original-nim-lsp-'));
		let native: ReturnType<typeof spawn> | undefined;
		let rpc: ReturnType<typeof createMessageConnection> | undefined;
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		let server: ReturnType<typeof createServer> | undefined;
		try {
			await writeFile(path.join(directory, 'main.nim'), nimInvalidSource);
			await writeFile(path.join(directory, 'helpers.nim'), nimHelperSource);
			native = spawn(path.join(root, '.cache/nim-lsp/original-native/nimlsp'), [], {
				cwd: directory,
				env: { ...process.env, TMPDIR: directory },
				stdio: ['pipe', 'pipe', 'pipe']
			});
			const nativeExited = new Promise((resolve) =>
				native!.once('exit', (code) => resolve(code))
			);
			rpc = createMessageConnection(
				new StreamMessageReader(native.stdout!),
				new StreamMessageWriter(native.stdin!)
			);
			const diagnostics: any[] = [];
			rpc.onNotification('textDocument/publishDiagnostics', (value) =>
				diagnostics.push(value)
			);
			rpc.listen();
			const activeRpc = rpc;
			const nativeRoot = pathToFileURL(directory).href;
			const original = await exerciseNimProtocol(
				{
					request: (method, params) => activeRpc.sendRequest(method, params),
					notify: (method, params) => activeRpc.sendNotification(method, params),
					diagnostics
				},
				nativeRoot
			);
			expect(await nativeExited).toBe(0);
			rpc.dispose();
			rpc = undefined;
			const opts = {
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
					...opts,
					stdin: {
						resolveDir: root,
						contents: `
import {getNimLanguageServer} from './packages/lsp/src/nim/language-server.ts';
import {exerciseNimProtocol,nimHelperSource} from './packages/lsp/test/fixtures/nim-protocol.ts';
globalThis.runBrowserNim = async () => {
 const worker = new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 const exits=[],events=[]; worker.addEventListener('message',({data})=>{events.push(data.type==='stdout'?{type:'stdout',text:new TextDecoder().decode(data.bytes)}:data);if(data.type==='exit')exits.push(data.code);});
 const handle = await getNimLanguageServer({nim:{baseUrl:location.origin+'/upstream/',workspaceFiles:[{path:'helpers.nim',content:nimHelperSource}]},createWorker:()=>worker});
 const responses=[],diagnostics=[]; let id=0;
 handle.transport.reader.listen(message=>{responses.push(message);if(message.method==='textDocument/publishDiagnostics')diagnostics.push(message.params);});
 const request=async(method,params)=>{const current=++id;await handle.transport.writer.write({jsonrpc:'2.0',id:current,method,params});const deadline=Date.now()+20000;while(Date.now()<deadline){const response=responses.find(message=>message.id===current);if(response){if(response.error)throw Object.assign(new Error(response.error.message),response.error);return response.result;}await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Nim request timeout '+method+' '+JSON.stringify({responses,events}));};
 const notify=(method,params)=>handle.transport.writer.write({jsonrpc:'2.0',method,params});
 try {const result=await exerciseNimProtocol({request,notify,diagnostics},'file:///workspace');const deadline=Date.now()+3000;while(!exits.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));return {result,exits};}
 finally {handle.dispose();}
};
globalThis.runNimIntegrityFailure = async () => {
 const worker = new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 try {
  const handle=await getNimLanguageServer({nim:{baseUrl:location.origin+'/upstream/'},createWorker:()=>worker,persistentCache:false,startupTimeoutMs:20000});
  handle.dispose();
  throw new Error('Mutated compiler bytes were accepted');
 } catch(error) {return String(error.message);}
};`
					}
				})
			).outputFiles[0].text;
			const worker = (
				await build({ ...opts, entryPoints: ['packages/lsp/src/nim/worker.ts'] })
			).outputFiles[0].text;
			const requests: string[] = [];
			let tamperCompiler = false;
			server = createServer(async (request, response) => {
				try {
					const pathname = new URL(request.url || '/', 'http://localhost').pathname;
					requests.push(pathname);
					response.setHeader('Cache-Control', 'no-store');
					response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
					response.setHeader(
						'Content-Security-Policy',
						"default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'"
					);
					if (pathname === '/') {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Original nimlsp browser test</title>');
					} else if (pathname === '/nim/client.js' || pathname === '/nim/worker.js') {
						response.setHeader('Content-Type', 'application/javascript');
						response.end(pathname.endsWith('/worker.js') ? worker : client);
					} else if (pathname.startsWith('/upstream/')) {
						const name = pathname.slice('/upstream/'.length);
						if (name.includes('..')) throw new Error('Invalid asset path');
						const bytes = await readFile(path.join(root, 'static/wasm-nim-lsp', name));
						if (tamperCompiler && name === 'nimlsp.wasm.gz.bin')
							bytes[bytes.length - 1] ^= 1;
						response.end(bytes);
					} else response.writeHead(404).end();
				} catch {
					response.writeHead(500).end();
				}
			});
			await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
			const address = server.address();
			if (!address || typeof address === 'string')
				throw new Error('Missing test server address');
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
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(origin);
			await page.addScriptTag({ type: 'module', url: origin + '/nim/client.js' });
			expect(requests.filter((url) => url.startsWith('/upstream/'))).toEqual([]);
			const actual = await page.evaluate(() => (globalThis as any).runBrowserNim());
			const expected = JSON.parse(
				JSON.stringify(original)
					.replaceAll(nativeRoot, 'file:///workspace')
					.replaceAll(directory, '/workspace')
			);
			expect(actual.result).toEqual(expected);
			expect(actual.result.initialize.capabilities.textDocumentSync.change).toBe(1);
			expect(actual.exits).toEqual([0]);
			expect(actual.result.invalid).toContainEqual(
				expect.objectContaining({ severity: 1, source: 'nimsuggest chk' })
			);
			expect(actual.result.corrected).toEqual([]);
			expect(actual.result.completion).toContainEqual(
				expect.objectContaining({ label: 'greeting' })
			);
			expect(actual.result.hover.contents.value).toContain('proc (name: string): string');
			expect(actual.result.references).toHaveLength(2);
			expect(actual.result.rename.changes['file:///workspace/main.nim']).toHaveLength(2);
			expect(actual.result.signature.signatures).toHaveLength(1);
			expect(actual.result.symbols).toHaveLength(2);
			expect(actual.result.crossFileDefinition).toEqual([
				{
					uri: 'file:///workspace/helpers.nim',
					range: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } }
				}
			]);
			expect(requests.filter((url) => url.startsWith('/upstream/')).sort()).toEqual([
				'/upstream/nimlsp.mjs.gz.bin',
				'/upstream/nimlsp.wasm.gz.bin',
				'/upstream/stdlib.json.gz.bin'
			]);
			expect(errors).toEqual([]);
			await expect.poll(() => page.workers().length).toBe(0);
			tamperCompiler = true;
			const rejected = await page.evaluate(() =>
				(globalThis as any).runNimIntegrityFailure()
			);
			expect(rejected).toMatch(/integrity|SHA-256|sha256/i);
			await expect.poll(() => page.workers().length).toBe(0);
		} finally {
			rpc?.dispose();
			native?.kill();
			await browser?.close();
			if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
			await rm(directory, { recursive: true, force: true });
		}
	}
);
