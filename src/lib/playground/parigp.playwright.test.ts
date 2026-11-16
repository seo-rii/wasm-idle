// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { prepareContainerRuntimePage } from '../../../scripts/container-runtime-browser-observer.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PARIGP === '1';
const meta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real PARI/GP in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4983',
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
		'executes scripts, delayed input, EOF, workspace files, errors, limits and cancellation',
		{ timeout: 240000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			try {
				const base = server.browserUrl.replace(/\/$/, '') + '/';
				const harness = base + 'parigp-consumer-harness';
				await context.route(harness, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>GP</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(harness);
				await installBrowserRuntimeDelivery(page, base);
				await page.addScriptTag({
					type: 'module',
					content: `import PariGp from ${JSON.stringify(base + 'src/lib/playground/parigp.ts')}; globalThis.__gp = PariGp;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__gp));
				const results = await page.evaluate(async (base) => {
					const sandbox = new (globalThis as any).__gp();
					await sandbox.load({ rootUrl: new URL(base).pathname.replace(/\/$/, '') });
					async function run(
						code: string,
						options: any = {},
						observe?: (output: string) => void
					) {
						let output = '';
						sandbox.output = (text: string) => {
							output += text;
							observe?.(output);
						};
						try {
							const value = await sandbox.run(code, false, true, undefined, [], {
								activePath: 'main.gp',
								limits: { compileTimeoutMs: 30000, runTimeoutMs: 30000 },
								...options
							});
							return { value, output };
						} catch (error: any) {
							return { error: error.code, message: error.message, output };
						}
					}
					try {
						let sent = false;
						const delayed = await run(
							'print("ready"); print(readstr("/dev/stdin"));',
							{},
							(output) => {
								if (!sent && output.includes('ready')) {
									sent = true;
									setTimeout(() => {
										sandbox.write('GP 안녕\n');
										setTimeout(() => sandbox.eof(), 100);
									}, 100);
								}
							}
						);
						const buffered = await run(
							'\\\\ Read terminal input separately from source lines.\nn=input();\nprint(sum(i=1,n,i));',
							{
								stdin: '100\n'
							}
						);
						const multiline = await run(
							'\\\\ Comment handled by upstream GP.\nsquare(x) = {\n  x^2\n};\nn=input();\nprint(square(n));',
							{ stdin: '13\n' }
						);
						const mixed = await run(
							'n=input();\nprint(n^2);\nprint(readstr("/dev/stdin"));',
							{ stdin: '13\n' }
						);
						const workspace = await run('read("lib/value.gp"); print(answer);', {
							stdin: '',
							workspaceFiles: [{ path: 'lib/value.gp', content: 'answer = 42;' }]
						});
						const arithmetic = await run('print(factor(2^64+1)); print(2^100);', {
							stdin: ''
						});
						const error = await run('print("before"); error("boom"); print("after");', {
							stdin: ''
						});
						const syntax = await run('print(1 + );', { stdin: '' });
						const memory = await run('print(1);', {
							stdin: '',
							limits: { maxWasmMemoryBytes: 16 * 1024 * 1024 }
						});
						const controller = new AbortController();
						const cancel = await run(
							'print("cancel"); input();',
							{ signal: controller.signal },
							(output) => {
								if (output.includes('cancel'))
									controller.abort('cancel blocked GP input');
							}
						);
						const fresh = await run('print("fresh");', { stdin: '' });
						return {
							isolated: crossOriginIsolated,
							delayed,
							buffered,
							multiline,
							mixed,
							workspace,
							arithmetic,
							error,
							syntax,
							memory,
							cancel,
							fresh
						};
					} finally {
						await sandbox.dispose();
					}
				}, base);
				process.stdout.write(`PARI/GP acceptance: ${JSON.stringify(results)}\n`);
				expect(results.isolated).toBe(true);
				expect(results.delayed).toMatchObject({
					value: true,
					output: 'ready\n["GP 안녕"]\n'
				});
				expect(results.buffered).toMatchObject({ value: true, output: '5050\n' });
				expect(results.multiline).toMatchObject({ value: true, output: '169\n' });
				expect(results.mixed).toMatchObject({ value: true, output: '169\n[]\n' });
				expect(results.workspace).toMatchObject({ value: true, output: '42\n' });
				expect(results.arithmetic.output).toContain('1267650600228229401496703205376');
				expect(results.error).toMatchObject({ error: 'runtime' });
				expect(results.error.output).toContain('before');
				expect(results.error.output).not.toContain('\nafter\n');
				expect(results.syntax).toMatchObject({ error: 'runtime' });
				expect(results.memory).toMatchObject({ error: 'resource-limit' });
				expect(results.cancel).toMatchObject({ error: 'cancelled' });
				expect(results.fresh).toMatchObject({ value: true, output: 'fresh\n' });
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the registered sample through Monaco and delayed terminal stdin',
		{ timeout: 240000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60000);
			try {
				await prepareContainerRuntimePage(page, server.browserUrl);
				await page.locator('#language-select').selectOption('PARIGP');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug?.getEditorValue().includes('sum(i = 1')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.parigp);
				await page.locator('button.action-button--run').first().click();
				await page.waitForTimeout(300);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('100\n', false);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				const state = await page.evaluate(() =>
					(window as any).__wasmIdleDebug.getExecutionState()
				);
				const transcript = await page
					.locator('[data-testid="terminal-debug-output"]')
					.textContent();
				expect(state, JSON.stringify({ state, transcript })).toMatchObject({
					status: 'completed',
					exitCode: 0
				});
				expect(
					await page.locator('[data-testid="terminal-debug-output"]').textContent()
				).toContain('5050');
			} finally {
				await context.close();
			}
		}
	);
});
