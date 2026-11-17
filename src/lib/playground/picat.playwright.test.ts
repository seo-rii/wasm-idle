// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { prepareContainerRuntimePage } from '../../../scripts/container-runtime-browser-observer.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PICAT === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
describe.skipIf(!enabled)('real PICAT browser interpreter', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>, browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4987',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});
	it(
		'runs actual Picat CP/SAT, delayed stdin, EOF, errors, files, limits and cancellation',
		{ timeout: 240000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				const base = server.browserUrl.replace(/\/$/, '') + '/';
				const url = base + 'picat-consumer-harness';
				await context.route(url, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Picat consumer</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(url, { waitUntil: 'domcontentloaded' });
				await page.addScriptTag({
					type: 'module',
					content: `import Picat from ${JSON.stringify(base + 'src/lib/playground/picat.ts')};globalThis.__Picat=Picat;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Picat));
				const result = await page.evaluate(async (base) => {
					const sandbox = new (globalThis as any).__Picat();
					await sandbox.load({ rootUrl: new URL(base).pathname.replace(/\/$/, '') });
					const results: Record<string, unknown> = { isolated: crossOriginIsolated };
					async function run(
						code: string,
						options: Record<string, unknown> = {},
						onOutput?: (text: string) => void
					) {
						let output = '';
						sandbox.output = (text: string) => {
							output += text;
							onOutput?.(output);
						};
						try {
							return {
								value: await sandbox.run(code, false, true, undefined, [], {
									activePath: 'main.pi',
									limits: { runTimeoutMs: 15000, compileTimeoutMs: 15000 },
									...options
								}),
								output
							};
						} catch (error) {
							return {
								error: (error as any).code,
								message: String((error as Error)?.message || error),
								output
							};
						}
					}
					try {
						let supplied = false;
						results.delayed = await run(
							'main => print("name?"), flush(), Name=read_line(), println(Name), println(read_line()).',
							{},
							(output) => {
								if (!supplied && output.includes('name?')) {
									supplied = true;
									setTimeout(() => {
										sandbox.write('Picat 안녕\n');
										setTimeout(() => sandbox.eof(), 100);
									}, 100);
								}
							}
						);
						results.buffered = await run(
							'main => println(read_line()), println(read_line()).',
							{ stdin: 'hello\n' }
						);
						results.cp = await run(
							'import cp.\nmain => X :: 1..3, X #> 1, solve([X]), println(X).',
							{ stdin: '' }
						);
						results.sat = await run(
							'import sat.\nmain => X :: 0..1, X #= 1, solve([X]), println(X).',
							{ stdin: '' }
						);
						results.workspace = await run(
							'main => println(read_file_lines("input.txt")).',
							{
								stdin: '',
								activePath: 'nested/main.pi',
								workspaceFiles: [{ path: 'input.txt', content: 'alpha\nbeta\n' }]
							}
						);
						results.syntax = await run('main => ( invalid .', { stdin: '' });
						results.runtime = await run('main => throw(boom).', { stdin: '' });
						results.module = await run('module other.\nmain => println(42).', {
							stdin: ''
						});
						results.lowMemory = await run('main => println(42).', {
							stdin: '',
							limits: { maxWasmMemoryBytes: 32 * 1024 * 1024 }
						});
						results.outputLimit = await run(
							'main => foreach(I in 1..1000) println(I) end.',
							{ stdin: '', limits: { maxOutputBytes: 10 } }
						);
						results.timeout = await run('main => while(true) true end.', {
							stdin: '',
							limits: { compileTimeoutMs: 1, runTimeoutMs: 100 }
						});
						let cancelled = false;
						const cancellation = new AbortController();
						results.cancel = await run(
							'main => println("ready"), while(true) true end.',
							{ stdin: '', signal: cancellation.signal },
							(output) => {
								if (!cancelled && output.includes('ready')) {
									cancelled = true;
									setTimeout(() => cancellation.abort(), 20);
								}
							}
						);
						results.afterCancel = await run('main => println("fresh").', { stdin: '' });
						return results;
					} finally {
						await sandbox.dispose();
					}
				}, base);
				process.stdout.write('Picat browser acceptance: ' + JSON.stringify(result) + '\n');
				expect(result.isolated).toBe(true);
				expect(result.delayed).toMatchObject({
					value: true,
					output: 'name?Picat 안녕\nend_of_file\n'
				});
				expect(result.buffered).toMatchObject({
					value: true,
					output: 'hello\nend_of_file\n'
				});
				expect(result.cp).toMatchObject({ value: true, output: '2\n' });
				expect(result.sat).toMatchObject({ value: true, output: '1\n' });
				expect(result.workspace).toMatchObject({ value: true, output: '[alpha,beta]\n' });
				for (const key of ['syntax', 'runtime', 'module'])
					expect(result[key]).toMatchObject({ error: 'runtime' });
				expect(result.lowMemory).toMatchObject({ error: 'resource-limit' });
				expect(result.outputLimit).toMatchObject({ error: 'output-limit' });
				expect(result.timeout).toMatchObject({ error: 'timeout' });
				expect(result.cancel).toMatchObject({ error: 'cancelled' });
				expect(result.afterCancel).toMatchObject({ value: true, output: 'fresh\n' });
			} finally {
				await context.close();
			}
		}
	);
	it(
		'runs the registered default sample from the language selector with delayed terminal input',
		{ timeout: 240000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(90000);
			try {
				await prepareContainerRuntimePage(page, server.browserUrl);
				await page.locator('#language-select').selectOption('PICAT');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('Name = read_line()')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.picat);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('Name? ')
				);
				await page.waitForTimeout(100);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('Picat UI\n', false);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				expect(
					await page.locator('[data-testid="terminal-debug-output"]').textContent()
				).toContain('Hello, Picat UI');
			} finally {
				await context.close();
			}
		}
	);
});
