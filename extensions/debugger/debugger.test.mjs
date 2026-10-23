import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchDebuggerBrowser } from './test-support.mjs';

const extension = dirname(fileURLToPath(import.meta.url));
const root = resolve(extension, '../..');

test(
	'extension uses native Worker breakpoints, scopes, step and evaluation without source probes',
	{ timeout: 180_000 },
	async (t) => {
		const bundled = await build({
			stdin: {
				contents: `export {CdpDebugAdapter} from './packages/debug/src/adapter/cdp.ts';
      export {createBrowserCdpTransport} from './packages/debug/src/adapter/cdp-transport.ts';`,
				resolveDir: root,
				loader: 'ts'
			},
			bundle: true,
			write: false,
			format: 'iife',
			globalName: 'nativeDebug'
		});
		const runtime = await readFile(resolve(root, 'static/wasm-typescript/javascript.js'));
		const typescript = gunzipSync(
			await readFile(resolve(root, 'static/wasm-typescript/index.js.gz'))
		);
		const worker = `import {createTypeScriptCompiler, executeBrowserTypeScriptArtifact} from '/runtime.js';
    const compiler = await createTypeScriptCompiler();
    onmessage = async ({data}) => {
      try {
      const activeCompiler = data.language === 'typescript' ? await (await import('/typescript.js')).createTypeScriptCompiler() : compiler;
      const compiled = await activeCompiler.compile({code:data.code,language:data.language,fileName:data.url});
      if (!compiled.success) throw new Error(compiled.stderr);
      let input = '7\\n';
      const result = await executeBrowserTypeScriptArtifact(compiled.artifact, {
        activePath:'main.js', stdin:()=> {const chunk = input; input = null; return chunk;}, stdout:(output)=>postMessage({output})
      });
      postMessage({result});
      } catch (error) { postMessage({error:String(error)}); }
    };
    postMessage({ready:true});`;
		const server = createServer((request, response) => {
			response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
			response.setHeader(
				'Content-Type',
				request.url === '/' ? 'text/html' : 'text/javascript'
			);
			response.end(
				request.url === '/bundle.js'
					? bundled.outputFiles[0].contents
					: request.url === '/worker.js'
						? worker
						: request.url === '/runtime.js'
							? runtime
							: request.url === '/typescript.js'
								? typescript
								: '<!doctype html><script src="/bundle.js"></script>'
			);
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		let browser;
		try {
			browser = await launchDebuggerBrowser(`http://127.0.0.1:${server.address().port}/`);
			const { page } = browser;
			page.on('pageerror', (error) => t.diagnostic(error.message));
			for (const language of ['javascript', 'typescript']) {
				t.diagnostic(`Connecting the ${language} execution Worker`);
				await page.evaluate(async (language) => {
					globalThis.messages = [];
					globalThis.stops = [];
					const name = `wasm-idle-cdp:${crypto.randomUUID()}`;
					globalThis.worker = new Worker('/worker.js', { type: 'module', name });
					await new Promise((resolve, reject) => {
						worker.addEventListener(
							'error',
							(event) => reject(new Error(event.message)),
							{
								once: true
							}
						);
						worker.addEventListener('message', function ready(event) {
							messages.push(event.data);
							if (event.data.ready) {
								worker.removeEventListener('message', ready);
								resolve();
							}
						});
					});
					worker.addEventListener('message', (event) => messages.push(event.data));
					const transport = await nativeDebug.createBrowserCdpTransport(name);
					const sourcePath = language === 'typescript' ? 'main.ts' : 'main.js';
					const url = `wasm-idle://test/${sourcePath}`;
					globalThis.nativeEvents = [];
					transport.onEvent((event) => {
						if (event.method !== 'Debugger.scriptParsed') nativeEvents.push(event);
					});
					globalThis.adapter = new nativeDebug.CdpDebugAdapter({
						transport,
						source: { path: sourcePath },
						url,
						lineOffset: 2
					});
					adapter.onEvent((event) => {
						if (event.type === 'stopped') stops.push(event);
					});
					await adapter.initialize();
					await adapter.setBreakpoints({ path: sourcePath }, [3]);
					await adapter.launch({ stopOnEntry: false });
					worker.postMessage({
						language,
						url,
						code: `const fs = require("fs");\nlet value${language === 'typescript' ? ': number' : ''} = Number(fs.readFileSync(0, "utf8"));\nvalue += 2;\nconsole.log(value);`
					});
				}, language);
				t.diagnostic('Waiting for the native source breakpoint');
				try {
					await page.waitForFunction(() => stops.length === 1);
				} catch (error) {
					t.diagnostic(
						JSON.stringify(
							await page.evaluate(() => ({
								messages,
								nativeEvents,
								scripts: [...adapter.scripts.values()].map((script) => ({
									url: script.url,
									id: script.scriptId
								}))
							}))
						)
					);
					throw error;
				}
				assert.deepEqual(
					await page.evaluate(async () => {
						const frames = await adapter.stackTrace(1);
						const scopes = await adapter.scopes(frames[0].id);
						const locals = await adapter.variables(
							scopes.find((scope) => scope.presentationHint === 'locals')
								.variablesReference
						);
						return {
							line: frames[0].line,
							value: locals.find((item) => item.name === 'value')?.value,
							evaluated: (await adapter.evaluate('value + 4', frames[0].id)).result
						};
					}),
					{ line: 3, value: '7', evaluated: '11' }
				);
				await page.evaluate(() => adapter.next(1));
				await page.waitForFunction(() => stops.length === 2);
				assert.equal(
					await page.evaluate(async () => (await adapter.stackTrace(1))[0].line),
					4
				);
				await page.evaluate(() => adapter.continue(1));
				await page.waitForFunction(() => messages.some((message) => message.result));
				assert.equal(
					await page.evaluate(() =>
						messages
							.filter((message) => message.output)
							.map((message) => message.output)
							.join('')
					),
					'9\n'
				);
				await page.evaluate(async () => {
					await adapter.disconnect();
					worker.terminate();
				});
			}
		} finally {
			await browser?.dispose();
			await new Promise((resolve) => server.close(resolve));
		}
	}
);
