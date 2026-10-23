import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
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
import { cobolFixtureFiles, exerciseCobolProtocol } from './fixtures/cobol-protocol.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it(
	'preserves original SuperBOL OSS diagnostics, incremental edits and copybook language features in Chromium',
	{ skip: process.env.WASM_IDLE_RUN_COBOL_LSP_BROWSER !== '1', timeout: 120_000 },
	async () => {
		const assetRoot = path.join(root, 'static/wasm-cobol-lsp');
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-native-cobol-lsp-'));
		let nativeProcess: ReturnType<typeof spawn> | undefined;
		let rpc: ReturnType<typeof createMessageConnection> | undefined;
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		let server: ReturnType<typeof createServer> | undefined;
		try {
			const script = gunzipSync(
				await readFile(path.join(assetRoot, 'superbol-free.js.gz.bin'))
			);
			await writeFile(path.join(directory, 'superbol-free.js'), script);
			const configuration = JSON.parse(
				gunzipSync(
					await readFile(path.join(assetRoot, 'gnucobol-config.json.gz.bin'))
				).toString()
			);
			for (const file of configuration.files) {
				const target = path.join(directory, file.path);
				await mkdir(path.dirname(target), { recursive: true });
				await writeFile(target, file.content);
			}
			const nativeResults = new Map<
				string,
				{ result: unknown; rootUri: string; cacheError: any }
			>();
			for (const dialect of ['cobol85', 'default']) {
				const project = path.join(directory, dialect);
				await mkdir(project);
				for (const [filename, text] of Object.entries(cobolFixtureFiles))
					await writeFile(
						path.join(project, filename),
						filename === 'superbol.toml'
							? text.replace('"cobol85"', JSON.stringify(dialect))
							: text
					);
				nativeProcess = spawn(
					process.execPath,
					[path.join(directory, 'superbol-free.js'), 'lsp'],
					{
						cwd: project,
						env: {
							...process.env,
							COB_CONFIG_DIR: path.join(directory, 'gnucobol-config')
						},
						stdio: ['pipe', 'pipe', 'pipe']
					}
				);
				rpc = createMessageConnection(
					new StreamMessageReader(nativeProcess.stdout!),
					new StreamMessageWriter(nativeProcess.stdin!)
				);
				const diagnostics: any[] = [];
				rpc.onNotification('textDocument/publishDiagnostics', (entry) =>
					diagnostics.push(entry)
				);
				rpc.onRequest('workspace/configuration', (request: any) =>
					request.items.map(() => ({}))
				);
				rpc.onRequest('window/showMessageRequest', () => null);
				rpc.listen();
				const activeRpc = rpc;
				const rootUri = pathToFileURL(project).href;
				const result = await exerciseCobolProtocol(
					{
						request: (method, params) => activeRpc.sendRequest(method, params),
						notify: (method, params) => activeRpc.sendNotification(method, params),
						diagnostics
					},
					rootUri,
					{ expectDiagnostics: dialect === 'cobol85' }
				);
				const cacheError = await activeRpc.sendRequest('shutdown', null).then(
					() => null,
					(error) => ({ code: error.code, message: error.message })
				);
				nativeResults.set(dialect, { result, rootUri, cacheError });
				// Record the original Marshal.Closures cache failure before terminating its process.
				rpc.dispose();
				rpc = undefined;
				nativeProcess.kill();
				await new Promise((resolve) => nativeProcess!.once('exit', resolve));
			}

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
import {getCobolLanguageServer} from './packages/lsp/src/cobol/language-server.ts';
import {cobolFixtureFiles,exerciseCobolProtocol} from './packages/lsp/test/fixtures/cobol-protocol.ts';
globalThis.runBrowserCobol = async (dialect) => {
 const files={...cobolFixtureFiles,'superbol.toml':cobolFixtureFiles['superbol.toml'].replace('"cobol85"',JSON.stringify(dialect))};
 const handle = await getCobolLanguageServer({cobol:{baseUrl:location.origin+'/upstream/',workspaceFiles:Object.entries(files).map(([path,content])=>({path,content}))}});
 const responses=[],diagnostics=[]; let id=0;
 handle.transport.reader.listen(message=>{
  if(message.method && message.id !== undefined){
   const result=message.method==='workspace/configuration'?message.params.items.map(()=>({})):null;
   void handle.transport.writer.write({jsonrpc:'2.0',id:message.id,result});
  } else responses.push(message);
  if(message.method==='textDocument/publishDiagnostics')diagnostics.push(message.params);
 });
 const request=async(method,params)=>{const current=++id;await handle.transport.writer.write({jsonrpc:'2.0',id:current,method,params});const deadline=Date.now()+15000;while(Date.now()<deadline){const response=responses.find(message=>message.id===current);if(response){if(response.error)throw Object.assign(new Error(response.error.message),response.error);return response.result;}await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('COBOL request timeout '+method+' '+JSON.stringify(responses));};
 const notify=(method,params)=>handle.transport.writer.write({jsonrpc:'2.0',method,params});
 try {
  const result=await exerciseCobolProtocol({request,notify,diagnostics},'file:///workspace',{expectDiagnostics:dialect==='cobol85'});
  return {result};
 }finally{handle.dispose();}
};
`
					}
				})
			).outputFiles[0].text;
			const worker = (
				await build({ ...opts, entryPoints: ['packages/lsp/src/cobol/worker.ts'] })
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
						"default-src 'self'; script-src 'self' blob:; worker-src 'self'; connect-src 'self'"
					);
					if (pathname === '/') {
						response.setHeader('Content-Type', 'text/html');
						response.end(
							'<!doctype html><title>Original SuperBOL OSS browser test</title>'
						);
					} else if (pathname === '/cobol/client.js' || pathname === '/cobol/worker.js') {
						response.setHeader('Content-Type', 'application/javascript');
						response.end(pathname.endsWith('/worker.js') ? worker : client);
					} else if (pathname.startsWith('/upstream/')) {
						const relative = pathname.slice('/upstream/'.length);
						if (relative.includes('..')) throw new Error('Invalid test asset path');
						response.setHeader(
							'Content-Type',
							relative.endsWith('.mjs')
								? 'application/javascript'
								: 'application/octet-stream'
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
			await page.addScriptTag({ type: 'module', url: origin + '/cobol/client.js' });
			expect(requests.filter((url) => url.startsWith('/upstream/'))).toEqual([]);
			for (const dialect of ['cobol85', 'default']) {
				const actual = await page.evaluate(
					(dialect) => (globalThis as any).runBrowserCobol(dialect),
					dialect
				);
				const native = nativeResults.get(dialect)!;
				const expected = JSON.parse(
					JSON.stringify(native.result)
						.replaceAll(native.rootUri, 'file:///workspace')
						.replaceAll(fileURLToPath(native.rootUri), '/workspace')
				);
				expect(actual.result).toEqual(expected);
				expect(actual.result.serverInfo).toMatchObject({
					name: 'SuperBOL LSP Server',
					version: '0.3.0'
				});
				if (dialect === 'cobol85')
					expect(actual.result.invalid).toContainEqual(
						expect.objectContaining({ severity: 1 })
					);
				expect(actual.result.corrected).toEqual([]);
				expect(actual.result.completion).toContainEqual(
					expect.objectContaining({ label: 'GREETING' })
				);
				expect(actual.result.hover.contents.value).toContain('PIC X(5)');
				expect(actual.result.definition).toContainEqual(
					expect.objectContaining({ uri: 'file:///workspace/greeting.cpy' })
				);
				expect(actual.result.references.length).toBeGreaterThan(1);
				expect(JSON.stringify(actual.result.rename)).toContain('FINISH-PARAGRAPH');
				expect(JSON.stringify(actual.result.symbols)).toContain('MAIN-PARAGRAPH');
				expect(native.cacheError).toMatchObject({ code: -32603 });
				expect(native.cacheError.message).toContain('cache');
				// SDK disposal is the termination contract for this original JS release.
				await expect.poll(() => page.workers().length).toBe(0);
			}

			expect(errors).toEqual([]);
			for (const name of [
				'host.mjs',
				'superbol-browser.mjs.gz.bin',
				'gnucobol-config.json.gz.bin'
			])
				expect(requests).toContain(`/upstream/${name}`);
		} finally {
			rpc?.dispose();
			nativeProcess?.kill();
			await browser?.close();
			if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
			await rm(directory, { recursive: true, force: true });
		}
	}
);
