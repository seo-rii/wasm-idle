import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const fixtures = [
	{
		name: 'Array.ConvertAll method-group delegate with explicit System import',
		code: 'using System; class MainClass { static void Main() { var values = Array.ConvertAll(Console.ReadLine()!.Split(), int.Parse); Console.WriteLine(values[0] + values[1]); } }',
		stdout: '42\n'
	},
	{
		name: 'top-level Array and Console with implicit System import',
		code: 'var values = Array.ConvertAll(Console.ReadLine()!.Split(), int.Parse); Console.Write(values[0] + values[1]);',
		stdout: '42'
	},
	{
		name: 'class entry point and Array methods with implicit System import',
		code: 'class MainClass { static void Main() { var values = new[] { 20, 2, 10 }; Array.Sort(values); Array.Reverse(values); Console.WriteLine(string.Join(",", values)); } }',
		stdout: '20,10,2\n'
	}
];

const workerSource = `
self.onmessage = async ({ data: fixtures }) => {
  try {
    globalThis.dotnetSidecar = true;
    globalThis.document ??= {
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return true; }, querySelectorAll() { return []; }
    };
    const api = await import('/index.js');
    const compiler = api.createDotnetCompiler({ language: 'csharp' });
    await compiler.prepare({ language: 'csharp' });
    const results = [];
    for (const fixture of fixtures) {
      try {
        const compiled = await compiler.compile({ language: 'csharp', code: fixture.code });
        if (!compiled.success) throw new Error(JSON.stringify(compiled));
        const result = await api.executeBrowserDotnetArtifact(compiled.artifact, { stdin: '19 23\\n' });
        results.push({ name: fixture.name, ...result });
      } catch (error) {
        results.push({ name: fixture.name, error: error?.stack || String(error) });
      }
    }
    postMessage({ results });
  } catch (error) {
    postMessage({ error: error?.stack || String(error) });
  }
};
`;

it(
	'executes C# array delegates and default System names in the published browser runtime',
	{
		skip: process.env.WASM_DOTNET_RUN_BROWSER_CSHARP !== '1',
		timeout: 180_000
	},
	async () => {
		const root = path.resolve(
			process.env.WASM_DOTNET_BROWSER_RUNTIME_ROOT ||
				fileURLToPath(new URL('../dist/', import.meta.url))
		);
		const server = createServer(async (request, response) => {
			response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
			response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
			try {
				const pathname = decodeURIComponent(
					new URL(request.url || '/', 'http://localhost').pathname
				);
				if (pathname === '/') {
					response.setHeader('Content-Type', 'text/html');
					response.end(
						'<!doctype html><title>C# regressions</title><link rel="icon" href="data:,">'
					);
					return;
				}
				if (pathname === '/regression.worker.mjs') {
					response.setHeader('Content-Type', 'text/javascript');
					response.end(workerSource);
					return;
				}
				const file = path.resolve(root, '.' + pathname);
				if (!file.startsWith(root + path.sep)) {
					response.writeHead(403).end();
					return;
				}
				const bytes = await readFile(file);
				response.setHeader(
					'Content-Type',
					file.endsWith('.wasm')
						? 'application/wasm'
						: /\.m?js$/.test(file)
							? 'text/javascript'
							: file.endsWith('.json')
								? 'application/json'
								: 'application/octet-stream'
				);
				response.end(bytes);
			} catch {
				response.writeHead(404).end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		let browser;
		try {
			browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Missing server address');
			const url = `http://127.0.0.1:${address.port}/`;
			const context = await browser.newContext();
			await addBrowserTestCookies(context, url);
			const page = await context.newPage();
			await page.goto(url);
			expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
			const results = await page.evaluate(
				(fixtures) =>
					new Promise<
						Array<{
							name: string;
							error?: string;
							exitCode?: number;
							stdout?: string;
							stderr?: string;
						}>
					>((resolve, reject) => {
						const worker = new Worker('/regression.worker.mjs', { type: 'module' });
						const timer = setTimeout(() => {
							worker.terminate();
							reject(new Error('C# browser regression worker timed out'));
						}, 150_000);
						worker.onmessage = ({ data }) => {
							clearTimeout(timer);
							worker.terminate();
							data.error ? reject(new Error(data.error)) : resolve(data.results);
						};
						worker.onerror = (event) => {
							clearTimeout(timer);
							worker.terminate();
							reject(new Error(event.message));
						};
						worker.postMessage(fixtures);
					}),
				fixtures
			);
			expect(results).toHaveLength(fixtures.length);
			for (const [index, result] of results.entries()) {
				expect.soft(result, fixtures[index].name).toEqual({
					name: fixtures[index].name,
					exitCode: 0,
					stdout: fixtures[index].stdout,
					stderr: ''
				});
			}
		} finally {
			await browser?.close();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
		}
	}
);
