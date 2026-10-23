// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PYTHON_PERFORMANCE === '1';
const root = fileURLToPath(new URL('../../../', import.meta.url));

it(
	'shares real Pyodide engine code and serves current Jedi results after rapid edits',
	{
		skip: !enabled,
		meta: { browser: true, requiredBrowser: enabled },
		timeout: 180_000
	},
	async () => {
		const server = await createServer({
			configFile: false,
			root,
			publicDir: 'static',
			cacheDir: `${root}.cache/python-performance-browser-vite`,
			optimizeDeps: { noDiscovery: true },
			resolve: {
				alias: [
					{ find: '$lib', replacement: `${root}src/lib` },
					{ find: '@wasm-idle/core', replacement: `${root}packages/core/src/index.ts` },
					{
						find: /^@wasm-idle\/llvm-core$/,
						replacement: `${root}packages/llvm-core/runtime/core/src/index.ts`
					},
					{
						find: '@wasm-idle/llvm-core/core',
						replacement: `${root}packages/llvm-core/runtime/core/src`
					}
				]
			},
			plugins: [
				{
					name: 'python-performance-page',
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							if (request.url !== '/') return next();
							response.setHeader('Content-Type', 'text/html');
							response.end(
								'<!doctype html><title>Python performance regression</title>'
							);
						});
					}
				}
			],
			server: {
				host: '127.0.0.1',
				port: 0,
				headers: {
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Cross-Origin-Embedder-Policy': 'require-corp'
				}
			}
		});
		await server.listen();
		const address = server.httpServer!.address();
		if (!address || typeof address === 'string') throw new Error('Missing fixture port');
		const url = `http://127.0.0.1:${address.port}/`;
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		try {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, url);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(url);
			await installBrowserRuntimeDelivery(page, url);
			await page.addScriptTag({
				type: 'module',
				content: `
import Python from '/src/lib/playground/python.ts';
import { createPythonLanguageServer } from '/packages/lsp/src/python/language-server.ts';
const state = globalThis.__pythonPerformance = { ready: false, error: null, compileCalls: 0 };
const compile = WebAssembly.compile.bind(WebAssembly);
WebAssembly.compile = (...args) => { state.compileCalls++; return compile(...args); };
try {
    const python = new Python();
    await python.load(location.href);
    state.executionCompileCalls = state.compileCalls;
    let output = '';
    python.output = text => { output += text; };
    await python.run('print(input()[::-1])', false, true, undefined, [], { stdin: '한🙂\\n' });
    state.output = output;
    async function startLsp() {
        const handle = await createPythonLanguageServer({ rootUrl: location.href, startupTimeoutMs: 90000 });
        const pending = new Map();
        let nextId = 1;
        const diagnostics = [];
        handle.transport.reader.listen(message => {
            if (message.method === 'textDocument/publishDiagnostics') diagnostics.push(message.params);
            if (message.id !== undefined) {
                const request = pending.get(message.id);
                if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
            }
        });
        const notify = (method, params) => handle.transport.writer.write({ jsonrpc: '2.0', method, params });
        const request = (method, params) => new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            handle.transport.writer.write({ jsonrpc: '2.0', id, method, params }).catch(reject);
        });
        await request('initialize', { rootUri: 'file:///workspace', capabilities: {} });
        await notify('initialized', {});
        return { handle, notify, request, diagnostics };
    }
    const first = await startLsp();
    state.firstLspCompileCalls = state.compileCalls;
    first.handle.dispose();
    const lsp = await startLsp();
    state.secondLspCompileCalls = state.compileCalls;
    const uri = 'file:///workspace/main.py', dependency = 'file:///workspace/dep.py';
    await lsp.notify('textDocument/didOpen', { textDocument: { uri: dependency, languageId: 'python', version: 1, text: 'value = "hello"' } });
    await lsp.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 0, text: '' } });
    const completions = [];
    for (let version = 1; version <= 100; version++) {
        lsp.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: 'from dep import value\\nvalue.\\n' }] });
        completions.push(lsp.request('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: 6 } }));
    }
    const results = await Promise.all(completions);
    state.lastCompletion = results.at(-1);
    state.cancelledCount = results.filter(result => result === null).length;
    await new Promise(resolve => setTimeout(resolve, 250));
    state.mainDiagnostics = lsp.diagnostics.filter(item => item.uri === uri);
    await lsp.notify('textDocument/didChange', { textDocument: { uri: dependency, version: 2 }, contentChanges: [{ text: 'value = 1' }] });
    state.dependencyCompletion = await lsp.request('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: 6 } });
    lsp.handle.dispose();
    python.dispose();
    state.ready = true;
} catch (error) { state.error = String(error?.stack || error); }
`
			});
			await page.waitForFunction(
				() =>
					(globalThis as any).__pythonPerformance?.ready ||
					(globalThis as any).__pythonPerformance?.error,
				undefined,
				{ timeout: 150_000 }
			);
			const result = await page.evaluate(() => (globalThis as any).__pythonPerformance);
			expect(result.error, result.error).toBeNull();
			expect(result.output).toBe('🙂한\n');
			expect(result.executionCompileCalls).toBeGreaterThan(0);
			expect(result.firstLspCompileCalls).toBe(result.executionCompileCalls);
			expect(result.secondLspCompileCalls).toBe(result.executionCompileCalls);
			expect(result.cancelledCount).toBeGreaterThan(0);
			expect(result.lastCompletion.items.map((item: any) => item.label)).toContain('upper');
			expect(result.dependencyCompletion.items.map((item: any) => item.label)).toContain(
				'bit_length'
			);
			expect(result.dependencyCompletion.items.map((item: any) => item.label)).not.toContain(
				'upper'
			);
			expect(result.mainDiagnostics.map((item: any) => item.version)).toEqual([100]);
			expect(errors).toEqual([]);
		} finally {
			await browser.close();
			await server.close();
		}
	}
);
